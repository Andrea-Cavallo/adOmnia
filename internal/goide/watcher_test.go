package goide

import (
	"fmt"
	"os"
	"path/filepath"
	"sync"
	"testing"
	"time"
)

type batchRecorder struct {
	mu      sync.Mutex
	batches []FilesChanged
}

func (r *batchRecorder) record(_ SessionID, batch FilesChanged) {
	r.mu.Lock()
	r.batches = append(r.batches, batch)
	r.mu.Unlock()
}

func (r *batchRecorder) waitFor(t *testing.T, predicate func([]FilesChanged) bool) []FilesChanged {
	t.Helper()
	deadline := time.Now().Add(5 * time.Second)
	for time.Now().Before(deadline) {
		r.mu.Lock()
		snapshot := append([]FilesChanged(nil), r.batches...)
		r.mu.Unlock()
		if predicate(snapshot) {
			return snapshot
		}
		time.Sleep(20 * time.Millisecond)
	}
	t.Fatalf("batch attesi non ricevuti: %+v", r.batches)
	return nil
}

func changedPaths(batches []FilesChanged) map[string]DiskChangeKind {
	paths := map[string]DiskChangeKind{}
	for _, batch := range batches {
		for _, change := range batch.Changes {
			paths[change.RelativePath] = change.Kind
		}
	}
	return paths
}

func TestWatcherBatchesChangesAndFollowsNewFolders(t *testing.T) {
	root := t.TempDir()
	if err := os.MkdirAll(filepath.Join(root, "node_modules"), 0o755); err != nil {
		t.Fatal(err)
	}
	recorder := &batchRecorder{}
	manager := NewWatchManager(recorder.record)
	t.Cleanup(manager.Shutdown)
	if err := manager.Watch("s", root); err != nil {
		t.Fatal(err)
	}
	for _, name := range []string{"a.go", "b.go", "c.go"} {
		if err := os.WriteFile(filepath.Join(root, name), []byte("package p\n"), 0o644); err != nil {
			t.Fatal(err)
		}
	}
	batches := recorder.waitFor(t, func(batches []FilesChanged) bool { return len(changedPaths(batches)) >= 3 })
	if len(batches) != 1 {
		t.Fatalf("la raffica deve arrivare in un solo batch, ricevuti %d", len(batches))
	}
	if kind := changedPaths(batches)["a.go"]; kind != FileCreated {
		t.Fatalf("a.go deve risultare creato, non %d", kind)
	}

	if err := os.MkdirAll(filepath.Join(root, "pkg", "inner"), 0o755); err != nil {
		t.Fatal(err)
	}
	time.Sleep(300 * time.Millisecond)
	if err := os.WriteFile(filepath.Join(root, "pkg", "inner", "x.go"), []byte("package inner\n"), 0o644); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(root, "node_modules", "ignored.js"), []byte("x"), 0o644); err != nil {
		t.Fatal(err)
	}
	batches = recorder.waitFor(t, func(batches []FilesChanged) bool { _, ok := changedPaths(batches)["pkg/inner/x.go"]; return ok })
	if _, ignored := changedPaths(batches)["node_modules/ignored.js"]; ignored {
		t.Fatal("le cartelle ignorate non vanno osservate")
	}

	if err := os.Remove(filepath.Join(root, "b.go")); err != nil {
		t.Fatal(err)
	}
	recorder.waitFor(t, func(batches []FilesChanged) bool { return changedPaths(batches)["b.go"] == FileDeleted })
}

func TestWatcherReportsOverflowInsteadOfFloodingAndStopsCleanly(t *testing.T) {
	root := t.TempDir()
	recorder := &batchRecorder{}
	manager := NewWatchManager(recorder.record)
	if err := manager.Watch("s", root); err != nil {
		t.Fatal(err)
	}
	for index := 0; index < maxBatchPaths+100; index++ {
		if err := os.WriteFile(filepath.Join(root, fmt.Sprintf("f%04d.go", index)), []byte("package p\n"), 0o644); err != nil {
			t.Fatal(err)
		}
	}
	recorder.waitFor(t, func(batches []FilesChanged) bool {
		for _, batch := range batches {
			if batch.Overflow && len(batch.Changes) == 0 {
				return true
			}
		}
		return false
	})
	manager.Stop("s")
	if manager.Watching("s") {
		t.Fatal("la sessione risulta ancora osservata dopo Stop")
	}
	recorder.mu.Lock()
	before := len(recorder.batches)
	recorder.mu.Unlock()
	if err := os.WriteFile(filepath.Join(root, "late.go"), []byte("package p\n"), 0o644); err != nil {
		t.Fatal(err)
	}
	time.Sleep(400 * time.Millisecond)
	recorder.mu.Lock()
	after := len(recorder.batches)
	recorder.mu.Unlock()
	if after != before {
		t.Fatal("nessun evento dopo Stop")
	}
}

func TestServiceWatchesOpenProjectsAndStopsOnClose(t *testing.T) {
	root := t.TempDir()
	if err := os.WriteFile(filepath.Join(root, "go.mod"), []byte("module example.com/w\n\ngo 1.23\n"), 0o644); err != nil {
		t.Fatal(err)
	}
	recorder := &eventRecorder{}
	service := NewService(&memoryStore{}, recorder.record)
	t.Cleanup(service.Shutdown)
	session, err := service.OpenProject(root)
	if err != nil {
		t.Fatal(err)
	}
	deadline := time.Now().Add(3 * time.Second)
	for !service.watcher.Watching(session.ID) && time.Now().Before(deadline) {
		time.Sleep(10 * time.Millisecond)
	}
	if err := os.WriteFile(filepath.Join(root, "main.go"), []byte("package main\n"), 0o644); err != nil {
		t.Fatal(err)
	}
	recorder.waitFor(t, 5*time.Second, func(event EventEnvelope) bool {
		batch, ok := event.Payload.(FilesChanged)
		return ok && event.Type == "files.changed" && event.SessionID == session.ID && len(batch.Changes) == 1 && batch.Changes[0].RelativePath == "main.go"
	})
	if err := service.CloseSession(string(session.ID)); err != nil {
		t.Fatal(err)
	}
	if service.watcher.Watching(session.ID) {
		t.Fatal("chiudere il progetto deve fermarne il watcher")
	}
}

func TestWatcherHidesTemporaryFilesOfAtomicSaves(t *testing.T) {
	root := t.TempDir()
	target := filepath.Join(root, "main.go")
	if err := os.WriteFile(target, []byte("package main\n"), 0o644); err != nil {
		t.Fatal(err)
	}
	recorder := &batchRecorder{}
	manager := NewWatchManager(recorder.record)
	t.Cleanup(manager.Shutdown)
	if err := manager.Watch("s", root); err != nil {
		t.Fatal(err)
	}
	if err := atomicWriteFile(target, []byte("package main\n\nfunc main() {}\n"), 0o644); err != nil {
		t.Fatal(err)
	}
	batches := recorder.waitFor(t, func(batches []FilesChanged) bool { _, ok := changedPaths(batches)["main.go"]; return ok })
	for path := range changedPaths(batches) {
		if path != "main.go" {
			t.Fatalf("file temporaneo segnalato: %s", path)
		}
	}
}
