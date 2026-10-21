package python

import (
	"bytes"
	"context"
	"encoding/json"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"adomnia/internal/ide/dap"
	idetesting "adomnia/internal/ide/testing"
)

func TestDebugAdapterBuildsDebugpyLaunch(t *testing.T) {
	root := t.TempDir()
	interpreter := writeFile(t, root, "python.exe", "")
	writeFile(t, root, "hello.py", "print('hi')\n")
	no := false
	data, _ := json.Marshal(DebugOptions{Interpreter: interpreter, Kind: "script", Script: "hello.py", ProgramArguments: []string{"--flag"}, JustMyCode: &no})
	spec, err := New().DebugAdapter(dap.LaunchRequest{Root: root, WorkingDirectory: root, Environment: []string{"A=1"}, LanguageOptions: data})
	if err != nil {
		t.Fatal(err)
	}
	joined := strings.Join(spec.Arguments, " ")
	if spec.Executable != filepath.Clean(interpreter) || !strings.Contains(joined, "-m debugpy --listen 127.0.0.1:") || !strings.Contains(joined, "--wait-for-client") || !strings.HasSuffix(joined, "hello.py --flag") {
		t.Fatalf("arguments %q", joined)
	}
	if !strings.HasPrefix(spec.Address, "127.0.0.1:") || spec.Address == "127.0.0.1:0" {
		t.Fatalf("address %q", spec.Address)
	}
	command, arguments := spec.Launch("")
	if command != "attach" || arguments["justMyCode"] != false || arguments["redirectOutput"] != false {
		t.Fatalf("%s %#v", command, arguments)
	}
	if spec.Detach || spec.Title != "Debug hello.py" {
		t.Fatalf("%+v", spec)
	}
	// Il modulo segue la stessa validazione della run.
	data, _ = json.Marshal(DebugOptions{Interpreter: interpreter, Kind: "module", Module: "-c"})
	if _, err := New().DebugAdapter(dap.LaunchRequest{Root: root, WorkingDirectory: root, LanguageOptions: data}); err == nil {
		t.Fatal("an option-shaped module name must be rejected")
	}
	// E lo script fuori dal progetto resta confinato.
	outside := writeFile(t, t.TempDir(), "outside.py", "")
	data, _ = json.Marshal(DebugOptions{Interpreter: interpreter, Kind: "script", Script: outside})
	if _, err := New().DebugAdapter(dap.LaunchRequest{Root: root, WorkingDirectory: root, LanguageOptions: data}); err == nil {
		t.Fatal("a script outside the project must be rejected")
	}
}

func TestDebugAdapterPytestSelection(t *testing.T) {
	root := t.TempDir()
	interpreter := writeFile(t, root, "python.exe", "")
	writeFile(t, root, "tests/test_demo.py", "")
	data, _ := json.Marshal(DebugOptions{Interpreter: interpreter, Kind: "pytest", Targets: []string{"tests/test_demo.py::TestX::test_y[1]"}, Run: "k:slow"})
	spec, err := New().DebugAdapter(dap.LaunchRequest{Root: root, WorkingDirectory: root, LanguageOptions: data})
	if err != nil {
		t.Fatal(err)
	}
	joined := strings.Join(spec.Arguments, " ")
	if !strings.Contains(joined, "-m pytest tests/test_demo.py::TestX::test_y[1] -k slow") {
		t.Fatalf("arguments %q", joined)
	}
	data, _ = json.Marshal(DebugOptions{Interpreter: interpreter, Kind: "pytest", Targets: []string{"--pdb"}})
	if _, err := New().DebugAdapter(dap.LaunchRequest{Root: root, WorkingDirectory: root, LanguageOptions: data}); err == nil {
		t.Fatal("an option-shaped test target must be rejected")
	}
}

