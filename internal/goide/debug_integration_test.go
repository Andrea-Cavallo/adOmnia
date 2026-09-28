package goide

import (
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"testing"
	"time"
)

func findDelveForTest(t *testing.T) string {
	t.Helper()
	if found, err := exec.LookPath("dlv"); err == nil {
		return found
	}
	if home, err := os.UserHomeDir(); err == nil {
		candidate := filepath.Join(home, "go", "bin", executableName("dlv"))
		if _, err := os.Stat(candidate); err == nil {
			return candidate
		}
	}
	t.Skip("dlv non installato: test del debugger saltato")
	return ""
}

func startDebugProject(t *testing.T) (*Service, *eventRecorder, Session) {
	t.Helper()
	delve := findDelveForTest(t)
	root := copyFixture(t, "debugproject")
	recorder := &eventRecorder{}
	ide := NewService(&memoryStore{}, recorder.record)
	t.Cleanup(ide.Shutdown)
	session, err := ide.OpenProject(root)
	if err != nil {
		t.Fatal(err)
	}
	if _, err := ide.SetToolAuthorization(string(session.ID), true); err != nil {
		t.Fatal(err)
	}
	if info, err := ide.DetectToolchain(string(session.ID)); err != nil || !info.Available {
		t.Fatalf("toolchain non disponibile: %v", err)
	}
	if err := ide.ConfigureDelve(string(session.ID), delve); err != nil {
		t.Fatal(err)
	}
	return ide, recorder, session
}

func waitDebugState(t *testing.T, recorder *eventRecorder, id DebugSessionID, state string, after int) DebugSessionInfo {
	t.Helper()
	deadline := time.Now().Add(120 * time.Second)
	for time.Now().Before(deadline) {
		events := recorder.all()
		for index := after; index < len(events); index++ {
			if info, ok := events[index].Payload.(DebugSessionInfo); ok && info.ID == id && info.State == state {
				return info
			}
		}
		time.Sleep(20 * time.Millisecond)
	}
	t.Fatalf("stato di debug %s non raggiunto", state)
	return DebugSessionInfo{}
}

func TestDebuggerBreakpointStepVariablesAndEvaluate(t *testing.T) {
	ide, recorder, session := startDebugProject(t)
	sessionID := string(session.ID)
	info, err := ide.DetectDelve(sessionID)
	if err != nil || !info.Available || info.Version == "" {
		t.Fatalf("dlv non rilevato: %v %+v", err, info)
	}
	if _, err := ide.SetBreakpoints(sessionID, "main.go", []int{16}); err != nil {
		t.Fatal(err)
	}
	started, err := ide.StartDebug(DebugRequest{SessionID: session.ID, Mode: "debug", Target: "."})
	if err != nil {
		t.Fatal(err)
	}
	stopped := waitDebugState(t, recorder, started.ID, DebugStopped, 0)
	if stopped.StopReason != "breakpoint" || stopped.ThreadID == 0 {
		t.Fatalf("fermata inattesa: %+v", stopped)
	}
	threads, err := ide.DebugThreads(string(started.ID))
	if err != nil || len(threads) == 0 {
		t.Fatalf("goroutine non disponibili: %v %+v", err, threads)
	}
	frames, err := ide.DebugStackTrace(string(started.ID), stopped.ThreadID)
	if err != nil || len(frames) < 2 || frames[0].RelativePath != "main.go" || frames[0].Line != 16 || frames[0].Name != "main.sum" {
		t.Fatalf("stack inatteso: %v %+v", err, frames)
	}
	scopes, err := ide.DebugScopes(string(started.ID), frames[0].ID)
	if err != nil || len(scopes) == 0 {
		t.Fatalf("scope mancanti: %v", err)
	}
	variables, err := ide.DebugVariables(string(started.ID), scopes[0].VariablesReference)
	if err != nil || !hasVariable(variables, "values") {
		t.Fatalf("variabili inattese: %v %+v", err, variables)
	}
	evaluated, err := ide.DebugEvaluate(string(started.ID), "len(values) * 10", frames[0].ID, "watch")
	if err != nil || evaluated.Result != "30" {
		t.Fatalf("evaluate inatteso: %v %+v", err, evaluated)
	}
	if _, err := ide.DebugEvaluate(string(started.ID), "missingName", frames[0].ID, "watch"); err == nil || !strings.Contains(err.Error(), "missingName") {
		t.Fatalf("errore di evaluate non chiaro: %v", err)
	}

	mark := len(recorder.all())
	if err := ide.DebugStep(string(started.ID), "next", stopped.ThreadID); err != nil {
		t.Fatal(err)
	}
	stepped := waitDebugState(t, recorder, started.ID, DebugStopped, mark)
	frames, _ = ide.DebugStackTrace(string(started.ID), stepped.ThreadID)
	if frames[0].Line == 16 {
		t.Fatalf("step over non ha fatto avanzare: %+v", frames[0])
	}

	if _, err := ide.SetBreakpoints(sessionID, "main.go", nil); err != nil {
		t.Fatal(err)
	}
	if err := ide.DebugStep(string(started.ID), "continue", stepped.ThreadID); err != nil {
		t.Fatal(err)
	}
	waitDebugState(t, recorder, started.ID, DebugTerminated, mark)
	output := debugOutput(recorder, started.ID)
	if !strings.Contains(output, "total 6 3") {
		t.Fatalf("output del programma mancante: %q", output)
	}
	if len(ide.debug.Active(session.ID)) != 0 {
		t.Fatal("la sessione di debug deve sparire a programma terminato")
	}
}

