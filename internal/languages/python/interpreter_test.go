package python

import (
	"context"
	"encoding/json"
	"os"
	"os/exec"
	"path/filepath"
	"regexp"
	"runtime"
	"strings"
	"testing"
	"time"

	"adomnia/internal/ide/run"
)

// envInterpreterPath è il layout dell'interprete dentro un ambiente sulla piattaforma corrente.
func envInterpreterPath(directory string) string {
	name := filepath.Join("bin", "python")
	if runtime.GOOS == "windows" {
		name = filepath.Join("Scripts", "python.exe")
	}
	return filepath.Join(directory, name)
}

// TestManagedEnvironmentsAreListedButNeverChosen: gli ambienti di uv e Poetry si trovano dalla
// configurazione e dai nomi delle cartelle, senza eseguire i gestori, e restano una scelta
// esplicita dell'utente (PY-2.1).
func TestManagedEnvironmentsAreListedButNeverChosen(t *testing.T) {
	root := t.TempDir()
	uv := filepath.Join(root, "uv-env")
	writeFile(t, uv, filepath.Join("Scripts", "python.exe"), "")
	writeFile(t, uv, filepath.Join("bin", "python"), "")
	t.Setenv("UV_PROJECT_ENVIRONMENT", "uv-env")

	poetryBase := t.TempDir()
	poetry := filepath.Join(poetryBase, poetryProjectPrefix(root)+"-9f2c1a-py3.11")
	writeFile(t, poetry, filepath.Join("Scripts", "python.exe"), "")
	writeFile(t, poetry, filepath.Join("bin", "python"), "")
	t.Setenv("POETRY_VIRTUALENVS_PATH", poetryBase)
	t.Setenv("VIRTUAL_ENV", "")

	found := map[string]Interpreter{}
	for _, candidate := range DiscoverInterpreters(root, root) {
		found[candidate.Source] = candidate
	}
	if uvCandidate, ok := found["uv"]; !ok || !strings.Contains(uvCandidate.Problem, "choose it explicitly") {
		t.Fatalf("uv environment missing or implicit: %#v", found)
	}
	if poetryCandidate, ok := found["poetry"]; !ok || !strings.Contains(poetryCandidate.Problem, "choose it explicitly") {
		t.Fatalf("poetry environment missing or implicit: %#v", found)
	}
	resolved, err := ResolveInterpreter(root, root, "")
	if err == nil && (resolved.Source == "uv" || resolved.Source == "poetry") {
		t.Fatalf("a managed environment was chosen implicitly: %+v", resolved)
	}
}

// TestPoetryPathFromProjectConfig legge `[virtualenvs] path` da poetry.toml, relativo al progetto.
func TestPoetryPathFromProjectConfig(t *testing.T) {
	root := t.TempDir()
	writeFile(t, root, "poetry.toml", "[virtualenvs]\npath = \"envs\"\n")
	if got, want := poetryVirtualenvsPath(root), filepath.Join(root, "envs"); got != want {
		t.Fatalf("path %q, want %q", got, want)
	}
}

func TestCheckRequiresPython(t *testing.T) {
	for _, test := range []struct {
		version, requires string
		incompatible      bool
	}{
		{"3.11.2", ">=3.11", false},
		{"3.9.7", ">=3.11", true},
		{"3.8.0", ">=3.8,<3.13", false},
		{"3.13.1", ">=3.8,<3.13", true},
		{"3.10.4", "~=3.10", false},
		{"3.9.1", "~=3.10", true},
		{"4.0.0", "~=3.10", true},
		{"3.10.1", "~=3.10.1", false},
		{"3.10.0", "~=3.10.1", true},
		{"3.11.5", "==3.11.*", false},
		{"3.12.0", "==3.11.*", true},
		{"3.9.2", "!=3.9.*", true},
		{"3.11.2", "!=3.9.*", false},
		{"3.11.2", ">=3.11,!=3.11.1", false},
		{"3.11.1", ">=3.11,!=3.11.1", true},
		{"3.12.0rc1", ">=3.11", false},
		{"", ">=3.11", false},
		{"3.11.2", "", false},
		{"3.11.2", ">=3.11 || <3", false},
		{"3.11.2", "~=3", false},
	} {
		problem := CheckRequiresPython(test.version, test.requires)
		if (problem != "") != test.incompatible {
			t.Fatalf("CheckRequiresPython(%q, %q) = %q, incompatible=%v", test.version, test.requires, problem, test.incompatible)
		}
		if problem != "" && !strings.Contains(problem, test.requires) {
			t.Fatalf("the problem must show the constraint: %q", problem)
		}
	}
}

