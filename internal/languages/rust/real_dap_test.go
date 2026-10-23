package rust

import (
	"os"
	"path/filepath"
	"strconv"
	"strings"
	"sync"
	"testing"
	"time"

	"adomnia/internal/ide/dap"
)

// logAll copia il registro degli eventi per stamparlo nei fallimenti.
func logAll(mu *sync.Mutex, log *[]string) []string {
	mu.Lock()
	defer mu.Unlock()
	return append([]string(nil), (*log)...)
}

// dapRig tiene insieme il DebugManager reale, il canale degli stati e il registro degli eventi
// che si stampa nei fallimenti.
type dapRig struct {
	t       *testing.T
	manager *dap.DebugManager
	states  chan dap.DebugSessionInfo
	mu      sync.Mutex
	log     []string
}

func newDAPRig(t *testing.T) *dapRig {
	t.Helper()
	rig := &dapRig{t: t, manager: dap.NewDebugManager(), states: make(chan dap.DebugSessionInfo, 64)}
	t.Cleanup(rig.manager.Shutdown)
	rig.manager.SetEmitter(func(kind string, _ dap.SessionID, _ string, payload any) {
		switch value := payload.(type) {
		case dap.DebugSessionInfo:
			rig.mu.Lock()
			rig.log = append(rig.log, "state "+string(value.ID)+" "+value.State+" "+value.StopReason+" "+value.Error)
			rig.mu.Unlock()
			if kind == "debug.state" {
				rig.states <- value
			}
		case dap.DebugOutput:
			rig.mu.Lock()
			rig.log = append(rig.log, "output ["+value.Category+"] "+strings.TrimSpace(value.Text))
			rig.mu.Unlock()
		}
	})
	return rig
}

// waitState aspetta lo stato `want` della sessione; una sessione terminata in anticipo fallisce.
func (r *dapRig) waitState(debugID dap.DebugSessionID, want string) dap.DebugSessionInfo {
	r.t.Helper()
	for deadline := time.Now().Add(2 * time.Minute); time.Now().Before(deadline); {
		select {
		case state := <-r.states:
			if state.ID != debugID {
				continue
			}
			if state.State == dap.DebugTerminated && want != dap.DebugTerminated {
				r.t.Fatalf("the session ended early: %+v\n%s", state, strings.Join(logAll(&r.mu, &r.log), "\n"))
			}
			if state.State == want {
				return state
			}
		case <-time.After(20 * time.Second):
			r.t.Fatalf("no %s state arrived:\n%s", want, strings.Join(logAll(&r.mu, &r.log), "\n"))
		}
	}
	r.t.Fatalf("no %s state arrived:\n%s", want, strings.Join(logAll(&r.mu, &r.log), "\n"))
	return dap.DebugSessionInfo{}
}

// writeDemoCrate scrive il crate con un solo test che si ferma alla riga 6 di src/lib.rs.
func writeDemoCrate(t *testing.T, root string) {
	t.Helper()
	writeFile(t, root, "Cargo.toml", "[package]\nname = \"demo\"\nversion = \"0.1.0\"\nedition = \"2021\"\n")
	writeFile(t, root, "src/lib.rs", strings.Join([]string{
		"#[cfg(test)]",
		"mod tests {",
		"    #[test]",
		"    fn hit() {",
		"        let value = 21;",
		"        let doubled = value * 2;",
		"        assert_eq!(doubled, 42);",
		"    }",
		"}",
		"",
	}, "\n"))
}

