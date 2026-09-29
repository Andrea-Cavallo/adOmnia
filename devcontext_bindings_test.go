package main

import (
	"adomnia/internal/goide"
	"os"
	"path/filepath"
	"testing"
	"time"
)

func TestDevContextReactsToGoIDEEvents(t *testing.T) {
	root := t.TempDir()
	if err := os.WriteFile(filepath.Join(root, "go.mod"), []byte("module example.com/a\n"), 0o644); err != nil {
		t.Fatal(err)
	}
	d := newDevContext(func(string) (string, error) { return root, nil })
	snap, err := d.GetContext("s1")
	if err != nil || len(snap.Entities) != 1 {
		t.Fatalf("initial scan: %v %+v", err, snap)
	}
	if err := os.WriteFile(filepath.Join(root, "main.go"), []byte("package main\nfunc main() {}\n"), 0o644); err != nil {
		t.Fatal(err)
	}
	d.handleGoIDEEvent(goide.EventEnvelope{Type: "document.saved", SessionID: "s1", Payload: goide.Document{RelativePath: "main.go"}})
	deadline := time.Now().Add(2 * time.Second)
	for time.Now().Before(deadline) {
		if snap, _ = d.GetContext("s1"); len(snap.Entities) == 2 {
			break
		}
		time.Sleep(10 * time.Millisecond)
	}
	if len(snap.Entities) != 2 {
		t.Fatalf("document.saved must rescan the file, got %+v", snap.Entities)
	}
	d.handleGoIDEEvent(goide.EventEnvelope{Type: "session.closed", SessionID: "s1"})
	if snap, _ = d.GetContext("s1"); snap.Version != 1 {
		t.Fatalf("session.closed must drop the context, got version %d", snap.Version)
	}
}
