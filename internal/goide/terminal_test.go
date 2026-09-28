package goide

import (
	"os"
	"runtime"
	"strings"
	"sync"
	"testing"
	"time"
)

// terminalRecorder raccoglie gli eventi emessi dal TerminalManager durante i test.
type terminalRecorder struct {
	mu      sync.Mutex
	output  strings.Builder
	exited  chan TerminalSession
	opened  int
	closeOK bool
}

func newTerminalRecorder() *terminalRecorder {
	return &terminalRecorder{exited: make(chan TerminalSession, 4)}
}

func (r *terminalRecorder) sink(eventType string, terminal TerminalSession, payload any) {
	r.mu.Lock()
	defer r.mu.Unlock()
	switch eventType {
	case "terminal.opened":
		r.opened++
	case "terminal.output":
		if chunk, ok := payload.(TerminalOutput); ok {
			r.output.WriteString(chunk.Data)
		}
	case "terminal.exited":
		r.closeOK = true
		select {
		case r.exited <- terminal:
		default:
		}
	}
}

func (r *terminalRecorder) text() string {
	r.mu.Lock()
	defer r.mu.Unlock()
	return r.output.String()
}

// waitForOutput attende che l'output del terminale contenga il marcatore atteso.
func waitForOutput(t *testing.T, recorder *terminalRecorder, marker string, timeout time.Duration) string {
	t.Helper()
	deadline := time.Now().Add(timeout)
	for time.Now().Before(deadline) {
		if text := recorder.text(); strings.Contains(text, marker) {
			return text
		}
		time.Sleep(25 * time.Millisecond)
	}
	return recorder.text()
}

func shellEcho(marker string) string {
	if runtime.GOOS == "windows" {
		return "echo " + marker + "\r\n"
	}
	return "echo " + marker + "\n"
}

func shellExit() string {
	if runtime.GOOS == "windows" {
		return "exit\r\n"
	}
	return "exit\n"
}

func TestTerminalRunsInteractiveShellAndExitsNaturally(t *testing.T) {
	recorder := newTerminalRecorder()
	manager := NewTerminalManager()
	manager.SetEventSink(recorder.sink)
	t.Cleanup(manager.Shutdown)

	workingDirectory := t.TempDir()
	terminal, err := manager.Open(TerminalRequest{
		SessionID: "session-a", WorkingDirectory: workingDirectory, Columns: 100, Rows: 30,
	}, os.Environ())
	if err != nil {
		t.Skipf("PTY non disponibile in questo ambiente: %v", err)
	}
	if terminal.Status != "running" || terminal.PID == 0 {
		t.Fatalf("terminale non avviato correttamente: %+v", terminal)
	}

	const marker = "ADOMNIA_PTY_OK"
	if err := manager.Write(terminal.ID, shellEcho(marker)); err != nil {
		t.Fatal(err)
	}
	if text := waitForOutput(t, recorder, marker, 15*time.Second); !strings.Contains(text, marker) {
		t.Fatalf("output del terminale non ricevuto, letto: %q", truncateForLog(text))
	}

	if err := manager.Resize(terminal.ID, 120, 40); err != nil {
		t.Fatalf("resize del terminale fallito: %v", err)
	}

	if err := manager.Write(terminal.ID, shellExit()); err != nil {
		t.Fatal(err)
	}
	select {
	case exited := <-recorder.exited:
		if exited.ExitedAt == nil {
			t.Fatal("l'uscita naturale deve registrare il momento di chiusura")
		}
		if exited.Status != "exited" && exited.Status != "closed" {
			t.Fatalf("stato finale inatteso: %+v", exited)
		}
	case <-time.After(15 * time.Second):
		t.Fatal("la shell non è uscita dopo il comando exit")
	}
}