// pausedFrame sceglie il frame di src/lib.rs della fermata (il thread è quello dell'evento
// stopped: l'ordine dell'elenco no) e controlla che sia sulla riga 6.
func pausedFrame(t *testing.T, round int, manager *dap.DebugManager, debugID dap.DebugSessionID, stopped dap.DebugSessionInfo) (dap.DebugFrame, int) {
	t.Helper()
	threads, err := manager.Threads(debugID)
	if err != nil || len(threads) == 0 {
		t.Fatalf("round %d: threads: %+v %v", round, threads, err)
	}
	threadID := stopped.ThreadID
	if threadID == 0 {
		threadID = threads[0].ID
	}
	frames, err := manager.StackTrace(debugID, threadID)
	if err != nil || len(frames) == 0 {
		t.Fatalf("round %d: stack: %+v %v", round, frames, err)
	}
	frame := frames[0]
	for _, candidate := range frames {
		if strings.HasSuffix(filepath.ToSlash(candidate.Path), "src/lib.rs") || candidate.RelativePath == "src/lib.rs" {
			frame = candidate
			break
		}
	}
	if !strings.HasSuffix(filepath.ToSlash(frame.Path), "src/lib.rs") && frame.RelativePath != "src/lib.rs" {
		t.Fatalf("round %d: frame = %+v", round, frame)
	}
	if frame.Line != 6 {
		t.Fatalf("round %d: stopped at line %d, want 6 (%+v)", round, frame.Line, frame)
	}
	return frame, threadID
}

// expectVariableValue cerca la variabile `value` (21) in uno degli scope del frame.
func expectVariableValue(t *testing.T, round int, manager *dap.DebugManager, debugID dap.DebugSessionID, frameID int) {
	t.Helper()
	scopes, err := manager.Scopes(debugID, frameID)
	if err != nil || len(scopes) == 0 {
		t.Fatalf("round %d: scopes: %+v %v", round, scopes, err)
	}
	for _, scope := range scopes {
		variables, err := manager.Variables(debugID, scope.VariablesReference)
		if err != nil {
			continue
		}
		for _, variable := range variables {
			if variable.Name == "value" && strings.Contains(variable.Value, "21") {
				return
			}
		}
	}
	t.Fatalf("round %d: variable `value` not found", round)
}

// debugRound è una sessione completa: fermata sul breakpoint, breakpoint verificato, frame,
// variabile, evaluate, step e stop.
func (r *dapRig) debugRound(round int, root string, spec dap.AdapterSpec) {
	t, manager := r.t, r.manager
	t.Helper()
	sessionID := dap.SessionID("real-rust-" + strconv.Itoa(round))
	// I breakpoint in memoria prima della sessione: l'handshake li applica prima di
	// configurationDone, quindi il programma non parte senza di essi. Il percorso è assoluto
	// come nell'host (service_debug.go): CodeLLDB lega i breakpoint ai path del DWARF.
	source := filepath.Join(root, "src", "lib.rs")
	manager.SetBreakpoints(sessionID, root, source, []dap.Breakpoint{{Line: 6}})
	started, err := manager.Start(dap.Launch{SessionID: sessionID, Root: root, Spec: spec})
	if err != nil {
		t.Fatalf("round %d: %v", round, err)
	}
	stopped := r.waitState(started.ID, dap.DebugStopped)
	if stopped.StopReason != "breakpoint" {
		t.Fatalf("round %d: stop reason = %q", round, stopped.StopReason)
	}

	// Breakpoint confermato dall'adapter (il secondo invio riceve la verifica).
	verified := manager.SetBreakpoints(sessionID, root, source, []dap.Breakpoint{{Line: 6}})
	if len(verified) != 1 || !verified[0].Verified {
		t.Fatalf("round %d: breakpoint not verified: %+v", round, verified)
	}

	frame, threadID := pausedFrame(t, round, manager, started.ID, stopped)
	expectVariableValue(t, round, manager, started.ID, frame.ID)

	value, err := manager.Evaluate(started.ID, "value * 2", frame.ID, "watch")
	if err != nil || !strings.Contains(value.Result, "42") {
		t.Fatalf("round %d: evaluate = %+v %v", round, value, err)
	}

	// Step: si avanza di una riga e ci si ferma di nuovo.
	if err := manager.Step(started.ID, "next", threadID); err != nil {
		t.Fatalf("round %d: step: %v", round, err)
	}
	r.waitState(started.ID, dap.DebugStopped)
	frames, err := manager.StackTrace(started.ID, threadID)
	if err != nil || len(frames) == 0 || frames[0].Line <= frame.Line {
		t.Fatalf("round %d: the step did not advance: %+v %v", round, frames, err)
	}

	// Stop: la sessione finisce e il processo non resta attivo.
	if err := manager.Stop(started.ID); err != nil {
		t.Fatalf("round %d: stop: %v", round, err)
	}
	r.waitState(started.ID, dap.DebugTerminated)
	if len(manager.Active(sessionID)) != 0 {
		t.Fatalf("round %d: the session is still active after stop", round)
	}
}