func TestFlagIncompatibleMarksOnlyTheProbedCandidates(t *testing.T) {
	flagged := FlagIncompatible([]Interpreter{
		{Path: "old", Version: "3.9.7", Problem: "this environment is activated outside the project"},
		{Path: "new", Version: "3.11.2"},
		{Path: "unprobed"},
	}, ">=3.11")
	if !strings.Contains(flagged[0].Problem, "does not satisfy") || !strings.HasPrefix(flagged[0].Problem, "this environment is activated outside the project; ") {
		t.Fatalf("problems must stack: %q", flagged[0].Problem)
	}
	if flagged[1].Problem != "" || flagged[2].Problem != "" {
		t.Fatalf("false positives: %+v", flagged)
	}
}

// TestProbeReportsVersionPackagesAndArchitecture esegue il probe reale: versione 3.x,
// architettura "macchina N-bit" e strumenti presenti senza leggere pip.
func TestProbeReportsVersionPackagesAndArchitecture(t *testing.T) {
	interpreter, ok := realInterpreter(t)
	if !ok {
		return
	}
	info, err := readInterpreterInfo(interpreter)
	if err != nil {
		t.Fatal(err)
	}
	if !strings.HasPrefix(info.Version, "3.") {
		t.Fatalf("version = %q", info.Version)
	}
	if !regexp.MustCompile(`^\S+ \d+-bit$`).MatchString(info.Architecture) {
		t.Fatalf("architecture = %q", info.Architecture)
	}
	if info.Executable == "" || info.Prefix == "" {
		t.Fatalf("%+v", info)
	}
	if _, ok := info.Packages["pytest"]; !ok {
		t.Fatalf("packages = %#v", info.Packages)
	}
}

// TestProbeTimesOutOnAStuckInterpreter prova PY-2.6: un interprete bloccato non deve fermare
// la lista, resta segnalato come non rispondente.
func TestProbeTimesOutOnAStuckInterpreter(t *testing.T) {
	stuck := stuckInterpreter(t)
	previous := interpreterProbeTimeout
	interpreterProbeTimeout = 200 * time.Millisecond
	defer func() { interpreterProbeTimeout = previous }()
	start := time.Now()
	info, err := readInterpreterInfo(stuck)
	elapsed := time.Since(start)
	if err == nil || info.Version != "" {
		t.Fatalf("a stuck interpreter must not answer: %+v %v", info, err)
	}
	if elapsed > 5*time.Second {
		t.Fatalf("probe waited %v, the timeout did not fire", elapsed)
	}
	flagged := ProbeInterpreters([]Interpreter{{Path: stuck}})
	if !strings.Contains(flagged[0].Problem, "version probe") {
		t.Fatalf("%+v", flagged)
	}
}

// TestTwoUnitsWithDifferentEnvironmentsRunInIsolation è la fixture end-to-end di PY-0.4/PY-2.6:
// due unità con ambienti diversi (un modulo ciascuno, solo nel proprio) nello stesso test;
// ogni run usa l'interprete della sua unità e non vede l'altro ambiente.
func TestTwoUnitsWithDifferentEnvironmentsRunInIsolation(t *testing.T) {
	base, ok := realInterpreter(t)
	if !ok {
		return
	}
	root := t.TempDir()
	for _, unit := range []struct{ name, marker string }{{"orders", "A"}, {"billing", "B"}} {
		directory := filepath.Join(root, unit.name)
		writeFile(t, directory, "pyproject.toml", "[project]\nname = '"+unit.name+"'\n")
		writeFile(t, directory, "app.py", "import envmark\nprint(envmark.name, end='')\n")
		createEnvironment(t, base, directory, unit.marker)
	}
	for _, unit := range []struct{ name, marker string }{{"orders", "A"}, {"billing", "B"}} {
		directory := filepath.Join(root, unit.name)
		resolved, err := ResolveInterpreter(root, directory, "")
		if err != nil {
			t.Fatal(err)
		}
		if !strings.Contains(filepath.ToSlash(resolved.Path), unit.name+"/venv") {
			t.Fatalf("%s resolved %q instead of its own environment", unit.name, resolved.Path)
		}
		data := mustJSON(t, Options{Script: "app.py"})
		spec, err := New().CommandSpec(runRequest(unit.name, root, data))
		if err != nil {
			t.Fatal(err)
		}
		output, err := runSpec(t, spec)
		if err != nil || output != unit.marker {
			t.Fatalf("%s ran with the wrong environment: %q %v", unit.name, output, err)
		}
	}
}

