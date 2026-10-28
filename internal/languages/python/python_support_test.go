package python

import (
	"context"
	jsonv1 "encoding/json"
	"encoding/json/v2"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"github.com/Andrea-Cavallo/adOmnia/internal/ide/run"
	idetesting "github.com/Andrea-Cavallo/adOmnia/internal/ide/testing"
	"github.com/Andrea-Cavallo/adOmnia/internal/jsonutil"
)

func TestManifestReadsProjectAndRequirements(t *testing.T) {
	root := t.TempDir()
	writeFile(t, root, "pyproject.toml", "[project]\nname = 'demo'\nrequires-python = '>=3.11'\ndependencies = ['django==5.0']\n\n[project.optional-dependencies]\ntest = ['pytest>=8']\n")
	writeFile(t, root, "requirements.txt", "# commento\nflask==3.0\n-r other.txt\n")
	manifest := readManifest(root)
	if manifest.Name != "demo" || manifest.RequiresPython != ">=3.11" {
		t.Fatalf("%+v", manifest)
	}
	if !manifest.hasDependency("django") || !manifest.hasDependency("pytest") || !manifest.hasDependency("flask") {
		t.Fatalf("%#v %#v", manifest.Dependencies, manifest.DevDependencies)
	}
	if manifest.hasDependency("requests") {
		t.Fatal("declared a dependency that is not there")
	}
}

func TestResolveInterpreterPrefersSavedThenEnvironmentThenPath(t *testing.T) {
	root := t.TempDir()
	unit := filepath.Join(root, "ml")
	writeFile(t, unit, "venv/Scripts/python.exe", "")
	writeFile(t, unit, "venv/bin/python", "")
	saved := writeFile(t, root, "custom-python.exe", "")
	lookPath = func(name string) (string, error) { return filepath.Join(root, "path-python.exe"), nil }
	defer func() { lookPath = execLookPath() }()
	writeFile(t, root, "path-python.exe", "")

	found, err := ResolveInterpreter(root, unit, "")
	if err != nil || !strings.Contains(found.Path, "venv") || found.Source != "project" {
		t.Fatalf("%+v %v", found, err)
	}
	if err := SetProjectInterpreter(root, unit, saved); err != nil {
		t.Fatal(err)
	}
	found, err = ResolveInterpreter(root, unit, "")
	if err != nil || found.Path != filepath.Clean(saved) || found.Source != "saved" {
		t.Fatalf("%+v %v", found, err)
	}
	if ProjectInterpreter(root, unit) != saved {
		t.Fatal("per-unit selection was not persisted")
	}
	if err := SetProjectInterpreter(root, unit, ""); err != nil {
		t.Fatal(err)
	}
	// La scelta per unità rimossa torna all'ambiente locale.
	found, err = ResolveInterpreter(root, unit, "")
	if err != nil || found.Source != "project" {
		t.Fatalf("%+v %v", found, err)
	}
	if err := SetProjectInterpreter(root, "", ""); err != nil {
		t.Fatal(err)
	}
	if ProjectInterpreter(root, unit) != "" {
		t.Fatal("cleared selection still present")
	}
}

func TestDiscoverInterpretersFlagsForeignEnvironment(t *testing.T) {
	root := t.TempDir()
	foreign := t.TempDir()
	writeFile(t, foreign, "venv/Scripts/python.exe", "")
	writeFile(t, foreign, "venv/bin/python", "")
	t.Setenv("VIRTUAL_ENV", filepath.Join(foreign, "venv"))
	lookPath = func(string) (string, error) { return "", os.ErrNotExist }
	defer func() { lookPath = execLookPath() }()
	found := DiscoverInterpreters(root, root)
	if len(found) != 1 || found[0].Source != "VIRTUAL_ENV" || found[0].Problem == "" {
		t.Fatalf("%+v", found)
	}
	if _, err := ResolveInterpreter(root, root, ""); err == nil {
		t.Fatal("an environment outside the project must not be used implicitly")
	}
}

