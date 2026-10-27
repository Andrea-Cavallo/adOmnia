package codestudio

import (
	"context"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"github.com/Andrea-Cavallo/adOmnia/internal/languages/golang"
	"github.com/shirou/gopsutil/v4/process"
)

func TestGoplsMemoryLimitRestartRetainsOverlay(t *testing.T) {
	binary := findGoplsForTest(t)
	root := t.TempDir()
	writeFixtureFile(t, root, "go.mod", "module example.test/memoryrestart\n\ngo 1.26\n")
	writeFixtureFile(t, root, "main.go", "package main\nconst MemoryLimitMarker = 1\nfunc main() {}\n")
	manager := NewLSPManager(newLanguageRegistry())
	t.Cleanup(manager.Shutdown)
	session := Session{ID: "memory-restart", Project: Project{Name: "memory", RootPath: root, RealPath: root}}
	spec := golang.GoplsServerSpec(GoplsInfo{Binary: binary}, os.Environ(), LanguageServerSettings{MemoryLimitMiB: 768})
	started, err := manager.Start(session, spec)
	if err != nil {
		t.Fatal(err)
	}
	old, _ := process.NewProcess(int32(started.PID))
	path := filepath.Join(root, "main.go")
	doc := Document{ID: "buffer", Path: path, URI: fileURI(path)}
	manager.TrackDocument(session, doc, "package main\nconst MemoryLimitMarker = 42\nfunc main() {}\n", false)
	ctx, cancel := context.WithTimeout(context.Background(), time.Minute)
	defer cancel()
	if _, err := manager.Hover(ctx, session.ID, doc.ID, 2, 12); err != nil {
		t.Fatal(err)
	}
	spec = golang.GoplsServerSpec(GoplsInfo{Binary: binary}, os.Environ(), LanguageServerSettings{MemoryLimitMiB: 512})
	before := time.Now()
	restarted, err := manager.Restart(session, spec)
	if err != nil {
		t.Fatal(err)
	}
	if restarted.PID == started.PID {
		t.Fatal("old process was reused")
	}
	if alive, _ := old.IsRunning(); alive {
		t.Fatal("old gopls survived restart")
	}
	hover, err := manager.Hover(ctx, session.ID, doc.ID, 2, 12)
	if err != nil || !strings.Contains(hover.Markdown, "42") {
		t.Fatalf("lost unsaved overlay: %v %+v", err, hover)
	}
	state, _ := manager.server(session.ID, golang.ID)
	state.mu.Lock()
	environment := append([]string(nil), state.options.Environment...)
	state.mu.Unlock()
	if !strings.Contains(strings.Join(environment, "\n"), "GOMEMLIMIT=512MiB") {
		t.Fatal("restart lost limit")
	}
	t.Logf("Restart plus hover with unsaved overlay: %d ms; new PID %d", time.Since(before).Milliseconds(), restarted.PID)
}
