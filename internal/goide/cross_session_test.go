package goide

import (
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"
)

func TestSameFileInNestedProjectsNeverOverwritesSilently(t *testing.T) {
	root := t.TempDir()
	service := filepath.Join(root, "svc")
	if err := os.MkdirAll(service, 0o755); err != nil {
		t.Fatal(err)
	}
	for path, content := range map[string]string{
		filepath.Join(root, "go.mod"):     "module example.com/repo\n\ngo 1.23\n",
		filepath.Join(service, "go.mod"):  "module example.com/svc\n\ngo 1.23\n",
		filepath.Join(service, "main.go"): "package main\n\nfunc main() {}\n",
	} {
		if err := os.WriteFile(path, []byte(content), 0o644); err != nil {
			t.Fatal(err)
		}
	}
	recorder := &eventRecorder{}
	ide := NewService(&memoryStore{}, recorder.record)
	t.Cleanup(ide.Shutdown)
	outer, err := ide.OpenProject(root)
	if err != nil {
		t.Fatal(err)
	}
	inner, err := ide.OpenProject(service)
	if err != nil {
		t.Fatal(err)
	}
	if outer.ID == inner.ID {
		t.Fatal("progetti annidati devono avere sessioni distinte")
	}
	waitWatching(t, ide, outer.ID)
	waitWatching(t, ide, inner.ID)

	fromOuter, err := ide.OpenDocument(string(outer.ID), "svc/main.go")
	if err != nil {
		t.Fatal(err)
	}
	fromInner, err := ide.OpenDocument(string(inner.ID), "main.go")
	if err != nil {
		t.Fatal(err)
	}
	if fromOuter.Document.Path != fromInner.Document.Path {
		t.Fatalf("stesso file atteso: %s vs %s", fromOuter.Document.Path, fromInner.Document.Path)
	}

	if _, err := ide.SaveDocument(string(outer.ID), string(fromOuter.Document.ID), "package main\n\n// outer\nfunc main() {}\n", fromOuter.DiskToken, false); err != nil {
		t.Fatal(err)
	}
	for _, session := range []Session{outer, inner} {
		recorder.waitFor(t, 5*time.Second, func(event EventEnvelope) bool {
			batch, ok := event.Payload.(FilesChanged)
			if !ok || event.SessionID != session.ID {
				return false
			}
			for _, change := range batch.Changes {
				if strings.HasSuffix(change.Path, filepath.Join("svc", "main.go")) {
					return true
				}
			}
			return false
		})
	}
	state, err := ide.CheckDocument(string(inner.ID), string(fromInner.Document.ID), fromInner.DiskToken)
	if err != nil || !state.Changed || !strings.Contains(state.Content, "// outer") {
		t.Fatalf("la copia dell'altro progetto deve vedere la modifica: %v %+v", err, state)
	}
	if _, err := ide.SaveDocument(string(inner.ID), string(fromInner.Document.ID), "package main\n\n// inner\nfunc main() {}\n", fromInner.DiskToken, false); err == nil {
		t.Fatal("un salvataggio basato su una versione superata deve essere rifiutato")
	}
	onDisk, _ := os.ReadFile(filepath.Join(service, "main.go"))
	if !strings.Contains(string(onDisk), "// outer") {
		t.Fatalf("il file su disco è stato sovrascritto: %s", onDisk)
	}
}

func waitWatching(t *testing.T, ide *Service, sessionID SessionID) {
	t.Helper()
	deadline := time.Now().Add(3 * time.Second)
	for !ide.watcher.Watching(sessionID) {
		if time.Now().After(deadline) {
			t.Fatal("watcher non avviato")
		}
		time.Sleep(10 * time.Millisecond)
	}
}
