package codestudio

import (
	"os"
	"path/filepath"
	"reflect"
	"strings"
	"testing"
	"time"

	"github.com/Andrea-Cavallo/adOmnia/internal/ide/language"
	"github.com/Andrea-Cavallo/adOmnia/internal/ide/lsp"
	"github.com/Andrea-Cavallo/adOmnia/internal/ide/project"
)

// fakeUnitLanguage è un linguaggio con un server per unità, come Python: ogni unità porta il proprio
// ambiente e un solo server multi-root userebbe quello di una sola. Serve a provare che l'host ne
// avvia uno per unità, ognuno con la propria radice, e che i documenti vanno a quello giusto.
type fakeUnitLanguage struct{}

func (fakeUnitLanguage) ID() string   { return "unitpy" }
func (fakeUnitLanguage) Name() string { return "Unit Python" }
func (fakeUnitLanguage) DocumentLanguageID(path string) (string, bool) {
	return "unitpy", strings.EqualFold(filepath.Ext(path), ".unit")
}
func (fakeUnitLanguage) ServersPerUnit() bool { return true }

// UnitServerSpec completa language.UnitServers come fa l'adapter Python: l'host chiede la spec
// dell'unità passando la radice del progetto (dove vivono le impostazioni della macchina) e quella
// dell'unità.
func (fakeUnitLanguage) UnitServerSpec(projectRoot, unitRoot, toolsRoot string) (lsp.ServerSpec, error) {
	executable, err := os.Executable()
	if err != nil {
		return lsp.ServerSpec{}, err
	}
	return lsp.ServerSpec{
		Language: "unitpy", Name: "fake-pyright", Binary: executable,
		Arguments:   []string{unitRoot},
		Environment: append(os.Environ(), fakeGoplsEnv+"=1"),
	}, nil
}

func TestUnitRootsAndDocumentRouting(t *testing.T) {
	root := t.TempDir()
	unit := func(languageID, directory string) project.Unit {
		return project.Unit{Language: languageID, Kind: "python-project", Root: filepath.Join(root, directory)}
	}
	api, worker := unit(fakeUnitLanguage{}.ID(), "api"), unit(fakeUnitLanguage{}.ID(), "worker")
	session := Session{ID: "roots", Project: Project{RealPath: root, Units: []project.Unit{worker, api, unit("java", "billing")}}}

	want := []string{filepath.Join(root, "api"), filepath.Join(root, "worker")}
	if got := unitRoots(session, fakeUnitLanguage{}.ID()); !reflect.DeepEqual(got, want) {
		t.Fatalf("unit roots: %v, want %v", got, want)
	}
	// Un linguaggio senza unità resta un server solo, alla radice del progetto.
	if got := unitRoots(session, "java-missing"); !reflect.DeepEqual(got, []string{filepath.Clean(root)}) {
		t.Fatalf("language without units: %v", got)
	}
	for path, expected := range map[string]string{
		filepath.Join(root, "api", "main.unit"):            filepath.Join(root, "api"),
		filepath.Join(root, "worker", "src", "tasks.unit"): filepath.Join(root, "worker"),
		filepath.Join(root, "README.md"):                   filepath.Clean(root),
		filepath.Join(root, "billing", "Main.java"):        filepath.Clean(root),
	} {
		if got := unitRootForPath(session, fakeUnitLanguage{}.ID(), path); got != expected {
			t.Fatalf("%s: routed to %s, want %s", path, got, expected)
		}
	}
}

