package golang

import (
	"context"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"github.com/Andrea-Cavallo/adOmnia/internal/ide/idetest"
	"github.com/Andrea-Cavallo/adOmnia/internal/ide/langserver"
	"github.com/Andrea-Cavallo/adOmnia/internal/ide/language"
	"github.com/Andrea-Cavallo/adOmnia/internal/ide/lsp"
	"github.com/Andrea-Cavallo/adOmnia/internal/ide/sdk"
	"github.com/Andrea-Cavallo/adOmnia/internal/ide/workspace"
	"github.com/shirou/gopsutil/v4/process"
)

// Opt-in measurement against a real workspace, not a synthetic memory assertion.
// ADOMNIA_MEASURE_LSP_ROOT and ADOMNIA_MEASURE_LSP_BINARY select local inputs.
func TestMeasureLanguageServerMemory(t *testing.T) {
	root := os.Getenv("ADOMNIA_MEASURE_LSP_ROOT")
	binary := os.Getenv("ADOMNIA_MEASURE_LSP_BINARY")
	if root == "" || binary == "" {
		t.Skip("set ADOMNIA_MEASURE_LSP_ROOT and ADOMNIA_MEASURE_LSP_BINARY")
	}
	for _, limit := range []string{"1GiB", "768MiB", "512MiB"} {
		for _, scope := range []string{"full", "codestudio-subdirectory", "selected-directories"} {
			name := limit + "/" + scope
			narrow := scope != "full"
			checkout := root
			settings := GoplsSettings{}
			if scope == "codestudio-subdirectory" {
				checkout = filepath.Join(root, "internal", "codestudio")
				expand := false
				settings.ExpandWorkspaceToModule = &expand
			}
			if scope == "selected-directories" {
				settings.DirectoryFilters = []string{"-", "+internal/codestudio", "-**/node_modules"}
			}
			t.Run(name, func(t *testing.T) {
				manager := langserver.NewLSPManager(goOnlyRegistry())
				t.Cleanup(manager.Shutdown)
				// Explicit replacement: an inherited limit must not invalidate the comparison.
				env := []string{"GOMEMLIMIT=" + limit}
				for _, value := range os.Environ() {
					if !strings.HasPrefix(strings.ToUpper(value), "GOMEMLIMIT=") {
						env = append(env, value)
					}
				}
				env = sdk.WithDefaultEnvironment(env, map[string]string{"GO_TELEMETRY_CHILD": "2"})
				session := workspace.Session{ID: "measure", Project: workspace.Project{Name: "measure", RealPath: checkout, RootPath: checkout}}
				started := time.Now()
				status, err := manager.Start(session, GoplsServerSpec(GoplsInfo{Binary: binary}, env, settings))
				if err != nil {
					t.Fatal(err)
				}
				ctx, cancel := context.WithTimeout(context.Background(), 3*time.Minute)
				defer cancel()
				symbols, err := manager.WorkspaceSymbols(ctx, session.ID, "LSPManager")
				if err != nil {
					t.Fatal(err)
				}
				if len(symbols) == 0 {
					t.Fatal("workspace symbols missing")
				}
				loaded := time.Since(started)
				p, err := process.NewProcess(int32(status.PID))
				if err != nil {
					t.Fatal(err)
				}
				path := filepath.Join(root, "internal", "ide", "langserver", "lsp.go")
				content, err := os.ReadFile(path)
				if err != nil {
					t.Fatal(err)
				}
				manager.TrackDocument(session, workspace.Document{ID: "hover", Path: path, URI: lsp.FileURI(path)}, string(content), false)
				line, column := idetest.PositionOf(t, string(content), "type LSPManager struct", 5)
				hoverStart := time.Now()
				hover, err := manager.Hover(ctx, session.ID, "hover", line, column)
				if err != nil || hover.Markdown == "" {
					t.Fatalf("hover: %v %+v", err, hover)
				}
				hoverDuration := time.Since(hoverStart)
				time.Sleep(2 * time.Second)
				memory, err := p.MemoryInfo()
				if err != nil {
					t.Fatal(err)
				}
				warm := time.Now()
				for range 5 {
					if _, err := manager.WorkspaceSymbols(ctx, session.ID, "LSPManager"); err != nil {
						t.Fatal(err)
					}
				}
				cpu, err := p.Times()
				if err != nil {
					t.Fatal(err)
				}
				t.Logf("limit=%s narrow=%v resident_MiB=%.1f load_ms=%d hover_ms=%d warm_symbol_ms=%.1f cpu_seconds=%.2f symbols=%d", limit, narrow, float64(memory.RSS)/(1<<20), loaded.Milliseconds(), hoverDuration.Milliseconds(), float64(time.Since(warm).Microseconds())/5000, cpu.User+cpu.System, len(symbols))
				manager.CloseSession(session.ID)
				if running, _ := p.IsRunning(); running {
					t.Fatal("gopls survived workspace close")
				}
			})
		}
	}
}

// goOnlyRegistry is the language registry of a Go-only project.
func goOnlyRegistry() *language.Registry {
	registry := language.NewRegistry()
	if err := registry.Register(New()); err != nil {
		panic(err)
	}
	return registry
}
