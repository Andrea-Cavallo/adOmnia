package goide

import (
	"strings"
	"testing"
)

// stopAt avvia il debug e restituisce la prima fermata con il frame in cima.
func stopAt(t *testing.T, ide *Service, recorder *eventRecorder, session Session, environment map[string]string) (DebugSessionInfo, DebugSessionInfo, []DebugFrame) {
	t.Helper()
	started, err := ide.StartDebug(DebugRequest{SessionID: session.ID, Mode: "debug", Target: ".", Environment: environment})
	if err != nil {
		t.Fatal(err)
	}
	stopped := waitDebugState(t, recorder, started.ID, DebugStopped, 0)
	frames, err := ide.DebugStackTrace(string(started.ID), stopped.ThreadID)
	if err != nil || len(frames) == 0 {
		t.Fatalf("stack non disponibile: %v", err)
	}
	return started, stopped, frames
}

func evaluateIn(t *testing.T, ide *Service, debugID DebugSessionID, frameID int, expression string) string {
	t.Helper()
	result, err := ide.DebugEvaluate(string(debugID), expression, frameID, "watch")
	if err != nil {
		t.Fatalf("evaluate %s: %v", expression, err)
	}
	return result.Result
}

func finish(t *testing.T, ide *Service, recorder *eventRecorder, id DebugSessionID, threadID int) {
	t.Helper()
	mark := len(recorder.all())
	if err := ide.DebugStep(string(id), "continue", threadID); err != nil {
		t.Fatal(err)
	}
	waitDebugState(t, recorder, id, DebugTerminated, mark)
}

func TestDebuggerConditionalAndHitCountBreakpoints(t *testing.T) {
	cases := []struct {
		name       string
		breakpoint Breakpoint
		want       string
	}{
		{"condition", Breakpoint{Line: 16, Condition: "value == 2"}, "2"},
		{"hit count", Breakpoint{Line: 16, HitCondition: "3"}, "3"},
	}
	for _, test := range cases {
		t.Run(test.name, func(t *testing.T) {
			ide, recorder, session := startDebugProject(t)
			if _, err := ide.SetBreakpoints(string(session.ID), "main.go", []Breakpoint{test.breakpoint}); err != nil {
				t.Fatal(err)
			}
			started, stopped, frames := stopAt(t, ide, recorder, session, nil)
			if frames[0].Line != 16 {
				t.Fatalf("fermata sulla riga sbagliata: %+v", frames[0])
			}
			if got := evaluateIn(t, ide, started.ID, frames[0].ID, "value"); got != test.want {
				t.Fatalf("value = %s, atteso %s", got, test.want)
			}
			if _, err := ide.SetBreakpoints(string(session.ID), "main.go", nil); err != nil {
				t.Fatal(err)
			}
			finish(t, ide, recorder, started.ID, stopped.ThreadID)
		})
	}
}

func TestDebuggerLogpointPrintsWithoutStopping(t *testing.T) {
	ide, recorder, session := startDebugProject(t)
	states, err := ide.SetBreakpoints(string(session.ID), "main.go", []Breakpoint{{Line: 16, LogMessage: "adding {value}"}})
	if err != nil || len(states) != 1 || states[0].LogMessage != "adding {value}" {
		t.Fatalf("logpoint non salvato: %v %+v", err, states)
	}
	started, err := ide.StartDebug(DebugRequest{SessionID: session.ID, Mode: "debug", Target: "."})
	if err != nil {
		t.Fatal(err)
	}
	waitDebugState(t, recorder, started.ID, DebugTerminated, 0)
	output := debugOutput(recorder, started.ID)
	for _, want := range []string{"adding 1", "adding 2", "adding 3", "total 6 3"} {
		if !strings.Contains(output, want) {
			t.Fatalf("output del logpoint mancante %q in %q", want, output)
		}
	}
	for _, event := range recorder.all() {
		if info, ok := event.Payload.(DebugSessionInfo); ok && info.ID == started.ID && info.State == DebugStopped {
			t.Fatal("un logpoint non deve fermare il programma")
		}
	}
}

func TestDebuggerFunctionPanicAndRunToCursor(t *testing.T) {
	ide, recorder, session := startDebugProject(t)
	sessionID := string(session.ID)
	if _, err := ide.SetFunctionBreakpoints(sessionID, FunctionBreakpointSettings{Functions: []FunctionBreakpoint{{Name: "main.sum"}}}); err != nil {
		t.Fatal(err)
	}
	started, stopped, frames := stopAt(t, ide, recorder, session, map[string]string{"DBG_PANIC": "1"})
	if frames[0].Name != "main.sum" {
		t.Fatalf("il function breakpoint deve fermare in main.sum: %+v", frames[0])
	}
	verified := false
	for _, event := range recorder.all() {
		if view, ok := event.Payload.(FunctionBreakpointsView); ok && len(view.Functions) == 1 && view.Functions[0].Verified {
			verified = true
		}
	}
	if !verified {
		t.Fatal("Delve deve verificare il function breakpoint")
	}
	if saved, _ := ide.ListFunctionBreakpoints(sessionID); len(saved.Functions) != 1 || saved.Functions[0].Name != "main.sum" {
		t.Fatalf("function breakpoint non salvato: %+v", saved)
	}

	// Run to Cursor su una riga senza codice: errore chiaro, il programma resta fermo.
	if err := ide.DebugRunToCursor(string(started.ID), "main.go", 32, stopped.ThreadID); err == nil || !strings.Contains(err.Error(), "no executable code") {
		t.Fatalf("Run to Cursor su riga vuota: %v", err)
	}
	mark := len(recorder.all())
	if err := ide.DebugRunToCursor(string(started.ID), "main.go", 27, stopped.ThreadID); err != nil {
		t.Fatal(err)
	}
	cursor := waitDebugState(t, recorder, started.ID, DebugStopped, mark)
	frames, _ = ide.DebugStackTrace(string(started.ID), cursor.ThreadID)
	if frames[0].RelativePath != "main.go" || frames[0].Line != 27 {
		t.Fatalf("Run to Cursor fermato altrove: %+v", frames[0])
	}

	// Ogni panic, anche recuperato, ferma il programma con Stop on every panic.
	if _, err := ide.SetFunctionBreakpoints(sessionID, FunctionBreakpointSettings{StopOnPanic: true}); err != nil {
		t.Fatal(err)
	}
	mark = len(recorder.all())
	if err := ide.DebugStep(string(started.ID), "continue", cursor.ThreadID); err != nil {
		t.Fatal(err)
	}
	panicked := waitDebugState(t, recorder, started.ID, DebugStopped, mark)
	frames, _ = ide.DebugStackTrace(string(started.ID), panicked.ThreadID)
	inRecovered := false
	for _, frame := range frames {
		inRecovered = inRecovered || frame.Name == "main.recovered"
	}
	if !inRecovered {
		t.Fatalf("il panic breakpoint deve fermare dentro main.recovered: %+v", frames)
	}
	finish(t, ide, recorder, started.ID, panicked.ThreadID)
	if output := debugOutput(recorder, started.ID); !strings.Contains(output, "recovered boom") {
		t.Fatalf("il programma deve riprendersi dal panic: %q", output)
	}
}
