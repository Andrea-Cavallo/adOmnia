package goide

import (
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func TestGoroutineCreationPointsAtTheGoStatement(t *testing.T) {
	delve := findDelveForTest(t)
	root := filepath.Join(t.TempDir(), "spawn")
	source := "package main\n\nimport \"sync\"\n\nfunc worker(wg *sync.WaitGroup) {\n\tdefer wg.Done()\n\tprintln(\"work\")\n}\n\nfunc main() {\n\tvar wg sync.WaitGroup\n\twg.Add(1)\n\tgo worker(&wg)\n\twg.Wait()\n}\n"
	for name, content := range map[string]string{"go.mod": "module example.com/spawn\n\ngo 1.22\n", "main.go": source} {
		if err := os.MkdirAll(root, 0o755); err != nil {
			t.Fatal(err)
		}
		if err := os.WriteFile(filepath.Join(root, name), []byte(content), 0o644); err != nil {
			t.Fatal(err)
		}
	}
	recorder := &eventRecorder{}
	ide := NewService(&memoryStore{}, recorder.record)
	t.Cleanup(ide.Shutdown)
	session, err := ide.OpenProject(root)
	if err != nil {
		t.Fatal(err)
	}
	sessionID := string(session.ID)
	if _, err := ide.SetToolAuthorization(sessionID, true); err != nil {
		t.Fatal(err)
	}
	if info, err := ide.DetectToolchain(sessionID); err != nil || !info.Available {
		t.Fatalf("toolchain non disponibile: %v", err)
	}
	if err := ide.ConfigureDelve(sessionID, delve); err != nil {
		t.Fatal(err)
	}
	if _, err := ide.SetBreakpoints(sessionID, "main.go", lineBreakpoints(7)); err != nil {
		t.Fatal(err)
	}
	started, err := ide.StartDebug(DebugRequest{SessionID: session.ID, Mode: "debug", Target: "."})
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = ide.StopDebug(string(started.ID)) })
	stopped := waitDebugState(t, recorder, started.ID, DebugStopped, 0)

	creation, err := ide.DebugGoroutineCreation(string(started.ID), stopped.ThreadID)
	if err != nil {
		t.Fatal(err)
	}
	if creation.Location == nil || creation.Location.RelativePath != "main.go" || creation.Location.Line != 13 {
		t.Fatalf("la creazione deve puntare a `go worker(&wg)` (main.go:13): %+v", creation.Location)
	}
	if !strings.HasPrefix(creation.SourceLine, "go worker") || creation.ParentID != 1 {
		t.Fatalf("riga o goroutine madre inattese: %+v", creation)
	}
}