func TestTerminalCloseIsIdempotentAndIsolatedPerSession(t *testing.T) {
	manager := NewTerminalManager()
	manager.SetEventSink(func(string, TerminalSession, any) {})
	t.Cleanup(manager.Shutdown)

	first, err := manager.Open(TerminalRequest{SessionID: "session-a", WorkingDirectory: t.TempDir()}, os.Environ())
	if err != nil {
		t.Skipf("PTY non disponibile in questo ambiente: %v", err)
	}
	second, err := manager.Open(TerminalRequest{SessionID: "session-b", WorkingDirectory: t.TempDir()}, os.Environ())
	if err != nil {
		t.Fatal(err)
	}

	if len(manager.List("session-a")) != 1 || len(manager.List("session-b")) != 1 {
		t.Fatal("ogni sessione deve vedere soltanto i propri terminali")
	}

	manager.CloseSession("session-a")
	if len(manager.List("session-a")) != 0 {
		t.Fatal("la chiusura di una sessione deve rilasciarne i terminali")
	}
	if len(manager.List("session-b")) != 1 {
		t.Fatal("la chiusura di una sessione non deve toccare le altre")
	}
	if !manager.HasActiveSession("session-b") {
		t.Fatal("la sessione superstite deve risultare ancora attiva")
	}

	// Chiudere due volte lo stesso terminale non deve produrre errori.
	if err := manager.Close(first.ID); err != nil {
		t.Fatalf("chiusura ripetuta non idempotente: %v", err)
	}
	if err := manager.Close(second.ID); err != nil {
		t.Fatal(err)
	}
	if err := manager.Close(second.ID); err != nil {
		t.Fatalf("chiusura ripetuta non idempotente: %v", err)
	}

	if err := manager.Write(first.ID, "echo tardi\n"); err == nil {
		t.Fatal("scrivere su un terminale chiuso deve fallire con un errore chiaro")
	}
}

func TestTerminalRejectsInvalidWorkingDirectoryAndSessionLimit(t *testing.T) {
	manager := NewTerminalManager()
	t.Cleanup(manager.Shutdown)

	if _, err := manager.Open(TerminalRequest{WorkingDirectory: t.TempDir()}, os.Environ()); err == nil {
		t.Fatal("un terminale senza sessione deve essere rifiutato")
	}
	if _, err := manager.Open(TerminalRequest{
		SessionID: "session-a", WorkingDirectory: "/percorso/che/non/esiste/davvero",
	}, os.Environ()); err == nil {
		t.Fatal("una working directory inesistente deve essere rifiutata")
	}
}

// TestTerminalCloseTerminatesChildTree verifica che chiudere un terminale
// arresti anche i processi figli avviati dentro la shell.
func TestTerminalCloseTerminatesChildTree(t *testing.T) {
	if runtime.GOOS != "windows" && runtime.GOOS != "linux" && runtime.GOOS != "darwin" {
		t.Skip("piattaforma non coperta dal test di cleanup")
	}
	recorder := newTerminalRecorder()
	manager := NewTerminalManager()
	manager.SetEventSink(recorder.sink)
	t.Cleanup(manager.Shutdown)

	terminal, err := manager.Open(TerminalRequest{SessionID: "session-a", WorkingDirectory: t.TempDir()}, os.Environ())
	if err != nil {
		t.Skipf("PTY non disponibile in questo ambiente: %v", err)
	}

	// Avvia un figlio di lunga durata dentro la shell e ne stampa il PID.
	const marker = "CHILD_PID="
	var command string
	if runtime.GOOS == "windows" {
		command = "start /b ping -n 120 127.0.0.1 > nul\r\necho " + marker + "started\r\n"
	} else {
		command = "sleep 120 & echo " + marker + "$!\n"
	}
	if err := manager.Write(terminal.ID, command); err != nil {
		t.Fatal(err)
	}
	if text := waitForOutput(t, recorder, marker, 15*time.Second); !strings.Contains(text, marker) {
		t.Skipf("la shell non ha confermato l'avvio del figlio: %q", truncateForLog(text))
	}

	if err := manager.Close(terminal.ID); err != nil {
		t.Fatal(err)
	}
	if manager.HasActiveSession("session-a") {
		t.Fatal("dopo la chiusura la sessione non deve avere terminali attivi")
	}
	if !waitProcessGone(terminal.PID, 3*time.Second) {
		t.Fatalf("la shell %d è rimasta viva dopo la chiusura", terminal.PID)
	}
}

// waitProcessGone attende che il PID indicato sparisca, riusando il controllo
// per piattaforma gia' presente nel package.
func waitProcessGone(pid int, timeout time.Duration) bool {
	if pid <= 0 {
		return true
	}
	deadline := time.Now().Add(timeout)
	for time.Now().Before(deadline) {
		if !processAlive(pid) {
			return true
		}
		time.Sleep(100 * time.Millisecond)
	}
	return !processAlive(pid)
}

func truncateForLog(value string) string {
	const limit = 400
	if len(value) <= limit {
		return value
	}
	return value[:limit] + "…"
}
