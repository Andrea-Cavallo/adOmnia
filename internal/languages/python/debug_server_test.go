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
			options: DebugOptions{Interpreter: interpreter, Kind: "module", Module: "uvicorn", App: "app:app", Port: 8000, ProgramArguments: []string{"--reload", "--reload-dir", "extra", "--reload-dir=src"}},
			want:    []string{"-m", "uvicorn", "app:app", "--port", "8000"},
			banned:  []string{"--reload", "extra", "--reload-dir=src"},
		},
		{
			name:    "flask without debug mode and reloader",
			options: DebugOptions{Interpreter: interpreter, Kind: "module", Module: "flask", App: "app", ProgramArguments: []string{"--debug", "--reload"}},
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

// TestDebugAdapterAttachesWithoutStartingAProcess: l'attach è esplicito, non risolve un
// interprete e non avvia nulla: il DAP si collega all'indirizzo indicato (PY-6.1).
func TestDebugAdapterAttachesWithoutStartingAProcess(t *testing.T) {
	data, _ := json.Marshal(DebugOptions{Kind: "attach", Host: "127.0.0.1", Port: 5678})
	spec, err := New().DebugAdapter(dap.LaunchRequest{LanguageOptions: data})
	if err != nil {
		t.Fatal(err)
	}
	if spec.Executable != "" || spec.Address != "127.0.0.1:5678" || !strings.Contains(spec.Title, "Attach") {
		t.Fatalf("%+v", spec)
	}
	request, arguments := spec.Launch("")
	if request != "attach" || arguments["subProcess"] != false || arguments["justMyCode"] != true {
		t.Fatalf("%s %+v", request, arguments)
	}
}

func TestAttachRejectsInvalidTargets(t *testing.T) {
	for _, test := range []struct {
		name string
		host string
		port int
	}{
		{name: "missing port", host: "127.0.0.1"},
		{name: "port out of range", host: "127.0.0.1", port: 70000},
		{name: "scheme", host: "http://localhost", port: 5678},
		{name: "every interface", host: "0.0.0.0", port: 5678},
	} {
		t.Run(test.name, func(t *testing.T) {
			data, _ := json.Marshal(DebugOptions{Kind: "attach", Host: test.host, Port: test.port})
			if _, err := New().DebugAdapter(dap.LaunchRequest{LanguageOptions: data}); err == nil {
				t.Fatal("an invalid attach target was accepted")
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
	// Senza report di pip la cartella non è verificabile: non si usa e lo dice.
	if unverified := New().LocateServer(root, tools); unverified.Available || !strings.Contains(strings.ToLower(unverified.Error), "reinstall") {
		t.Fatalf("an unverified tools folder was accepted: %+v", unverified)
	}
	writeToolMetadata(t, managedDirectory(tools), pyrightVersion, pyrightVersion)
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

// asyncTestPlugin restituisce il primo plugin di test asincrono disponibile nell'interprete:
// pytest-asyncio (il più comune), poi anyio e trio. "" se nessuno.
func asyncTestPlugin(info InterpreterInfo) string {
	for _, plugin := range []string{"pytest_asyncio", "anyio", "trio"} {
		if info.Packages[plugin] {
			return plugin
		}
	}
	return ""
}

// testInterpreterWithAsync cerca un interprete con pytest e un plugin asincrono; senza, salta il
// test con il motivo (PY-9.1: i test reali restano separati dai deterministici). Ritorna il
// percorso dell'interprete e il plugin da usare nella fixture.
func testInterpreterWithAsync(t *testing.T) (string, string) {
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
		if err != nil || !info.Packages["pytest"] {
			continue
		}
		if plugin := asyncTestPlugin(info); plugin != "" {
			return candidate, plugin
		}
	}
	t.Skipf("no Python interpreter with pytest and an async plugin (pytest-asyncio/anyio/trio) available (set ADOMNIA_TEST_PYTHON to one)")
	return "", ""
}

// asyncTestSource scrive un test asincrono con il marker del plugin disponibile: il node ID
// resta `tests/test_async.py::test_async_ok` per tutti e tre, quindi l'albero è identico.
func asyncTestSource(plugin string) []string {
	switch plugin {
	case "anyio":
		return []string{
			"import pytest", "",
			"@pytest.mark.anyio",
			"async def test_async_ok():", "    assert 1 + 1 == 2", "",
		}
	case "trio":
		return []string{
			"import pytest", "",
			"@pytest.mark.trio",
			"async def test_async_ok():", "    assert 1 + 1 == 2", "",
		}
	default: // pytest_asyncio
		return []string{
			"import asyncio", "import pytest", "",
			"@pytest.mark.asyncio",
			"async def test_async_ok():", "    await asyncio.sleep(0)", "    assert 1 + 1 == 2", "",
		}
	}
}

// TestRealPytestRunHandlesAsyncTests prova PY-5.6: il plugin adOmnia riporta un test asincrono
// con lo stesso node ID e lo stesso esito di uno sincrono, quando l'interprete ha un plugin
// asincrono (pytest-asyncio, anyio o trio). Non è una dipendenza di adOmnia: senza plugin salta.
func TestRealPytestRunHandlesAsyncTests(t *testing.T) {
	interpreter, plugin := testInterpreterWithAsync(t)
	root := t.TempDir()
	writeFile(t, root, "tests/test_async.py", strings.Join(asyncTestSource(plugin), "\n"))
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
	results, summary := tree.Snapshot()
	if summary.Passed != 1 || summary.Failed != 0 {
		t.Fatalf("summary %+v\noutput:\n%s", summary, output)
	}
	// L'async non cambia l'identità: il node ID è quello del test.
	found := false
	for _, result := range results {
		if strings.Contains(result.ID, "test_async_ok") {
			found = true
		}
	}
	if !found {
		t.Fatalf("the async test is missing from the tree: %+v", results)
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
	manager.SeedBreakpoints(dap.SessionID("test"), map[string][]dap.Breakpoint{filepath.Join(root, "hello.py"): {{Line: 2}}}, dap.FunctionBreakpointSettings{}, dap.ExceptionBreakpointSettings{})
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
	// PY-6.5: la seconda sessione parte mentre la prima è ancora ferma: due sessioni vive insieme,
	// ognuna con la propria porta e i propri stop (gli eventi si distinguono per id).
	secondSpec, err := New().DebugAdapter(dap.LaunchRequest{Root: root, WorkingDirectory: root, Environment: os.Environ(), LanguageOptions: data})
	if err != nil {
		t.Fatal(err)
	}
	second, err := manager.Start(dap.Launch{SessionID: "test", Root: root, Spec: secondSpec})
	if err != nil {
		t.Fatal(err)
	}
	again := awaitDebugStop(t, states, second.ID, "breakpoint")
	if frames, err := manager.StackTrace(second.ID, again.ThreadID); err != nil || len(frames) == 0 || frames[0].Line != 2 {
		t.Fatalf("second launch: %+v %v", frames, err)
	}
	for _, id := range []dap.DebugSessionID{started.ID, second.ID} {
		if err := manager.Stop(id); err != nil {
			t.Fatal(err)
		}
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