func TestDebuggerSingleTest(t *testing.T) {
	ide, recorder, session := startDebugProject(t)
	if _, err := ide.SetBreakpoints(string(session.ID), "main_test.go", []int{7}); err != nil {
		t.Fatal(err)
	}
	started, err := ide.StartDebug(DebugRequest{SessionID: session.ID, Mode: "test", Target: ".", TestName: "^TestSum$"})
	if err != nil {
		t.Fatal(err)
	}
	stopped := waitDebugState(t, recorder, started.ID, DebugStopped, 0)
	frames, err := ide.DebugStackTrace(string(started.ID), stopped.ThreadID)
	if err != nil || frames[0].RelativePath != "main_test.go" || frames[0].Line != 7 {
		t.Fatalf("il test non si è fermato sul breakpoint: %v %+v", err, frames)
	}
	evaluated, err := ide.DebugEvaluate(string(started.ID), "got", frames[0].ID, "watch")
	if err != nil || evaluated.Result != "5" {
		t.Fatalf("variabile del test inattesa: %v %+v", err, evaluated)
	}
	if err := ide.StopDebug(string(started.ID)); err != nil {
		t.Fatal(err)
	}
	waitDebugState(t, recorder, started.ID, DebugTerminated, 0)
}

func TestDebuggerStopLeavesNoOrphans(t *testing.T) {
	ide, recorder, session := startDebugProject(t)
	started, err := ide.StartDebug(DebugRequest{SessionID: session.ID, Mode: "debug", Target: ".", Environment: map[string]string{"DBG_HANG": "1"}})
	if err != nil {
		t.Fatal(err)
	}
	waitDebugState(t, recorder, started.ID, DebugRunning, 0)
	time.Sleep(500 * time.Millisecond)
	if !processExists("__debug_bin") {
		t.Skip("impossibile osservare il processo debuggato in questo ambiente")
	}
	if err := ide.StopDebug(string(started.ID)); err != nil {
		t.Fatal(err)
	}
	waitDebugState(t, recorder, started.ID, DebugTerminated, 0)
	deadline := time.Now().Add(5 * time.Second)
	for processExists("__debug_bin") {
		if time.Now().After(deadline) {
			t.Fatal("il programma debuggato è rimasto in esecuzione dopo Stop")
		}
		time.Sleep(50 * time.Millisecond)
	}
	if _, err := ide.DebugThreads(string(started.ID)); err == nil {
		t.Fatal("una sessione terminata non deve più rispondere")
	}
}

func hasVariable(variables []DebugVariable, name string) bool {
	for _, variable := range variables {
		if variable.Name == name {
			return true
		}
	}
	return false
}

func debugOutput(recorder *eventRecorder, id DebugSessionID) string {
	var text strings.Builder
	for _, event := range recorder.all() {
		if output, ok := event.Payload.(DebugOutput); ok && output.DebugID == id {
			text.WriteString(output.Text)
		}
	}
	return text.String()
}

func processExists(fragment string) bool {
	output, err := exec.Command("pgrep", "-f", fragment).Output()
	return err == nil && len(strings.TrimSpace(string(output))) > 0
}