// TestSavedInterpreterFromAnotherMachineFallsBack è il restore di PY-2.6: una scelta salvata che
// su questa macchina non esiste più non blocca, si torna all'ambiente del progetto.
func TestSavedInterpreterFromAnotherMachineFallsBack(t *testing.T) {
	root := t.TempDir()
	unit := filepath.Join(root, "ml")
	writeFile(t, unit, "venv/Scripts/python.exe", "")
	writeFile(t, unit, "venv/bin/python", "")
	missing := writeFile(t, t.TempDir(), "python.exe", "")
	if err := SetProjectInterpreter(root, unit, missing); err != nil {
		t.Fatal(err)
	}
	if err := os.Remove(missing); err != nil {
		t.Fatal(err)
	}
	found, err := ResolveInterpreter(root, unit, "")
	if err != nil || found.Source != "project" {
		t.Fatalf("%+v %v", found, err)
	}
}

// realInterpreter è il Python 3 usato dai test reali; false = test saltato con motivo.
func realInterpreter(t *testing.T) (string, bool) {
	t.Helper()
	interpreter, err := exec.LookPath("python")
	if err != nil {
		t.Skip("Python interpreter unavailable")
		return "", false
	}
	return interpreter, true
}

// createEnvironment crea l'ambiente di un'unità senza pip e ci mette dentro un modulo `envmark`
// con un contenuto diverso per unità: serve a provare che ogni run veda solo il suo ambiente.
func createEnvironment(t *testing.T, interpreter, unitDirectory, marker string) {
	t.Helper()
	environment := filepath.Join(unitDirectory, "venv")
	ctx, cancel := context.WithTimeout(context.Background(), 2*time.Minute)
	defer cancel()
	command := exec.CommandContext(ctx, interpreter, "-m", "venv", "--without-pip", environment)
	if output, err := command.CombinedOutput(); err != nil {
		t.Fatalf("cannot create %s: %v %s", environment, err, output)
	}
	writeFile(t, sitePackages(t, environment), "envmark.py", "name = '"+marker+"'\n")
}

// sitePackages è la cartella dei pacchetti di un ambiente: `Lib` su Windows, `lib/pythonX.Y` altrove.
func sitePackages(t *testing.T, environment string) string {
	t.Helper()
	if runtime.GOOS == "windows" {
		return filepath.Join(environment, "Lib", "site-packages")
	}
	matches, err := filepath.Glob(filepath.Join(environment, "lib", "python*", "site-packages"))
	if err != nil || len(matches) != 1 {
		t.Fatalf("site-packages not found in %s: %v %v", environment, matches, err)
	}
	return matches[0]
}

func mustJSON(t *testing.T, options Options) json.RawMessage {
	t.Helper()
	data, err := json.Marshal(options)
	if err != nil {
		t.Fatal(err)
	}
	return data
}

func runRequest(unitName, root string, data json.RawMessage) run.Request {
	return run.Request{Kind: "script", Root: root, WorkingDirectory: filepath.Join(root, unitName), LanguageOptions: data}
}

func runSpec(t *testing.T, spec run.CommandSpec) (string, error) {
	t.Helper()
	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer cancel()
	command := exec.CommandContext(ctx, spec.Executable, spec.Arguments...)
	command.Dir = spec.WorkingDirectory
	output, err := command.CombinedOutput()
	return strings.TrimSpace(string(output)), err
}

// stubInterpreter crea uno script interprete finto: .bat su Windows, sh altrove. Il corpo è lo
// stesso su entrambe le piattaforme, deciso dal chiamante.
func stubInterpreter(t *testing.T, name, windowsBody, unixBody string) string {
	t.Helper()
	if runtime.GOOS == "windows" {
		return writeFile(t, t.TempDir(), name+".bat", windowsBody)
	}
	path := writeFile(t, t.TempDir(), name+".sh", unixBody)
	if err := os.Chmod(path, 0755); err != nil {
		t.Fatal(err)
	}
	return path
}

// stuckInterpreter non risponde mai: serve al timeout del probe (PY-2.6).
func stuckInterpreter(t *testing.T) string {
	return stubInterpreter(t, "stuck", "@echo off\r\nping -n 30 127.0.0.1 > nul\r\n", "#!/bin/sh\nsleep 30\n")
}

// crashInterpreter esce subito con un codice di errore: serve al crash del debug adapter (PY-6.5).
func crashInterpreter(t *testing.T) string {
	return stubInterpreter(t, "crash", "@echo off\r\nexit 1\r\n", "#!/bin/sh\nexit 1\n")
}