func TestProbeReportsVersionAndPackages(t *testing.T) {
	probeInterpreter = func(binary string) (InterpreterInfo, error) {
		if binary != "python.exe" {
			t.Fatalf("unexpected binary %q", binary)
		}
		return InterpreterInfo{Version: "3.11.0", Executable: binary, Packages: map[string]bool{"pytest": true}}, nil
	}
	defer func() { probeInterpreter = readInterpreterInfo }()
	info, err := probeInterpreter("python.exe")
	if err != nil || info.Version != "3.11.0" || !info.Packages["pytest"] {
		t.Fatalf("%+v %v", info, err)
	}
}

func TestSuggestProposesScriptsFrameworksAndTests(t *testing.T) {
	root := t.TempDir()
	writeFile(t, root, "pyproject.toml", "[project]\nname = 'shop'\ndependencies = ['fastapi', 'uvicorn']\n")
	writeFile(t, root, "main.py", "from fastapi import FastAPI\napp = FastAPI()\n")
	writeFile(t, root, "tests/test_shop.py", "def test_ok():\n    pass\n")
	units, err := New().DetectUnits(context.Background(), root)
	if err != nil || len(units) != 1 {
		t.Fatalf("%+v %v", units, err)
	}
	titles := map[string]bool{}
	var fastapi run.Suggestion
	for _, suggestion := range New().Suggest(context.Background(), root, units[0]) {
		titles[suggestion.Title] = true
		if suggestion.Title == "FastAPI · uvicorn main:app" {
			fastapi = suggestion
		}
	}
	for _, expected := range []string{"FastAPI · uvicorn main:app", "Python · main.py", "Python · pytest"} {
		if !titles[expected] {
			t.Fatalf("missing %q in %#v", expected, titles)
		}
	}
	if len(titles) != 3 {
		t.Fatalf("unexpected suggestions %#v", titles)
	}
	// PY-7.2: host, porta e reload sono campi guidati, non argomenti opachi.
	var options Options
	if err := json.Unmarshal(fastapi.Configuration.LanguageOptions, &options); err != nil {
		t.Fatal(err)
	}
	if options.Module != "uvicorn" || options.App != "main:app" || !options.Reload {
		t.Fatalf("framework options %+v", options)
	}
	if len(fastapi.Configuration.ProgramArguments) != 0 {
		t.Fatalf("framework arguments must come from the guided fields: %+v", fastapi.Configuration.ProgramArguments)
	}
	if err := New().ValidateRunConfiguration(fastapi.Configuration); err != nil {
		t.Fatalf("the suggestion must be valid: %v", err)
	}
}

func TestSuggestKeepsConsoleScriptsUnverified(t *testing.T) {
	root := t.TempDir()
	writeFile(t, root, "pyproject.toml", "[project]\nname = 'shop'\n\n[project.scripts]\nshop = 'shop.cli:main'\n")
	writeFile(t, root, "shop/cli.py", "def main():\n    pass\n")
	units, _ := New().DetectUnits(context.Background(), root)
	for _, suggestion := range New().Suggest(context.Background(), root, units[0]) {
		if strings.Contains(suggestion.Title, "shop") {
			t.Fatalf("an entry point without __main__ must not become python -m: %#v", suggestion)
		}
	}
	writeFile(t, root, "shop/cli.py", "def main():\n    pass\n\nif __name__ == '__main__':\n    main()\n")
	units, _ = New().DetectUnits(context.Background(), root)
	found := false
	for _, suggestion := range New().Suggest(context.Background(), root, units[0]) {
		if suggestion.Title == "Python · shop (python -m shop.cli)" {
			found = true
		}
	}
	if !found {
		t.Fatal("verifiable entry point was not proposed")
	}
}