func TestDebugArgumentsDropTheReloader(t *testing.T) {
	root := t.TempDir()
	interpreter := writeFile(t, root, "python.exe", "")
	writeFile(t, root, "manage.py", "")
	manage, err := resolveScript(root, root, "manage.py")
	if err != nil {
		t.Fatal(err)
	}
	targets := func(options DebugOptions) []string {
		t.Helper()
		data, _ := json.Marshal(options)
		spec, err := New().DebugAdapter(dap.LaunchRequest{Root: root, WorkingDirectory: root, LanguageOptions: data})
		if err != nil {
			t.Fatal(err)
		}
		// Dopo `-u -m debugpy --listen <addr> --wait-for-client` ci sono i target del programma.
		return spec.Arguments[6:]
	}
	for _, test := range []struct {
		name    string
		options DebugOptions
		want    []string
		banned  []string
	}{
		{
			name:    "uvicorn without the reloader",
			options: DebugOptions{Interpreter: interpreter, Kind: "module", Module: "uvicorn", ProgramArguments: []string{"app:app", "--reload", "--reload-dir", "extra", "--reload-dir=src", "--port", "8000"}},
			want:    []string{"-m", "uvicorn", "app:app", "--port", "8000"},
			banned:  []string{"--reload", "extra", "--reload-dir=src"},
		},
		{
			name:    "flask without debug mode and reloader",
			options: DebugOptions{Interpreter: interpreter, Kind: "module", Module: "flask", ProgramArguments: []string{"--app", "app", "run", "--debug", "--reload"}},
			want:    []string{"-m", "flask", "--app", "app", "run"},
			banned:  []string{"--debug", "--reload"},
		},
		{
			name:    "django runserver disables its own reloader",
			options: DebugOptions{Interpreter: interpreter, Kind: "script", Script: "manage.py", ProgramArguments: []string{"runserver", "8000"}},
			want:    []string{manage, "runserver", "8000", "--noreload"},
		},
		{
			name:    "django keeps a single --noreload",
			options: DebugOptions{Interpreter: interpreter, Kind: "script", Script: "manage.py", ProgramArguments: []string{"runserver", "--noreload"}},
			want:    []string{manage, "runserver", "--noreload"},
		},
	} {
		t.Run(test.name, func(t *testing.T) {
			arguments := targets(test.options)
			if strings.Join(arguments, "\x00") != strings.Join(test.want, "\x00") {
				t.Fatalf("targets = %q, want %q", arguments, test.want)
			}
			for _, banned := range test.banned {
				for _, argument := range arguments {
					if argument == banned || strings.HasPrefix(argument, banned+"=") {
						t.Fatalf("%q survived in %q", banned, arguments)
					}
				}
			}
		})
	}
}

func TestDebugAdapterRejectsAMissingInterpreter(t *testing.T) {
	root := t.TempDir()
	writeFile(t, root, "hello.py", "")
	data, _ := json.Marshal(DebugOptions{Interpreter: filepath.Join(root, "missing-python"), Kind: "script", Script: "hello.py"})
	if _, err := New().DebugAdapter(dap.LaunchRequest{Root: root, WorkingDirectory: root, LanguageOptions: data}); err == nil {
		t.Fatal("a missing interpreter must not start a debug session")
	}
}

// TestDebugAdapterCrashEndsTheSession prova PY-6.5: un debug adapter che muore subito deve
// chiudere la sua sessione, senza lasciarla viva in attesa del timeout di lancio.
func TestDebugAdapterCrashEndsTheSession(t *testing.T) {
	root := t.TempDir()
	address, err := loopbackAddress()
	if err != nil {
		t.Fatal(err)
	}
	spec := dap.AdapterSpec{
		AdapterID: "python", Executable: crashInterpreter(t), Address: address, Title: "Debug crashed",
		Launch: func(string) (string, map[string]any) {
			return "attach", map[string]any{"name": "python", "type": "python", "request": "attach"}
		},
	}
	manager := dap.NewDebugManager()
	t.Cleanup(manager.Shutdown)
	states := make(chan dap.DebugSessionInfo, 32)
	manager.SetEmitter(func(kind string, _ dap.SessionID, _ string, payload any) {
		if kind == "debug.state" {
			states <- payload.(dap.DebugSessionInfo)
		}
	})
	started, err := manager.Start(dap.Launch{SessionID: "test", Root: root, Spec: spec})
	if err != nil {
		t.Fatal(err)
	}
	deadline := time.After(30 * time.Second)
	for {
		select {
		case state := <-states:
			if state.ID == started.ID && state.State == dap.DebugTerminated {
				if active := manager.Active(dap.SessionID("test")); len(active) != 0 {
					t.Fatalf("a crashed adapter left live sessions: %+v", active)
				}
				return
			}
		case <-deadline:
			t.Fatal("a crashed debug adapter must end its session")
		}
	}
}

