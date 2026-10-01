package goide

import (
	"net"
	"os"
	"os/exec"
	"path/filepath"
	"runtime"
	"strings"
	"syscall"
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
	if _, err := ide.SetBreakpoints(sessionID, "main.go", lineBreakpoints(debugFixtureLine(t, "\t\ttotal += value"))); err != nil {
		t.Fatal(err)
	}
	started, err := ide.StartDebug(DebugRequest{SessionID: session.ID, Mode: "debug", Target: "."})
	if err != nil {
		t.Fatal(err)
	}
	stopped := waitDebugState(t, recorder, started.ID, DebugStopped, 0)
	if started.Title != "main" {
		t.Fatalf("titolo della sessione poco leggibile: %q", started.Title)
	}
	// Il binario di debug va compilato fuori dal progetto, per non sporcare albero e VCS.
	if matches, _ := filepath.Glob(filepath.Join(session.Project.RealPath, "__debug_bin*")); len(matches) > 0 {
		t.Fatalf("binario di debug creato nel progetto: %v", matches)
	}
	if stopped.StopReason != "breakpoint" || stopped.ThreadID == 0 {
		t.Fatalf("fermata inattesa: %+v", stopped)
	}
	threads, err := ide.DebugThreads(string(started.ID))
	if err != nil || len(threads) == 0 {
		t.Fatalf("goroutine non disponibili: %v %+v", err, threads)
	}
	frames, err := ide.DebugStackTrace(string(started.ID), stopped.ThreadID)
	if err != nil || len(frames) < 2 || frames[0].RelativePath != "main.go" || frames[0].Line != debugFixtureLine(t, "\t\ttotal += value") || frames[0].Name != "main.sum" {
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
	if _, err := ide.DebugEvaluate(string(started.ID), "missingName", frames[0].ID, "watch"); err == nil || strings.Contains(err.Error(), "Unable to evaluate") {
		t.Fatalf("il prefisso tecnico di Delve deve sparire: %v", err)
	}
	// In console le chiamate di funzione funzionano senza scrivere "call"; nelle watch no.
	if called, err := ide.DebugEvaluate(string(started.ID), "sum(nil) + 1", frames[0].ID, "repl"); err != nil || called.Result != "1" {
		t.Fatalf("chiamata di funzione in console non riuscita: %v %+v", err, called)
	}
	if _, err := ide.DebugEvaluate(string(started.ID), "sum(nil)", frames[0].ID, "watch"); err == nil || !strings.Contains(err.Error(), "Debug console") {
		t.Fatalf("una watch non deve eseguire funzioni: %v", err)
	}

	mark := len(recorder.all())
	if err := ide.DebugStep(string(started.ID), "next", stopped.ThreadID); err != nil {
		t.Fatal(err)
	}
	stepped := waitDebugState(t, recorder, started.ID, DebugStopped, mark)
	frames, _ = ide.DebugStackTrace(string(started.ID), stepped.ThreadID)
	if frames[0].Line == debugFixtureLine(t, "\t\ttotal += value") {
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
	if _, err := ide.SetBreakpoints(string(session.ID), "main_test.go", lineBreakpoints(7)); err != nil {
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

func TestDebuggerResolvesWrappedErrorChainOnExplicitEvaluate(t *testing.T) {
	ide, recorder, session := startDebugProject(t)
	content, err := os.ReadFile(filepath.Join(session.Project.RealPath, "main.go"))
	if err != nil {
		t.Fatal(err)
	}
	breakpoint := lineOf(t, string(content), "\tfmt.Println(outer)")
	if _, err := ide.SetBreakpoints(string(session.ID), "main.go", lineBreakpoints(breakpoint)); err != nil {
		t.Fatal(err)
	}
	started, err := ide.StartDebug(DebugRequest{SessionID: session.ID, Mode: "debug", Target: "."})
	if err != nil {
		t.Fatal(err)
	}
	stopped := waitDebugState(t, recorder, started.ID, DebugStopped, 0)
	frames, err := ide.DebugStackTrace(string(started.ID), stopped.ThreadID)
	if err != nil || len(frames) == 0 {
		t.Fatalf("stack non disponibile: %v %+v", err, frames)
	}
	frameID := frames[0].ID
	first, err := ide.DebugEvaluate(string(started.ID), "(outer).(*fmt.wrapError).err", frameID, "repl")
	if err != nil || !strings.Contains(first.Result, "inner") {
		t.Fatalf("primo Unwrap inatteso: %v %+v", err, first)
	}
	second, err := ide.DebugEvaluate(string(started.ID), "((outer).(*fmt.wrapError).err).(*fmt.wrapError).err", frameID, "repl")
	if err != nil || !strings.Contains(second.Result, "root cause") {
		t.Fatalf("secondo Unwrap inatteso: %v %+v", err, second)
	}
	if err := ide.StopDebug(string(started.ID)); err != nil {
		t.Fatal(err)
	}
	waitDebugState(t, recorder, started.ID, DebugTerminated, 0)
}

func TestDebuggerEvaluatesCollectionMetadataWithoutFunctionCalls(t *testing.T) {
	ide, recorder, session := startDebugProject(t)
	content, err := os.ReadFile(filepath.Join(session.Project.RealPath, "main.go"))
	if err != nil {
		t.Fatal(err)
	}
	breakpoint := lineOf(t, string(content), "\tfmt.Println(items, labels, jobs)")
	if _, err := ide.SetBreakpoints(string(session.ID), "main.go", lineBreakpoints(breakpoint)); err != nil {
		t.Fatal(err)
	}
	started, err := ide.StartDebug(DebugRequest{SessionID: session.ID, Mode: "debug", Target: "."})
	if err != nil {
		t.Fatal(err)
	}
	stopped := waitDebugState(t, recorder, started.ID, DebugStopped, 0)
	frames, err := ide.DebugStackTrace(string(started.ID), stopped.ThreadID)
	if err != nil || len(frames) == 0 {
		t.Fatalf("stack non disponibile: %v %+v", err, frames)
	}
	for expression, want := range map[string]string{
		"len(items)":  "2",
		"cap(items)":  "5",
		"len(labels)": "2",
		"len(jobs)":   "1",
		"cap(jobs)":   "3",
	} {
		result, err := ide.DebugEvaluate(string(started.ID), expression, frames[0].ID, "watch")
		if err != nil || result.Result != want {
			t.Fatalf("%s = %+v, %v; atteso %s", expression, result, err, want)
		}
	}
	if err := ide.StopDebug(string(started.ID)); err != nil {
		t.Fatal(err)
	}
	waitDebugState(t, recorder, started.ID, DebugTerminated, 0)
}

func TestDebuggerReportsInterfaceRuntimeValue(t *testing.T) {
	ide, recorder, session := startDebugProject(t)
	content, err := os.ReadFile(filepath.Join(session.Project.RealPath, "main.go"))
	if err != nil {
		t.Fatal(err)
	}
	breakpoint := lineOf(t, string(content), "\tfmt.Println(payload)")
	if _, err := ide.SetBreakpoints(string(session.ID), "main.go", lineBreakpoints(breakpoint)); err != nil {
		t.Fatal(err)
	}
	started, err := ide.StartDebug(DebugRequest{SessionID: session.ID, Mode: "debug", Target: "."})
	if err != nil {
		t.Fatal(err)
	}
	stopped := waitDebugState(t, recorder, started.ID, DebugStopped, 0)
	frames, err := ide.DebugStackTrace(string(started.ID), stopped.ThreadID)
	if err != nil || len(frames) == 0 {
		t.Fatalf("stack non disponibile: %v %+v", err, frames)
	}
	payload, err := ide.DebugEvaluate(string(started.ID), "payload", frames[0].ID, "watch")
	if err != nil || payload.Type == "" || payload.Result == "" {
		t.Fatalf("interface non esposta da Delve: %v %+v", err, payload)
	}
	t.Logf("Delve interface: type=%q value=%q", payload.Type, payload.Result)
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
	// La cartella di build è univoca per sessione: il pattern non può coincidere con altri processi.
	running, err := ide.debug.get(started.ID)
	if err != nil {
		t.Fatal(err)
	}
	binary := filepath.Join(running.buildDir, debugBinaryName())
	if !processExists(binary) {
		t.Skip("impossibile osservare il processo debuggato in questo ambiente")
	}
	if err := ide.StopDebug(string(started.ID)); err != nil {
		t.Fatal(err)
	}
	waitDebugState(t, recorder, started.ID, DebugTerminated, 0)
	deadline := time.Now().Add(5 * time.Second)
	for processExists(binary) {
		if time.Now().After(deadline) {
			t.Fatal("il programma debuggato è rimasto in esecuzione dopo Stop")
		}
		time.Sleep(50 * time.Millisecond)
	}
	for _, statErr := os.Stat(running.buildDir); statErr == nil; _, statErr = os.Stat(running.buildDir) {
		if time.Now().After(deadline) {
			t.Fatal("la cartella temporanea del binario di debug non è stata rimossa")
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

func TestDebugTitleIsReadable(t *testing.T) {
	cases := map[string]DebugRequest{
		"main":             {Mode: "debug", Target: "."},
		"cmd/api":          {Mode: "debug", Target: "./cmd/api"},
		"TestAdd/negative": {Mode: "test", TestName: "^TestAdd$/^negative$"},
		"BenchmarkSum":     {Mode: "test", TestName: "^$", ProgramArguments: []string{"-test.bench", "^BenchmarkSum$"}},
		"tests ./calc":     {Mode: "test", Target: "./calc"},
	}
	for want, request := range cases {
		if got := debugTitle(request); got != want {
			t.Errorf("debugTitle(%+v) = %q, atteso %q", request, got, want)
		}
	}
}

// openDebugSession apre una copia del progetto di debug nello stesso servizio, pronta per dlv.
func openDebugSession(t *testing.T, ide *Service, delve string) Session {
	t.Helper()
	session, err := ide.OpenProject(copyFixture(t, "debugproject"))
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
	return session
}

func TestTestsAndDebugStayIsolatedAcrossSessions(t *testing.T) {
	delve := findDelveForTest(t)
	recorder := &eventRecorder{}
	ide := NewService(&memoryStore{}, recorder.record)
	t.Cleanup(ide.Shutdown)
	first := openDebugSession(t, ide, delve)
	second := openDebugSession(t, ide, delve)

	if _, err := ide.SetBreakpoints(string(first.ID), "main.go", lineBreakpoints(debugFixtureLine(t, "\t\ttotal += value"))); err != nil {
		t.Fatal(err)
	}
	paused, err := ide.StartDebug(DebugRequest{SessionID: first.ID, Mode: "debug", Target: "."})
	if err != nil {
		t.Fatal(err)
	}
	free, err := ide.StartDebug(DebugRequest{SessionID: second.ID, Mode: "debug", Target: "."})
	if err != nil {
		t.Fatal(err)
	}
	waitDebugState(t, recorder, paused.ID, DebugStopped, 0)
	// Il breakpoint del primo progetto non deve fermare il secondo, che arriva alla fine.
	waitDebugState(t, recorder, free.ID, DebugTerminated, 0)
	if output := debugOutput(recorder, free.ID); !strings.Contains(output, "total 6 3") {
		t.Fatalf("output del secondo progetto inatteso: %q", output)
	}
	if saved, _ := ide.ListBreakpoints(string(second.ID)); len(saved) != 0 {
		t.Fatalf("breakpoint trapelati nel secondo progetto: %+v", saved)
	}

	// Test nel secondo progetto mentre il primo è in pausa nel debugger.
	run, err := ide.StartTests(TestRunRequest{SessionID: second.ID, Packages: []string{"./..."}})
	if err != nil {
		t.Fatal(err)
	}
	finished := waitTestRun(t, recorder, run.RunID)
	if finished.Summary.Passed == 0 {
		t.Fatalf("i test del secondo progetto non sono passati: %+v", finished.Summary)
	}
	if runs, _ := ide.ListTestRuns(string(first.ID)); len(runs) != 0 {
		t.Fatalf("esecuzioni di test trapelate nel primo progetto: %d", len(runs))
	}
	if sessions, _ := ide.ListDebugSessions(string(second.ID)); len(sessions) != 0 {
		t.Fatalf("il debug del primo progetto è visibile nel secondo: %+v", sessions)
	}

	for _, event := range recorder.all() {
		if info, ok := event.Payload.(DebugSessionInfo); ok && info.ID == paused.ID && event.SessionID != first.ID {
			t.Fatalf("evento di debug consegnato alla sessione sbagliata: %+v", event)
		}
	}
	// Chiudere il primo progetto termina il suo debugger, lasciando intatto il secondo.
	if err := ide.CloseSession(string(first.ID)); err != nil {
		t.Fatal(err)
	}
	waitDebugState(t, recorder, paused.ID, DebugTerminated, 0)
	if _, err := ide.ListTestRuns(string(second.ID)); err != nil {
		t.Fatalf("il secondo progetto deve restare utilizzabile: %v", err)
	}
}

// buildHangingProgram compila il progetto di debug senza ottimizzazioni e lo avvia in attesa (DBG_HANG).
func buildHangingProgram(t *testing.T, root string) *exec.Cmd {
	t.Helper()
	binary := filepath.Join(t.TempDir(), executableName("hang"))
	build := exec.Command("go", "build", "-gcflags=all=-N -l", "-o", binary, ".")
	build.Dir = root
	if output, err := build.CombinedOutput(); err != nil {
		t.Fatalf("build fallita: %v\n%s", err, output)
	}
	program := exec.Command(binary)
	program.Env = append(os.Environ(), "DBG_HANG=1")
	if err := program.Start(); err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = program.Process.Kill(); _, _ = program.Process.Wait() })
	return program
}

func pauseAndCheckMain(t *testing.T, ide *Service, recorder *eventRecorder, started DebugSessionInfo) {
	t.Helper()
	waitDebugState(t, recorder, started.ID, DebugRunning, 0)
	if err := ide.DebugStep(string(started.ID), "pause", 0); err != nil {
		t.Fatal(err)
	}
	waitDebugState(t, recorder, started.ID, DebugStopped, 0)
	threads, err := ide.DebugThreads(string(started.ID))
	if err != nil || len(threads) == 0 {
		t.Fatalf("goroutine non disponibili: %v", err)
	}
	found := false
	for _, thread := range threads {
		frames, _ := ide.DebugStackTrace(string(started.ID), thread.ID)
		for _, frame := range frames {
			found = found || frame.Name == "main.main"
		}
	}
	if !found {
		t.Fatal("main.main non trovato negli stack del processo agganciato")
	}
}

func TestDebuggerAttachesToRunningProcessAndDetaches(t *testing.T) {
	ide, recorder, session := startDebugProject(t)
	program := buildHangingProgram(t, session.Project.RealPath)
	started, err := ide.StartDebug(DebugRequest{SessionID: session.ID, Mode: "attach", ProcessID: program.Process.Pid})
	if err != nil {
		t.Fatal(err)
	}
	pauseAndCheckMain(t, ide, recorder, started)
	if err := ide.StopDebug(string(started.ID)); err != nil {
		t.Fatal(err)
	}
	waitDebugState(t, recorder, started.ID, DebugTerminated, 0)
	// Stop si stacca: il programma dell'utente deve restare in esecuzione.
	time.Sleep(300 * time.Millisecond)
	if runtime.GOOS == "windows" {
		return
	}
	if err := program.Process.Signal(syscall.Signal(0)); err != nil {
		t.Fatalf("il processo agganciato è stato terminato invece che staccato: %v", err)
	}
}

func TestDebuggerConnectsToRemoteHeadlessDelve(t *testing.T) {
	ide, recorder, session := startDebugProject(t)
	delve := findDelveForTest(t)
	listener, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		t.Fatal(err)
	}
	address := listener.Addr().String()
	_ = listener.Close()
	server := exec.Command(delve, "debug", "--headless", "--accept-multiclient", "--api-version=2", "--listen="+address, "--continue")
	server.Dir = session.Project.RealPath
	server.Env = append(os.Environ(), "DBG_HANG=1")
	if err := server.Start(); err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = server.Process.Kill(); _, _ = server.Process.Wait() })
	var started DebugSessionInfo
	deadline := time.Now().Add(90 * time.Second)
	for {
		started, err = ide.StartDebug(DebugRequest{SessionID: session.ID, Mode: "remote", Address: address})
		if err != nil {
			t.Fatal(err)
		}
		info := waitDebugStateAny(t, recorder, started.ID, []string{DebugRunning, DebugStopped, DebugTerminated})
		if info.State != DebugTerminated {
			break
		}
		if time.Now().After(deadline) {
			t.Fatalf("server Delve remoto non raggiungibile: %s", info.Error)
		}
		time.Sleep(500 * time.Millisecond)
	}
	pauseAndCheckMain(t, ide, recorder, started)
	if _, err := ide.StartDebug(DebugRequest{SessionID: session.ID, Mode: "remote", Address: "http://x"}); err == nil {
		t.Fatal("indirizzo non valido accettato")
	}
	if err := ide.StopDebug(string(started.ID)); err != nil {
		t.Fatal(err)
	}
	waitDebugState(t, recorder, started.ID, DebugTerminated, 0)
}

func waitDebugStateAny(t *testing.T, recorder *eventRecorder, id DebugSessionID, states []string) DebugSessionInfo {
	t.Helper()
	deadline := time.Now().Add(60 * time.Second)
	for time.Now().Before(deadline) {
		for _, event := range recorder.all() {
			if info, ok := event.Payload.(DebugSessionInfo); ok && info.ID == id {
				for _, state := range states {
					if info.State == state {
						return info
					}
				}
			}
		}
		time.Sleep(20 * time.Millisecond)
	}
	t.Fatalf("nessuno stato tra %v", states)
	return DebugSessionInfo{}
}

// debugFixtureLine trova una riga del fixture debugproject per contenuto: i numeri fissi
// si rompevano a ogni riga aggiunta al fixture.
func debugFixtureLine(t *testing.T, prefix string) int {
	t.Helper()
	content, err := os.ReadFile(filepath.Join("testdata", "debugproject", "main.go"))
	if err != nil {
		t.Fatal(err)
	}
	return lineOf(t, strings.ReplaceAll(string(content), "\r\n", "\n"), prefix)
}
