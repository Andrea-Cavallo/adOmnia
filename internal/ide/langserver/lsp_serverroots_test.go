package langserver

import (
	"os"
	"path/filepath"
	"reflect"
	"strings"
	"testing"

	"github.com/Andrea-Cavallo/adOmnia/internal/ide/language"
	"github.com/Andrea-Cavallo/adOmnia/internal/ide/lsp"
	"github.com/Andrea-Cavallo/adOmnia/internal/ide/project"
)

// groupedLanguage è un linguaggio con un server per gruppo di unità, come Rust: molte unità di build
// (i crate) sono servite da un solo processo alla radice del workspace che le contiene.
type groupedLanguage struct{}

func (groupedLanguage) ID() string   { return "grouped" }
func (groupedLanguage) Name() string { return "Grouped" }
func (groupedLanguage) DocumentLanguageID(path string) (string, bool) {
	return "grouped", strings.EqualFold(filepath.Ext(path), ".grp")
}
func (groupedLanguage) ServersPerUnit() bool { return true }

func (groupedLanguage) ServerRoots(_ string, units []project.Unit) []string {
	seen := map[string]bool{}
	var roots []string
	for _, unit := range units {
		// Il gruppo è la cartella che contiene tutte le unità: un server per gruppo, non per unità.
		root := filepath.Dir(unit.Root)
		if !seen[root] {
			seen[root] = true
			roots = append(roots, root)
		}
	}
	return roots
}

func (groupedLanguage) UnitServerSpec(projectRoot, unitRoot, toolsRoot string) (lsp.ServerSpec, error) {
	executable, err := os.Executable()
	if err != nil {
		return lsp.ServerSpec{}, err
	}
	return lsp.ServerSpec{
		Language: "grouped", Name: "fake-grouped", Binary: executable,
		Arguments:   []string{unitRoot},
		Environment: append(os.Environ(), fakeGoplsEnv+"=1"),
	}, nil
}

// Un linguaggio che dichiara ServerRoots avvia un server per gruppo: tre unità in un gruppo sono un
// processo solo, e i documenti di ogni unità arrivano a quel server.
func TestServerRootsGroupUnitsIntoOneServer(t *testing.T) {
	registry := language.NewRegistry()
	if err := registry.Register(groupedLanguage{}); err != nil {
		t.Fatal(err)
	}
	manager := NewLSPManager(registry)
	t.Cleanup(manager.Shutdown)

	root := t.TempDir()
	group := filepath.Join(root, "workspace")
	units := make([]project.Unit, 0, 3)
	for _, name := range []string{"alpha", "beta", "gamma"} {
		directory := filepath.Join(group, name)
		if err := os.MkdirAll(directory, 0o755); err != nil {
			t.Fatal(err)
		}
		units = append(units, project.Unit{Language: "grouped", Kind: "cargo-package", Root: directory})
	}
	document := filepath.Join(group, "gamma", "lib.grp")
	if err := os.WriteFile(document, []byte("fn main() {}\n"), 0o644); err != nil {
		t.Fatal(err)
	}
	session := Session{ID: "grouped", Project: Project{Name: "mono", RootPath: root, RealPath: root, Units: units}}

	if roots := manager.serverRoots(session, "grouped"); !reflect.DeepEqual(roots, []string{filepath.Clean(group)}) {
		t.Fatalf("server roots = %v", roots)
	}
	manager.TrackDocument(session, Document{ID: "gamma-lib", SessionID: session.ID, URI: lsp.FileURI(document), Path: document}, "fn main() {}\n", false)

	perGroup := func(unitRoot string) (LanguageServerOptions, error) {
		return LanguageServerOptions{Language: "grouped", Name: "fake-grouped", Binary: os.Args[0], Environment: append(os.Environ(), fakeGoplsEnv+"=1")}, nil
	}
	if _, err := manager.Start(session, LanguageServerOptions{Language: "grouped", Name: "fake-grouped", Binary: os.Args[0], Environment: append(os.Environ(), fakeGoplsEnv+"=1"), PerUnitSpec: perGroup}); err != nil {
		t.Fatal(err)
	}

	states := manager.statesOf(session.ID, "grouped")
	if len(states) != 1 {
		t.Fatalf("%d language servers, want one for the group", len(states))
	}
	state := states[0]
	state.mu.Lock()
	unit, serverRoot := state.unit, state.root
	_, tracked := state.documents["gamma-lib"]
	state.mu.Unlock()
	if unit != filepath.Clean(group) || serverRoot != filepath.Clean(group) {
		t.Fatalf("server runs for %q from %q, want the group root", unit, serverRoot)
	}
	if !tracked {
		t.Fatal("the document of a member unit was not routed to the group server")
	}
	manager.Stop(session.ID, "grouped")
}

