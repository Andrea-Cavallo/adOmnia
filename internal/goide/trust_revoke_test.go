package goide

import (
	"testing"
	"time"
)

// Revocare la fiducia deve fermare anche i terminali, non solo processi e gopls (IDE-5.1).
func TestRevokingTrustClosesTerminals(t *testing.T) {
	root := t.TempDir()
	writeFixtureFile(t, root, "go.mod", "module example.com/trust\n\ngo 1.22\n")
	writeFixtureFile(t, root, "main.go", "package main\n\nfunc main() {}\n")
	service := NewService(&memoryStore{}, nil)
	t.Cleanup(service.Shutdown)
	session, err := service.OpenProject(root)
	if err != nil {
		t.Fatal(err)
	}
	id := string(session.ID)
	if _, err := service.SetToolAuthorization(id, true); err != nil {
		t.Fatal(err)
	}
	if _, err := service.OpenTerminal(TerminalRequest{SessionID: session.ID, Columns: 80, Rows: 24}); err != nil {
		t.Skipf("PTY non disponibile: %v", err)
	}
	if !service.HasActiveTerminals(id) {
		t.Fatal("il terminale non risulta attivo")
	}
	if _, err := service.SetToolAuthorization(id, false); err != nil {
		t.Fatal(err)
	}
	deadline := time.Now().Add(10 * time.Second)
	for service.HasActiveTerminals(id) {
		if time.Now().After(deadline) {
			t.Fatal("il terminale è rimasto vivo dopo la revoca della fiducia")
		}
		time.Sleep(50 * time.Millisecond)
	}
}