func TestDjangoDetection(t *testing.T) {
	root := t.TempDir()
	writeFile(t, root, "manage.py", "raise SystemExit\n")
	writeFile(t, root, "site/settings.py", "")
	units, _ := New().DetectUnits(context.Background(), root)
	titles := []string{}
	for _, suggestion := range New().Suggest(context.Background(), root, units[0]) {
		titles = append(titles, suggestion.Title)
	}
	if len(titles) != 1 || titles[0] != "Django · manage.py runserver" {
		t.Fatalf("%#v", titles)
	}
}

// eventsOf scrive il file di eventi e lo legge con il parser come farebbe il manager.
func eventsOf(t *testing.T, root, content string) []idetesting.Event {
	t.Helper()
	path := filepath.Join(t.TempDir(), "events.jsonl")
	if err := os.WriteFile(path, []byte(content), 0o644); err != nil {
		t.Fatal(err)
	}
	parser := newPytestParser(root, path)
	events := parser.ParseAll([]byte("adomnia: pytest events recorded"))
	return events
}

func TestPytestParserBuildsTreeFromRealPluginEvents(t *testing.T) {
	root := t.TempDir()
	file := filepath.Join(root, "tests", "test_demo.py")
	events := eventsOf(t, root, strings.Join([]string{
		`{"event": "collect", "nodeid": "tests/test_demo.py::test_plain", "file": ` + jsonPath(file) + `}`,
		`{"event": "collect", "nodeid": "tests/test_demo.py::TestBox::test_ok[param/1]", "file": ` + jsonPath(file) + `}`,
		`{"event": "report", "nodeid": "tests/test_demo.py::test_plain", "file": ` + jsonPath(file) + `, "when": "setup", "outcome": "passed", "duration": 0.001, "line": 3}`,
		`{"event": "report", "nodeid": "tests/test_demo.py::test_plain", "file": ` + jsonPath(file) + `, "when": "call", "outcome": "passed", "duration": 0.002, "line": 3}`,
		`{"event": "report", "nodeid": "tests/test_demo.py::test_plain", "file": ` + jsonPath(file) + `, "when": "teardown", "outcome": "passed", "duration": 0.001, "line": 3}`,
		`{"event": "report", "nodeid": "tests/test_demo.py::TestBox::test_ok[param/1]", "file": ` + jsonPath(file) + `, "when": "call", "outcome": "failed", "duration": 0.003, "line": 9, "longrepr": "assert 1 == 2"}`,
		`{"event": "report", "nodeid": "tests/test_demo.py::TestBox::test_ok[param/1]", "file": ` + jsonPath(file) + `, "when": "teardown", "outcome": "passed", "duration": 0.001, "line": 7}`,
		`{"event": "end"}`,
	}, "\n")+"\n")
	tree := idetesting.NewTree()
	for _, event := range events {
		tree.Apply(event)
	}
	results, summary := tree.Snapshot()
	if summary.Passed != 1 || summary.Failed != 1 {
		t.Fatalf("summary %+v results %+v", summary, results)
	}
	names := map[string]string{}
	for _, result := range results {
		names[result.ID] = result.Status
	}
	// "/" nel node ID resta ∕: l'albero lo usa per i sottotest.
	for _, expected := range []string{"tests/test_demo.py\x00test_plain", "tests/test_demo.py\x00TestBox", "tests/test_demo.py\x00TestBox/test_ok[param∕1]"} {
		if _, ok := names[expected]; !ok {
			t.Fatalf("missing %q in %#v", expected, names)
		}
	}
	if names["tests/test_demo.py\x00TestBox/test_ok[param∕1]"] != "fail" {
		t.Fatalf("%#v", names)
	}
}

