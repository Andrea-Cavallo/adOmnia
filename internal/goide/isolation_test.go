package goide

import (
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"testing"
	"time"
)

// TestTwoProjectsStayIsolatedWhileRunningTogether apre due progetti autorizzati e li fa lavorare
// in parallelo (go run, terminale, configurazioni): nessun output o risorsa passa da uno all'altro.
func TestTwoProjectsStayIsolatedWhileRunningTogether(t *testing.T) {
	if _, err := exec.LookPath("go"); err != nil {
		t.Skip("toolchain Go non disponibile")
	}
	recorder := &eventRecorder{}
	ide := NewService(&memoryStore{}, recorder.record)
	t.Cleanup(ide.Shutdown)
	sessions := map[string]Session{}
	for _, name := range []string{"alpha", "beta"} {
		root := filepath.Join(t.TempDir(), name)
		if err := os.MkdirAll(root, 0o755); err != nil {
			t.Fatal(err)
		}
		files := map[string]string{
			"go.mod":  fmt.Sprintf("module example.com/%s\n\ngo 1.23\n", name),
			"main.go": fmt.Sprintf("package main\n\nimport \"fmt\"\n\nfunc main() { fmt.Println(\"run-output-%s\") }\n", name),
		}
		for file, content := range files {
			if err := os.WriteFile(filepath.Join(root, file), []byte(content), 0o644); err != nil {
				t.Fatal(err)
			}
		}
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
		if _, err := ide.SaveRunConfiguration(string(session.ID), RunConfiguration{SessionID: session.ID, Name: "run " + name, Kind: RunKindPackage, Target: "."}); err != nil {
			t.Fatal(err)
		}
		sessions[name] = session
	}

	terminals := map[string]TerminalSession{}
	for name, session := range sessions {
		if _, err := ide.StartRun(RunRequest{SessionID: session.ID, Kind: "run", Target: "."}); err != nil {
			t.Fatal(err)
		}
		terminal, err := ide.OpenTerminal(TerminalRequest{SessionID: session.ID, Columns: 80, Rows: 24})
		if err != nil {
			t.Skipf("PTY non disponibile: %v", err)
		}
		terminals[name] = terminal
	}
	for name, terminal := range terminals {
		if err := ide.WriteTerminal(string(terminal.ID), fmt.Sprintf("echo shell-$((40+2))-%s\n", name)); err != nil {
			t.Fatal(err)
		}
	}

	outputs := func(session Session) string {
		var text strings.Builder
		for _, event := range recorder.all() {
			if event.SessionID != session.ID {
				continue
			}
			switch payload := event.Payload.(type) {
			case ProcessOutput:
				text.WriteString(payload.Text)
			case TerminalOutput:
				text.WriteString(payload.Data)
			}
		}
		return text.String()
	}
	deadline := time.Now().Add(60 * time.Second)
	for {
		alpha, beta := outputs(sessions["alpha"]), outputs(sessions["beta"])
		if strings.Contains(alpha, "run-output-alpha") && strings.Contains(alpha, "shell-42-alpha") && strings.Contains(beta, "run-output-beta") && strings.Contains(beta, "shell-42-beta") {
			if strings.Contains(alpha, "beta") || strings.Contains(beta, "alpha") {
				t.Fatalf("output passato da un progetto all'altro:\nalpha: %q\nbeta: %q", alpha, beta)
			}
			break
		}
		if time.Now().After(deadline) {
			t.Fatalf("output attesi non arrivati:\nalpha: %q\nbeta: %q", alpha, beta)
		}
		time.Sleep(50 * time.Millisecond)
	}
	for name, session := range sessions {
		configs, err := ide.ListRunConfigurations(string(session.ID))
		if err != nil || len(configs) != 1 || configs[0].Name != "run "+name {
			t.Fatalf("configurazioni non isolate per %s: %v %+v", name, err, configs)
		}
	}

	// Chiudere alpha libera le sue risorse e lascia vivo il terminale di beta.
	waitNoActiveRuns(t, ide, sessions["alpha"].ID)
	if err := ide.CloseTerminal(string(terminals["alpha"].ID)); err != nil {
		t.Fatal(err)
	}
	if err := ide.CloseSession(string(sessions["alpha"].ID)); err != nil {
		t.Fatal(err)
	}
	if ide.watcher.Watching(sessions["alpha"].ID) || !ide.watcher.Watching(sessions["beta"].ID) {
		t.Fatal("la chiusura di un progetto deve fermare solo il suo watcher")
	}
	if len(ide.terminal.List(sessions["beta"].ID)) != 1 {
		t.Fatal("il terminale dell'altro progetto deve restare aperto")
	}
}

func waitNoActiveRuns(t *testing.T, ide *Service, sessionID SessionID) {
	t.Helper()
	deadline := time.Now().Add(30 * time.Second)
	for ide.processes.HasActiveSession(sessionID) {
		if time.Now().After(deadline) {
			t.Fatal("esecuzioni ancora attive")
		}
		time.Sleep(20 * time.Millisecond)
	}
}
