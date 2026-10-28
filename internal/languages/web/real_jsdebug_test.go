package web

import (
	"os"
	"path/filepath"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/Andrea-Cavallo/adOmnia/internal/ide/dap"
)

// jsDebugRig tiene insieme il DebugManager reale, il canale degli stati e il registro degli eventi
// che si stampa nei fallimenti.
type jsDebugRig struct {
	t       *testing.T
	manager *dap.DebugManager
	states  chan dap.DebugSessionInfo
	mu      sync.Mutex
	log     []string
}

func newJSDebugRig(t *testing.T) *jsDebugRig {
	t.Helper()
	rig := &jsDebugRig{t: t, manager: dap.NewDebugManager(), states: make(chan dap.DebugSessionInfo, 64)}
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

func (r *jsDebugRig) transcript() string {
	r.mu.Lock()
	defer r.mu.Unlock()
	return strings.Join(r.log, "\n")
}

// waitState aspetta lo stato `want` della sessione; una sessione terminata in anticipo fallisce.
func (r *jsDebugRig) waitState(debugID dap.DebugSessionID, want string) dap.DebugSessionInfo {
	r.t.Helper()
	for deadline := time.Now().Add(2 * time.Minute); time.Now().Before(deadline); {
		select {
		case state := <-r.states:
			if state.ID != debugID {
				continue
			}
			if state.State == dap.DebugTerminated && want != dap.DebugTerminated {
				r.t.Fatalf("the session ended early: %+v\n%s", state, r.transcript())
			}
			if state.State == want {
				return state
			}
		case <-time.After(20 * time.Second):
			r.t.Fatalf("no %s state arrived:\n%s", want, r.transcript())
		}
	}
	r.t.Fatalf("no %s state arrived:\n%s", want, r.transcript())
	return dap.DebugSessionInfo{}
}

// realJSDebugAdapter restituisce il server js-debug indicato da ADOMNIA_TEST_JSD_BEBUG: il test
// reale è opt-in e salta con un messaggio esplicito quando il debugger non è installato.
func realJSDebugAdapter(t *testing.T) string {
	t.Helper()
	adapter := strings.TrimSpace(os.Getenv("ADOMNIA_TEST_JSD_BEBUG"))
	if adapter == "" {
		t.Skip("js-debug is not configured: set ADOMNIA_TEST_JSD_BEBUG to its src/dapDebugServer.js to run this check")
	}
	if !isFile(adapter) {
		t.Fatalf("ADOMNIA_TEST_JSD_BEBUG does not point to a file: %s", adapter)
	}
	return adapter
}

// TestRealJSDebugStopsAtBreakpoint è la prova DAP reale con js-debug, incluso il ciclo delle sessioni
// figlie: breakpoint confermato, fermata sulla riga attesa del file del progetto, variabile,
// evaluate, step e stop. È opt-in (ADOMNIA_TEST_JSD_BEBUG) e salta se il debugger o Node non ci sono.
func TestRealJSDebugStopsAtBreakpoint(t *testing.T) {
	adapter := realJSDebugAdapter(t)
	node, err := lookPath("node")
	if err != nil {
		t.Skip("Node.js is not on the PATH")
	}

	root := t.TempDir()
	writeFile(t, filepath.Join(root, "src", "app.js"), strings.Join([]string{
		"const value = 21",
		"const doubled = value * 2",
		"console.log(doubled)",
		"setTimeout(() => {}, 5000)",
		"",
	}, "\n"))
	options := `{"kind":"script","program":"src/app.js","node":` + quoteJSON(t, node) + `,"adapter":` + quoteJSON(t, adapter) + `}`
	spec, err := ScriptLanguage().(dap.DebugAdapterProvider).DebugAdapter(dap.LaunchRequest{
		Root: root, WorkingDirectory: root, Environment: os.Environ(), LanguageOptions: []byte(options),
	})
	if err != nil {
		t.Fatal(err)
	}

	rig := newJSDebugRig(t)
	sessionID := dap.SessionID("real-js")
	source := filepath.Join(root, "src", "app.js")
	rig.manager.SetBreakpoints(sessionID, root, source, []dap.Breakpoint{{Line: 2}})
	started, err := rig.manager.Start(dap.Launch{SessionID: sessionID, Root: root, Spec: spec})
	if err != nil {
		t.Fatal(err)
	}
	stopped := rig.waitState(started.ID, dap.DebugStopped)
	if stopped.StopReason != "breakpoint" {
		t.Fatalf("stop reason = %q\n%s", stopped.StopReason, rig.transcript())
	}

	// js-debug marca i breakpoint "provvisori" finché il sorgente non è caricato sulla connessione
	// figlia: la prova è la fermata qui sopra, non il flag verified della risposta.

	threadID := stopped.ThreadID
	if threadID == 0 {
		threads, err := rig.manager.Threads(started.ID)
		if err != nil || len(threads) == 0 {
			t.Fatalf("threads: %+v %v\n%s", threads, err, rig.transcript())
		}
		threadID = threads[0].ID
	}
	frames, err := rig.manager.StackTrace(started.ID, threadID)
	if err != nil || len(frames) == 0 {
		t.Fatalf("stack: %+v %v\n%s", frames, err, rig.transcript())
	}
	frame := frames[0]
	for _, candidate := range frames {
		if strings.HasSuffix(filepath.ToSlash(candidate.Path), "src/app.js") || candidate.RelativePath == "src/app.js" {
			frame = candidate
			break
		}
	}
	if frame.Line != 2 || (!strings.HasSuffix(filepath.ToSlash(frame.Path), "src/app.js") && frame.RelativePath != "src/app.js") {
		t.Fatalf("stopped at %s:%d, want src/app.js:2\n%s", frame.Path, frame.Line, rig.transcript())
	}

	found := false
	scopes, err := rig.manager.Scopes(started.ID, frame.ID)
	if err != nil {
		t.Fatalf("scopes: %v", err)
	}
	for _, scope := range scopes {
		variables, err := rig.manager.Variables(started.ID, scope.VariablesReference)
		if err != nil {
			continue
		}
		for _, variable := range variables {
			if variable.Name == "value" && strings.Contains(variable.Value, "21") {
				found = true
			}
		}
	}
	if !found {
		t.Fatalf("variable `value` not found\n%s", rig.transcript())
	}

	result, err := rig.manager.Evaluate(started.ID, "value * 2", frame.ID, "watch")
	if err != nil || !strings.Contains(result.Result, "42") {
		t.Fatalf("evaluate = %+v %v", result, err)
	}

	if err := rig.manager.Step(started.ID, "next", threadID); err != nil {
		t.Fatalf("step: %v", err)
	}
	rig.waitState(started.ID, dap.DebugStopped)
	after, err := rig.manager.StackTrace(started.ID, threadID)
	if err != nil || len(after) == 0 || after[0].Line <= frame.Line {
		t.Fatalf("the step did not advance: %+v %v", after, err)
	}

	if err := rig.manager.Stop(started.ID); err != nil {
		t.Fatalf("stop: %v", err)
	}
	rig.waitState(started.ID, dap.DebugTerminated)
	if len(rig.manager.Active(sessionID)) != 0 {
		t.Fatal("the session is still active after stop")
	}
}