// Il limite di sicurezza vale per ogni linguaggio: il numero di server avviati insieme è limitato e
// le radici in eccesso restano elencate, non avviate.
func TestCapServerRootsLimitsTheBurst(t *testing.T) {
	roots := make([]string, maxUnitServers+3)
	for index := range roots {
		roots[index] = string(rune('a' + index))
	}
	launch, skipped := capServerRoots(roots)
	if len(launch) != maxUnitServers || len(skipped) != 3 {
		t.Fatalf("launch %d, skipped %d", len(launch), len(skipped))
	}
	if launch, skipped := capServerRoots([]string{"a", "b"}); len(launch) != 2 || len(skipped) != 0 {
		t.Fatalf("small group: launch %d, skipped %d", len(launch), len(skipped))
	}
}

// Il limite vale anche a runtime, non solo nel calcolo delle radici: un linguaggio con molte unità
// (Python con un ambiente per servizio, o Rust prima del raggruppamento) avvia al massimo
// maxUnitServers processi; le unità oltre il limite restano elencate e il loro log dice perché.
func TestStartUnitsNeverExceedsTheServerLimit(t *testing.T) {
	registry := language.NewRegistry()
	if err := registry.Register(fakeUnitLanguage{}); err != nil {
		t.Fatal(err)
	}
	manager := NewLSPManager(registry)
	t.Cleanup(manager.Shutdown)

	root := t.TempDir()
	units := make([]project.Unit, 0, maxUnitServers+4)
	for index := range maxUnitServers + 4 {
		directory := filepath.Join(root, "service"+string(rune('a'+index)))
		if err := os.MkdirAll(directory, 0o755); err != nil {
			t.Fatal(err)
		}
		units = append(units, project.Unit{Language: "unitpy", Kind: "python-project", Root: directory})
	}
	session := Session{ID: "burst", Project: Project{Name: "mono", RootPath: root, RealPath: root, Units: units}}

	perUnit := func(unitRoot string) (LanguageServerOptions, error) {
		return LanguageServerOptions{Language: "unitpy", Name: "fake-pyright", Binary: os.Args[0], Environment: append(os.Environ(), fakeGoplsEnv+"=1")}, nil
	}
	if _, err := manager.Start(session, LanguageServerOptions{Language: "unitpy", Name: "fake-pyright", Binary: os.Args[0], Environment: append(os.Environ(), fakeGoplsEnv+"=1"), PerUnitSpec: perUnit}); err != nil {
		t.Fatal(err)
	}

	running := 0
	for _, state := range manager.statesOf(session.ID, "unitpy") {
		state.mu.Lock()
		if state.status.PID > 0 {
			running++
		}
		state.mu.Unlock()
	}
	if running != maxUnitServers {
		t.Fatalf("%d language servers running, want %d", running, maxUnitServers)
	}
	if skipped := strings.Join(manager.Log(session.ID, "unitpy"), "\n"); !strings.Contains(skipped, "limit") {
		t.Fatalf("the skipped units are not explained in the log:\n%s", skipped)
	}
	manager.Stop(session.ID, "unitpy")
}