// TestRealCodeLLDBStopsAtBreakpoint è la prova DAP reale di RS-6.6 con CodeLLDB: breakpoint
// confermato dall'adapter, fermata sul frame atteso, variabile attesa, evaluate, step e stop, e una
// seconda sessione sullo stesso binario. Come gli altri test reali è opt-in (ADOMNIA_TEST_CARGO) e
// salta con un messaggio esplicito se manca il tool (ADOMNIA_TEST_TOOLS punta alla cartella
// strumenti con l'installazione gestita).
func TestRealCodeLLDBStopsAtBreakpoint(t *testing.T) {
	requireRealCargo(t)
	adapterPath, source, _ := LocateCodeLLDB(os.Getenv("ADOMNIA_TEST_TOOLS"))
	if adapterPath == "" {
		t.Skip("CodeLLDB is not installed: install it (Install CodeLLDB…) or set ADOMNIA_TEST_TOOLS to run this check")
	}
	t.Logf("CodeLLDB from %s", source)

	root := t.TempDir()
	writeDemoCrate(t, root)
	spec, err := New().DebugAdapter(dap.LaunchRequest{
		Root: root, WorkingDirectory: root, Environment: os.Environ(),
		LanguageOptions: []byte(`{"test":"tests/hit","testFile":"src/lib.rs","adapter":` + strconv.Quote(adapterPath) + `}`),
	})
	if err != nil {
		t.Fatal(err)
	}

	rig := newDAPRig(t)
	for round := 1; round <= 2; round++ {
		rig.debugRound(round, root, spec)
	}
}

// TestDebugAdapterWithoutCodeLLDBExplainsTheInstallAction: adapter assente → messaggio che dice di
// installarlo (l'azione "Install CodeLLDB…" è la risposta della UI, RS-6.1).
func TestDebugAdapterWithoutCodeLLDBExplainsTheInstallAction(t *testing.T) {
	root := t.TempDir()
	cargo := writeFile(t, root, "cargo.exe", "")
	writeFile(t, root, "src/lib.rs", "")
	originalPath, originalLook := pathCargo, lookPath
	pathCargo = func() string { return cargo }
	lookPath = func(string) (string, error) { return "", errNotFound }
	defer func() { pathCargo, lookPath = originalPath, originalLook }()

	_, err := New().DebugAdapter(dap.LaunchRequest{Root: root, WorkingDirectory: root, LanguageOptions: []byte(`{"test":"tests/hit"}`)})
	if err == nil || !strings.Contains(err.Error(), "CodeLLDB is not installed") || !strings.Contains(err.Error(), "install") {
		t.Fatalf("a missing adapter must explain the install action, got %v", err)
	}
}

// TestDebugAdapterWithMissingTestBinaryExplains: `cargo test --no-run` senza artefatto non produce
// un programma da avviare: l'errore lo dice invece di indovinare un percorso (RS-6.2).
func TestDebugAdapterWithMissingTestBinaryExplains(t *testing.T) {
	root := t.TempDir()
	cargo := writeFile(t, root, "cargo.exe", "")
	codelldb := writeFile(t, root, "codelldb", "")
	writeFile(t, root, "src/lib.rs", "")
	originalPath, originalLook := pathCargo, lookPath
	pathCargo = func() string { return cargo }
	lookPath = func(string) (string, error) { return codelldb, nil }
	defer func() { pathCargo, lookPath = originalPath, originalLook }()
	originalRun := runCargoBuild
	runCargoBuild = func(string, string, []string) ([]byte, error) {
		return []byte(`{"reason":"compiler-artifact","executable":null,"profile":{"test":true}}`), nil
	}
	defer func() { runCargoBuild = originalRun }()

	_, err := New().DebugAdapter(dap.LaunchRequest{Root: root, WorkingDirectory: root, LanguageOptions: []byte(`{"test":"tests/hit"}`)})
	if err == nil || !strings.Contains(err.Error(), "test binary") {
		t.Fatalf("a missing test binary must be reported, got %v", err)
	}
}