// TestPytestParserKeepsCapturedOutput: lo stdout/stderr catturato da pytest resta nell'output del
// singolo test, anche quando il test passa (PY-5.4).
func TestPytestParserKeepsCapturedOutput(t *testing.T) {
	root := t.TempDir()
	file := filepath.Join(root, "tests", "test_prints.py")
	events := eventsOf(t, root, strings.Join([]string{
		`{"event": "collect", "nodeid": "tests/test_prints.py::test_ok", "file": ` + jsonPath(file) + `}`,
		`{"event": "collect", "nodeid": "tests/test_prints.py::test_bad", "file": ` + jsonPath(file) + `}`,
		`{"event": "report", "nodeid": "tests/test_prints.py::test_ok", "file": ` + jsonPath(file) + `, "when": "call", "outcome": "passed", "duration": 0.001, "capstdout": "hello from stdout\n"}`,
		`{"event": "report", "nodeid": "tests/test_prints.py::test_ok", "file": ` + jsonPath(file) + `, "when": "teardown", "outcome": "passed", "duration": 0.001}`,
		`{"event": "report", "nodeid": "tests/test_prints.py::test_bad", "file": ` + jsonPath(file) + `, "when": "call", "outcome": "failed", "duration": 0.001, "line": 7, "longrepr": "assert False", "capstdout": "before the failure", "capstderr": "warning text"}`,
		`{"event": "report", "nodeid": "tests/test_prints.py::test_bad", "file": ` + jsonPath(file) + `, "when": "teardown", "outcome": "passed", "duration": 0.001}`,
		`{"event": "end"}`,
	}, "\n")+"\n")
	tree := idetesting.NewTree()
	for _, event := range events {
		tree.Apply(event)
	}
	results, summary := tree.Snapshot()
	if summary.Passed != 1 || summary.Failed != 1 {
		t.Fatalf("summary %+v results %+v", summary, results)
	}
	output := map[string]string{}
	for _, result := range results {
		output[result.ID] = result.Output
	}
	passed := output["tests/test_prints.py\x00test_ok"]
	if !strings.Contains(passed, "--- stdout ---") || !strings.Contains(passed, "hello from stdout") {
		t.Fatalf("passed test output %q", passed)
	}
	failed := output["tests/test_prints.py\x00test_bad"]
	for _, want := range []string{"assert False", "--- stdout ---", "before the failure", "--- stderr ---", "warning text"} {
		if !strings.Contains(failed, want) {
			t.Fatalf("failed test output %q misses %q", failed, want)
		}
	}
}

func TestPytestParserCollectErrorMarksFile(t *testing.T) {
	root := t.TempDir()
	file := filepath.Join(root, "tests", "test_broken.py")
	events := eventsOf(t, root, `{"event": "collecterror", "nodeid": "tests/test_broken.py", "file": `+jsonPath(file)+`, "longrepr": "ImportError: nope"}`+"\n"+`{"event": "end"}`+"\n")
	tree := idetesting.NewTree()
	for _, event := range events {
		tree.Apply(event)
	}
	results, _ := tree.Snapshot()
	if len(results) != 1 || !results[0].BuildFailed || !strings.Contains(results[0].Output, "ImportError") {
		t.Fatalf("%+v", results)
	}
}

// TestPytestParserFinishesUnfinishedTests: un run annullato non manda il marcatore finale; il
// parser chiude i test rimasti aperti come skip con il motivo, una sola volta (PY-5.6).
func TestPytestParserFinishesUnfinishedTests(t *testing.T) {
	root := t.TempDir()
	file := filepath.Join(root, "tests", "test_slow.py")
	path := filepath.Join(t.TempDir(), "events.jsonl")
	content := strings.Join([]string{
		`{"event": "collect", "nodeid": "tests/test_slow.py::test_slow", "file": ` + jsonPath(file) + `}`,
		`{"event": "report", "nodeid": "tests/test_slow.py::test_slow", "file": ` + jsonPath(file) + `, "when": "call", "outcome": "passed", "duration": 0.001, "line": 2}`,
	}, "\n") + "\n"
	if err := os.WriteFile(path, []byte(content), 0o644); err != nil {
		t.Fatal(err)
	}
	parser := newPytestParser(root, path)
	parser.ParseAll([]byte("still running"))
	events := parser.Finish()
	if events == nil || parser.Finish() != nil {
		t.Fatalf("finish must close the tree exactly once: %v", events)
	}
	tree := idetesting.NewTree()
	for _, event := range events {
		tree.Apply(event)
	}
	results, summary := tree.Snapshot()
	if summary.Skipped != 1 || summary.Running != 0 {
		t.Fatalf("summary %+v results %+v", summary, results)
	}
	for _, result := range results {
		if result.Name == "test_slow" && !strings.Contains(result.Output, "the run ended before this test finished") {
			t.Fatalf("output %q", result.Output)
		}
	}
}

