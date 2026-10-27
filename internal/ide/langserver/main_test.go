package langserver

import (
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	"runtime"
	"strings"
	"testing"

	"github.com/Andrea-Cavallo/adOmnia/internal/ide/idetest"
	"github.com/Andrea-Cavallo/adOmnia/internal/ide/language"
	"github.com/Andrea-Cavallo/adOmnia/internal/ide/lsp"
)

const fakeGoplsEnv = idetest.FakeGoplsEnv

// goID is the id of the Go language; the core tests never import the Go adapter (architecture_test.go).
const goID = "go"

func TestMain(m *testing.M) { idetest.Main(m) }

// fakeLanguage owns the files with its extension. The "go" one also classifies usages and extracts
// declarations, so the dispatch to those capabilities can be tested without the real adapter.
type fakeLanguage struct{ id, extension string }

func (l fakeLanguage) ID() string   { return l.id }
func (l fakeLanguage) Name() string { return strings.ToUpper(l.id) }
func (l fakeLanguage) DocumentLanguageID(path string) (string, bool) {
	return l.id, strings.HasSuffix(path, l.extension)
}

type fakeGoLanguage struct{ fakeLanguage }

func (fakeGoLanguage) ClassifyUsages(_ string, positions []lsp.Position) []string {
	usages := make([]string, len(positions))
	for index, position := range positions {
		usages[index] = fmt.Sprintf("read@%d:%d", position.Line, position.Character)
	}
	return usages
}

func (fakeGoLanguage) DeclarationSource(text string, _ lsp.Position) (string, int, bool) {
	return strings.TrimSuffix(text, "\n"), 1, text != ""
}

// newLanguageRegistry registers fake languages for the ids the tests use.
func newLanguageRegistry() *language.Registry {
	registry := language.NewRegistry()
	for _, adapter := range []language.Language{
		fakeGoLanguage{fakeLanguage{goID, ".go"}},
		fakeLanguage{"java", ".java"}, fakeLanguage{"python", ".py"}, fakeLanguage{"rust", ".rs"}, fakeLanguage{"typescript", ".ts"},
	} {
		if err := registry.Register(adapter); err != nil {
			panic(err)
		}
	}
	return registry
}

// goplsSpec is the minimal spec to run a real gopls; memoryLimitMiB > 0 sets GOMEMLIMIT like the Go adapter.
func goplsSpec(binary string, environment []string, memoryLimitMiB int) lsp.ServerSpec {
	if memoryLimitMiB > 0 {
		environment = append(append([]string(nil), environment...), fmt.Sprintf("GOMEMLIMIT=%dMiB", memoryLimitMiB))
	}
	return lsp.ServerSpec{Language: goID, Name: "gopls", Binary: binary, Environment: environment, DiscoversNestedUnits: true}
}

func findGoplsForTest(t *testing.T) string {
	t.Helper()
	if found, err := exec.LookPath("gopls"); err == nil {
		return found
	}
	if home, err := os.UserHomeDir(); err == nil {
		name := "gopls"
		if runtime.GOOS == "windows" {
			name += ".exe"
		}
		if candidate := filepath.Join(home, "go", "bin", name); fileExists(candidate) {
			return candidate
		}
	}
	t.Skip("gopls non installato: test di integrazione LSP saltato")
	return ""
}

func fileExists(path string) bool { _, err := os.Stat(path); return err == nil }

func writeFixtureFile(t *testing.T, root, name, content string) {
	idetest.WriteFile(t, root, name, content)
}
