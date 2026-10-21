package python

import (
	"context"
	"encoding/json"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"adomnia/internal/ide/language"
	"adomnia/internal/ide/run"
)

func writeFile(t *testing.T, root, name, text string) string {
	t.Helper()
	path := filepath.Join(root, name)
	if err := os.MkdirAll(filepath.Dir(path), 0755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(path, []byte(text), 0644); err != nil {
		t.Fatal(err)
	}
	return path
}

func TestDetectionKeepsNestedProjectsAndSkipsEnvironments(t *testing.T) {
	root := t.TempDir()
	for _, name := range []string{"pyproject.toml", "src/pkg/__init__.py", "src/pkg/main.py", "tests/test_app.py", "service/pyproject.toml", "service/app.py", ".venv/lib/installed.py", "venv/lib/installed.py"} {
		writeFile(t, root, name, "not executed")
	}
	units, err := New().DetectUnits(context.Background(), root)
	if err != nil {
		t.Fatal(err)
	}
	if len(units) != 2 || units[0].Root != root || units[1].Root != filepath.Join(root, "service") {
		t.Fatalf("unexpected units: %+v", units)
	}
	ctx, cancel := context.WithCancel(context.Background())
	cancel()
	if _, err := New().DetectUnits(ctx, root); err == nil {
		t.Fatal("ignored cancellation")
	}
}

func TestLooseScriptsAndCapabilities(t *testing.T) {
	root := t.TempDir()
	writeFile(t, root, "scripts/a.py", "raise Exception('must not execute')")
	writeFile(t, root, "scripts/pkg/b.py", "")
	units, err := New().DetectUnits(context.Background(), root)
	if err != nil || len(units) != 1 || units[0].Kind != "python-scripts" {
		t.Fatalf("%+v %v", units, err)
	}
	caps := language.CapabilitiesOf(New())
	if !caps.Run || !caps.Documents || !caps.ProjectDetection || !caps.Tests || !caps.Debug || !caps.LanguageServer || caps.Usages || caps.Declarations {
		t.Fatalf("false capability claims: %+v", caps)
	}
	for _, path := range []string{"a.py", "a.pyi", "a.PY"} {
		if id, ok := New().DocumentLanguageID(path); !ok || id != ID {
			t.Fatal(path)
		}
	}
}

func TestRunValidationAndConfinement(t *testing.T) {
	root := t.TempDir()
	interpreter := writeFile(t, root, "python.exe", "")
	writeFile(t, root, "hello world.py", "")
	for _, tc := range []struct {
		kind    string
		options Options
		valid   bool
	}{
		{"script", Options{Interpreter: interpreter, Script: "hello world.py"}, true},
		{"module", Options{Interpreter: interpreter, Module: "pkg.main"}, true},
		{"module", Options{Interpreter: interpreter, Module: "-c"}, false},
		{"script", Options{Interpreter: interpreter, Script: "-c.py"}, false},
		{"script", Options{Interpreter: interpreter, Script: writeFile(t, t.TempDir(), "outside.py", "")}, false},
		{"module", Options{Interpreter: "python", Module: "pkg"}, false},
		{"unknown", Options{Interpreter: interpreter}, false},
	} {
		data, _ := json.Marshal(tc.options)
		spec, err := New().CommandSpec(run.Request{Kind: tc.kind, Root: root, WorkingDirectory: root, LanguageOptions: data, ProgramArguments: []string{"hello world", "$(no shell)"}})
		if (err == nil) != tc.valid {
			t.Fatalf("%+v: %v", tc, err)
		}
		if err == nil && (spec.Arguments[len(spec.Arguments)-1] != "$(no shell)" || spec.Arguments[0] != "-u") {
			t.Fatalf("argv corrupted: %+v", spec)
		}
	}
}

// TestRunStopEndsARealPythonProcess: cancellare un run reale termina l'albero del processo e
// l'esecuzione risulta fermata, non completata (PY-3.5).
func TestRunStopEndsARealPythonProcess(t *testing.T) {
	interpreter, err := exec.LookPath("python")
	if err != nil {
		t.Skip("Python interpreter unavailable")
	}
	root := t.TempDir()
	writeFile(t, root, "slow.py", "import time\nprint('started', flush=True)\ntime.sleep(60)\n")
	data, _ := json.Marshal(Options{Interpreter: interpreter, Script: "slow.py"})
	spec, err := New().CommandSpec(run.Request{Kind: "script", Root: root, WorkingDirectory: root, LanguageOptions: data})
	if err != nil {
		t.Fatal(err)
	}
	processes := run.NewProcessManager()
	t.Cleanup(processes.Shutdown)
	started, err := processes.Start(run.CommandSpec{
		SessionID: "python-cancel", Kind: "run", Executable: spec.Executable, Arguments: spec.Arguments,
		WorkingDirectory: spec.WorkingDirectory, Environment: spec.Environment,
	})
	if err != nil {
		t.Fatal(err)
	}
	// Il processo resta in esecuzione finché non lo si ferma: lo stop deve chiudere l'albero.
	time.Sleep(300 * time.Millisecond)
	if err := processes.Stop(started.ID); err != nil {
		t.Fatal(err)
	}
	if !processes.WaitStopped(started.ID, 15*time.Second) {
		t.Fatalf("the Python process survived the stop: %+v", started)
	}
}

func TestRunRealScriptAndModule(t *testing.T) {
	interpreter, err := exec.LookPath("python")
	if err != nil {
		t.Skip("Python interpreter unavailable")
	}
	if output, err := exec.Command(interpreter, "--version").CombinedOutput(); err != nil || !strings.HasPrefix(string(output), "Python 3.") {
		t.Skip("Python 3 unavailable")
	}
	root := t.TempDir()
	writeFile(t, root, "app.py", "import sys\nprint(sys.argv[1], end='')\n")
	for _, kind := range []string{"script", "module"} {
		data, _ := json.Marshal(Options{Interpreter: interpreter, Script: "app.py", Module: "app"})
		spec, err := New().CommandSpec(run.Request{Kind: kind, Root: root, WorkingDirectory: root, LanguageOptions: data, ProgramArguments: []string{"hello space è"}})
		if err != nil {
			t.Fatal(err)
		}
		ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
		cmd := exec.CommandContext(ctx, spec.Executable, spec.Arguments...)
		cmd.Dir = spec.WorkingDirectory
		output, err := cmd.CombinedOutput()
		cancel()
		// Python uses the console encoding on Windows unless UTF-8 mode is enabled.
		if err != nil || !strings.HasPrefix(string(output), "hello space ") {
			t.Fatalf("%s: %q %v", kind, output, err)
		}
	}
}