func TestLocateServerAndInstallPlan(t *testing.T) {
	root := t.TempDir()
	tools := t.TempDir()
	info := New().LocateServer(root, tools)
	if info.Available || info.Error == "" {
		t.Fatalf("%+v", info)
	}
	writeFile(t, tools, "basedpyright/basedpyright/langserver.py", "")
	info = New().LocateServer(root, tools)
	if !info.Available || info.Source != "managed" || info.Binary != managedDirectory(tools) {
		t.Fatalf("%+v", info)
	}
	if _, err := bootstrapInterpreter(); err != nil {
		t.Skip("Python is not on PATH: " + err.Error())
	}
	plan, err := New().InstallPlan(tools)
	if err != nil {
		t.Fatal(err)
	}
	if plan.Task != pyrightInstallTask || plan.Executable == "" || !strings.Contains(plan.Command, pyrightName+"=="+pyrightVersion) || len(plan.Languages) != 1 || plan.Languages[0] != ID {
		t.Fatalf("%+v", plan)
	}
	if err := plan.Prepare(); err != nil {
		t.Fatal(err)
	}
	spec, err := New().ServerSpec(root, tools)
	if err != nil || spec.Language != ID || strings.Join(spec.Arguments, " ") != "-c from basedpyright.langserver import main; main() --stdio" {
		t.Fatalf("%+v %v", spec, err)
	}
	if !strings.Contains(strings.Join(spec.Environment, ";"), "PYTHONPATH="+managedDirectory(tools)) {
		t.Fatalf("PYTHONPATH missing: %+v", spec.Environment)
	}
	settings, _ := spec.Configuration().(map[string]any)
	if settings["python"] == nil || settings["basedpyright"] == nil {
		t.Fatalf("%#v", settings)
	}
}

// testInterpreterWith cerca un interprete Python reale con lo strumento indicato; senza, il test
// viene saltato con il motivo (PY-9.1: i test reali restano separati da quelli deterministici).
func testInterpreterWith(t *testing.T, tool string) string {
	t.Helper()
	candidates := []string{os.Getenv("ADOMNIA_TEST_PYTHON")}
	if candidates[0] == "" {
		if found, err := exec.LookPath("python"); err == nil {
			candidates = []string{found}
		}
	}
	for _, candidate := range candidates {
		if candidate == "" {
			continue
		}
		info, err := readInterpreterInfo(candidate)
		if err != nil {
			continue
		}
		if info.Packages[tool] {
			return candidate
		}
	}
	t.Skipf("no Python interpreter with %s available (set ADOMNIA_TEST_PYTHON to one)", tool)
	return ""
}

func TestRealPytestRunProducesTree(t *testing.T) {
	interpreter := testInterpreterWith(t, "pytest")
	root := t.TempDir()
	writeFile(t, root, "tests/test_demo.py", strings.Join([]string{
		"import pytest", "",
		"def test_ok():", "    print('hello from the passing test')", "    assert 1 + 1 == 2", "",
		"@pytest.mark.parametrize('a,b', [(1, 2), (3, 4)])",
		"def test_params(a, b):", "    assert a < b", "",
		"def test_failing():", "    print('printed before the failure')", "    assert 1 == 2", "",
	}, "\n"))
	data, _ := json.Marshal(TestOptions{Interpreter: interpreter, Packages: []string{"tests"}})
	spec, parser, err := New().TestCommand(idetesting.Request{Root: root, WorkingDirectory: root, LanguageOptions: data})
	if err != nil {
		t.Fatal(err)
	}
	ctx, cancel := context.WithTimeout(context.Background(), 90*time.Second)
	defer cancel()
	command := exec.CommandContext(ctx, spec.Executable, spec.Arguments...)
	command.Dir = spec.WorkingDirectory
	command.Env = spec.Environment
	output, err := command.CombinedOutput()
	if err != nil && ctx.Err() != nil {
		t.Fatalf("pytest timed out: %s", output)
	}
	tree := idetesting.NewTree()
	for _, line := range bytes.Split(output, []byte("\n")) {
		for _, event := range parser.(idetesting.BatchParser).ParseAll(line) {
			tree.Apply(event)
		}
	}
	_, summary := tree.Snapshot()
	if summary.Passed != 3 || summary.Failed != 1 {
		t.Fatalf("summary %+v\noutput:\n%s", summary, output)
	}
	// PY-5.4: pytest cattura lo stdout del test e il parser lo conserva nell'albero.
	results, _ := tree.Snapshot()
	joined := ""
	for _, result := range results {
		if result.Name != "" {
			joined += result.Output
		}
	}
	for _, want := range []string{"hello from the passing test", "printed before the failure"} {
		if !strings.Contains(joined, want) {
			t.Fatalf("captured output %q misses %q", joined, want)
		}
	}
}

