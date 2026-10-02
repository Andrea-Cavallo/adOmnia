package goide

import (
	"fmt"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func TestGoroutineCreationPointsAtTheGoStatement(t *testing.T) {
	source := "package main\n\nimport \"sync\"\n\nfunc worker(wg *sync.WaitGroup) {\n\tdefer wg.Done()\n\tprintln(\"work\")\n}\n\nfunc main() {\n\tvar wg sync.WaitGroup\n\twg.Add(1)\n\tgo worker(&wg)\n\twg.Wait()\n}\n"
	ide, debugID, threadID := debugInlineProgram(t, source, 7)

	creation, err := ide.DebugGoroutineCreation(debugID, threadID)
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

func TestPendingDefersFollowTheRuntimeChain(t *testing.T) {
	source := `package main

import "fmt"

func inner(n int) {
	defer fmt.Println("inner")
	if n > 10 {
		defer fmt.Println("never")
	}
	for i := 0; i < 2; i++ {
		defer fmt.Println("loop", i)
	}
	println("stop")
}

func outer() {
	defer fmt.Println("outer")
	inner(1)
}

func main() { outer() }
`
	ide, debugID, threadID := debugInlineProgram(t, source, 13)

	defers, err := ide.DebugPendingDefers(debugID, threadID)
	if err != nil {
		t.Fatal(err)
	}
	lines := []int{}
	functions := []string{}
	for _, entry := range defers {
		if entry.Location == nil {
			t.Fatalf("defer senza posizione: %+v", entry)
		}
		lines = append(lines, entry.Location.Line)
		functions = append(functions, entry.Location.Name)
	}
	// LIFO: i due defer del ciclo, poi quello di inner, poi quello di outer; il ramo n > 10 non ha registrato nulla.
	if fmt.Sprint(lines) != "[11 11 6 17]" || fmt.Sprint(functions) != "[main.inner main.inner main.inner main.outer]" {
		t.Fatalf("catena dei defer inattesa: lines=%v functions=%v %+v", lines, functions, defers)
	}
	if !strings.HasPrefix(defers[3].SourceLine, `defer fmt.Println("outer")`) {
		t.Fatalf("riga sorgente inattesa: %q", defers[3].SourceLine)
	}
}

// debugInlineProgram avvia Delve su un programma di un solo file, fermo alla riga indicata.
func debugInlineProgram(t *testing.T, source string, line int) (*Service, string, int) {
	t.Helper()
	delve := findDelveForTest(t)
	root := filepath.Join(t.TempDir(), "inline")
	if err := os.MkdirAll(root, 0o755); err != nil {
		t.Fatal(err)
	}
	for name, content := range map[string]string{"go.mod": "module example.com/inline\n\ngo 1.22\n", "main.go": source} {
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
	if _, err := ide.SetBreakpoints(sessionID, "main.go", lineBreakpoints(line)); err != nil {
		t.Fatal(err)
	}
	started, err := ide.StartDebug(DebugRequest{SessionID: session.ID, Mode: "debug", Target: "."})
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = ide.StopDebug(string(started.ID)) })
	stopped := waitDebugState(t, recorder, started.ID, DebugStopped, 0)
	return ide, string(started.ID), stopped.ThreadID
}