// Due unità con ambienti diversi hanno due server: ognuno parte dalla radice della sua unità (quindi
// con la sua working directory e la sua spec), riceve solo i propri documenti, e fermarne uno solo
// non è possibile perché lo stop del linguaggio li chiude entrambi.
func TestLanguageServersArePerUnit(t *testing.T) {
	executable, err := os.Executable()
	if err != nil {
		t.Fatal(err)
	}
	registry := language.NewRegistry()
	if err := registry.Register(fakeUnitLanguage{}); err != nil {
		t.Fatal(err)
	}
	manager := NewLSPManager(registry)
	t.Cleanup(manager.Shutdown)

	root := t.TempDir()
	apiRoot, workerRoot := filepath.Join(root, "api"), filepath.Join(root, "worker")
	for _, directory := range []string{apiRoot, workerRoot} {
		if err := os.MkdirAll(directory, 0o755); err != nil {
			t.Fatal(err)
		}
	}
	session := Session{ID: "per-unit", Project: Project{Name: "mono", RootPath: root, RealPath: root, Units: []project.Unit{
		{Language: "unitpy", Kind: "python-project", Root: apiRoot},
		{Language: "unitpy", Kind: "python-project", Root: workerRoot},
	}}}
	apiDocument := filepath.Join(apiRoot, "main.unit")
	if err := os.WriteFile(apiDocument, []byte("print(1)\n"), 0o644); err != nil {
		t.Fatal(err)
	}
	// Il servizio traccia i documenti prima di avviare il server: il documento deve già finire
	// nell'unità che lo contiene, altrimenti resterebbe orfano sul server della radice.
	manager.TrackDocument(session, Document{ID: "api-main", SessionID: session.ID, URI: fileURI(apiDocument), Path: apiDocument}, "print(1)\n", false)

	environment := append(os.Environ(), fakeGoplsEnv+"=1")
	perUnit := func(unitRoot string) (LanguageServerOptions, error) {
		return LanguageServerOptions{Language: "unitpy", Name: "fake-pyright", Binary: executable, Arguments: []string{unitRoot}, Environment: environment}, nil
	}
	if _, err := manager.Start(session, LanguageServerOptions{Language: "unitpy", Name: "fake-pyright", Binary: executable, Environment: environment, PerUnitSpec: perUnit}); err != nil {
		t.Fatal(err)
	}

	states := manager.statesOf(session.ID, "unitpy")
	if len(states) != 2 {
		t.Fatalf("%d language servers, want one per unit", len(states))
	}
	byUnit := map[string]*lspSession{}
	for _, state := range states {
		state.mu.Lock()
		unit, serverRoot, pid, status := state.unit, state.root, state.status.PID, state.status.State
		state.mu.Unlock()
		byUnit[unit] = state
		if serverRoot != unit {
			t.Fatalf("server for unit %s runs from %s", unit, serverRoot)
		}
		if pid == 0 || status != LanguageServerReady {
			t.Fatalf("unit %s not ready: pid %d, state %s", unit, pid, status)
		}
	}
	if byUnit[apiRoot] == nil || byUnit[workerRoot] == nil {
		t.Fatalf("missing unit servers: %v", byUnit)
	}

	// Ogni server riceve la propria radice come argomento e solo i propri documenti.
	apiLog := strings.Join(manager.Log(session.ID, "unitpy"), "\n")
	if !strings.Contains(apiLog, "[api]") || !strings.Contains(apiLog, "[worker]") {
		t.Fatalf("log does not distinguish the units:\n%s", apiLog)
	}
	byUnit[apiRoot].mu.Lock()
	_, trackedOnAPI := byUnit[apiRoot].documents["api-main"]
	byUnit[apiRoot].mu.Unlock()
	byUnit[workerRoot].mu.Lock()
	_, trackedOnWorker := byUnit[workerRoot].documents["api-main"]
	byUnit[workerRoot].mu.Unlock()
	if !trackedOnAPI || trackedOnWorker {
		t.Fatalf("document tracked on api=%t, worker=%t", trackedOnAPI, trackedOnWorker)
	}
	if state, _ := manager.forPath(session.ID, apiDocument); state != byUnit[apiRoot] {
		t.Fatal("the document is not routed to the server of its unit")
	}
	if status := manager.Status(session.ID, "unitpy"); status.State != LanguageServerReady || status.PID == 0 {
		t.Fatalf("aggregate status: %+v", status)
	}

	manager.Stop(session.ID, "unitpy")
	deadline := time.Now().Add(5 * time.Second)
	for time.Now().Before(deadline) {
		stopped := true
		for _, state := range manager.statesOf(session.ID, "unitpy") {
			state.mu.Lock()
			stopped = stopped && state.status.PID == 0 && state.status.State == LanguageServerStopped
			state.mu.Unlock()
		}
		if stopped {
			return
		}
		time.Sleep(25 * time.Millisecond)
	}
	t.Fatal("stopping the language did not stop every unit server")
}