func TestRealDebugpyStopsAtBreakpoint(t *testing.T) {
	interpreter := testInterpreterWith(t, "debugpy")
	root := t.TempDir()
	writeFile(t, root, "hello.py", "x = 1\ny = x + 1\nprint('done', y)\n")
	data, _ := json.Marshal(DebugOptions{Interpreter: interpreter, Kind: "script", Script: "hello.py"})
	spec, err := New().DebugAdapter(dap.LaunchRequest{Root: root, WorkingDirectory: root, Environment: os.Environ(), LanguageOptions: data})
	if err != nil {
		t.Fatal(err)
	}
	manager := dap.NewDebugManager()
	t.Cleanup(manager.Shutdown)
	states := make(chan dap.DebugSessionInfo, 32)
	manager.SetEmitter(func(kind string, _ dap.SessionID, _ string, payload any) {
		if kind == "debug.state" {
			states <- payload.(dap.DebugSessionInfo)
		}
	})
	manager.SeedBreakpoints(dap.SessionID("test"), map[string][]dap.Breakpoint{filepath.Join(root, "hello.py"): {{Line: 2}}}, dap.FunctionBreakpointSettings{})
	started, err := manager.Start(dap.Launch{SessionID: "test", Root: root, Spec: spec})
	if err != nil {
		t.Fatal(err)
	}
	state := awaitDebugStop(t, states, started.ID, "breakpoint")
	frames, err := manager.StackTrace(started.ID, state.ThreadID)
	if err != nil || len(frames) == 0 || frames[0].Line != 2 {
		t.Fatalf("frames: %+v %v", frames, err)
	}
	value, err := manager.Evaluate(started.ID, "x", frames[0].ID, "watch")
	if err != nil || value.Result != "1" {
		t.Fatalf("evaluate: %+v %v", value, err)
	}
	// PY-6.5: lo step avanza di riga senza perdere la sessione.
	if err := manager.Step(started.ID, "next", state.ThreadID); err != nil {
		t.Fatal(err)
	}
	stepped := awaitDebugStop(t, states, started.ID, "step")
	after, err := manager.StackTrace(started.ID, stepped.ThreadID)
	if err != nil || len(after) == 0 || after[0].Line != 3 {
		t.Fatalf("after step: %+v %v", after, err)
	}
	if err := manager.Stop(started.ID); err != nil {
		t.Fatal(err)
	}
	// PY-6.5: il secondo avvio è una sessione nuova che si ferma allo stesso breakpoint.
	second, err := manager.Start(dap.Launch{SessionID: "test", Root: root, Spec: spec})
	if err != nil {
		t.Fatal(err)
	}
	again := awaitDebugStop(t, states, second.ID, "breakpoint")
	if frames, err := manager.StackTrace(second.ID, again.ThreadID); err != nil || len(frames) == 0 || frames[0].Line != 2 {
		t.Fatalf("second launch: %+v %v", frames, err)
	}
	if err := manager.Stop(second.ID); err != nil {
		t.Fatal(err)
	}
}

// awaitDebugStop attende uno stato di stop con il motivo indicato per una sessione precisa: gli
// eventi della sessione precedente (terminata dallo Stop) non contano. Una terminazione anticipata
// o un timeout fanno fallire il test.
func awaitDebugStop(t *testing.T, states <-chan dap.DebugSessionInfo, session dap.DebugSessionID, reason string) dap.DebugSessionInfo {
	t.Helper()
	deadline := time.After(60 * time.Second)
	for {
		select {
		case state := <-states:
			if session != "" && state.ID != session {
				continue
			}
			if state.State == dap.DebugTerminated {
				t.Fatalf("debug session ended early: %+v", state)
			}
			if state.State == dap.DebugStopped && state.StopReason == reason {
				return state
			}
		case <-deadline:
			t.Fatalf("the debugger never stopped with reason %q", reason)
		}
	}
}