// TestPytestParserKeepsUnicodeNodeIDs: nomi e parametri Unicode arrivano intatti dal plugin (che
// scrive UTF-8) e restano l'identità del nodo per il rerun (PY-5.6).
func TestPytestParserKeepsUnicodeNodeIDs(t *testing.T) {
	root := t.TempDir()
	file := filepath.Join(root, "tests", "test_città.py")
	node := "tests/test_città.py::test_valori[però/1]"
	path := filepath.Join(t.TempDir(), "events.jsonl")
	content := strings.Join([]string{
		`{"event": "collect", "nodeid": ` + jsonPath(node) + `, "file": ` + jsonPath(file) + `}`,
		`{"event": "report", "nodeid": ` + jsonPath(node) + `, "file": ` + jsonPath(file) + `, "when": "call", "outcome": "passed", "duration": 0.001, "line": 2}`,
		`{"event": "report", "nodeid": ` + jsonPath(node) + `, "file": ` + jsonPath(file) + `, "when": "teardown", "outcome": "passed", "duration": 0.001}`,
		`{"event": "end"}`,
	}, "\n") + "\n"
	if err := os.WriteFile(path, []byte(content), 0o644); err != nil {
		t.Fatal(err)
	}
	tree := idetesting.NewTree()
	for _, event := range newPytestParser(root, path).ParseAll([]byte("adomnia: pytest events recorded")) {
		tree.Apply(event)
	}
	results, _ := tree.Snapshot()
	for _, result := range results {
		if strings.Contains(result.Name, "test_valori[però∕1]") && strings.Contains(result.Package, "test_città.py") {
			return
		}
	}
	t.Fatalf("the Unicode node id was lost: %+v", results)
}

func TestTestCommandBuildsPytestInvocation(t *testing.T) {
	root := t.TempDir()
	interpreter := writeFile(t, root, "python.exe", "")
	writeFile(t, root, "tests/test_a.py", "")
	data, _ := jsonutil.Marshal(TestOptions{Interpreter: interpreter, Packages: []string{"tests/test_a.py", "tests/test_b.py::TestX::test_y"}, Run: "k:slow"})
	spec, eventParser, err := New().TestCommand(idetesting.Request{Root: root, WorkingDirectory: root, LanguageOptions: data})
	if err != nil {
		t.Fatal(err)
	}
	if joined := strings.Join(spec.Arguments, " "); joined != "-m pytest -p adomnia_pytest_events tests/test_a.py tests/test_b.py::TestX::test_y -k slow" {
		t.Fatalf("arguments %q", joined)
	}
	if eventParser == nil || !strings.Contains(strings.Join(spec.Environment, ";"), "PYTHONPATH=") {
		t.Fatalf("parser or PYTHONPATH missing: %+v", spec.Environment)
	}
	if _, _, err := New().TestCommand(idetesting.Request{Root: root, WorkingDirectory: root, LanguageOptions: jsonv1.RawMessage(`{"run":"--cov"}`)}); err == nil {
		t.Fatal("a test id shaped like an option must be rejected")
	}
}

// jsonPath rende un percorso un valido literal JSON, come scrive il plugin.
func jsonPath(path string) string {
	data, _ := jsonutil.Marshal(path)
	return string(data)
}

// execLookPath cattura l'implementazione reale prima dei test che la sostituiscono.
func execLookPath() func(string) (string, error) { return lookPathDefault }

var lookPathDefault = lookPath
