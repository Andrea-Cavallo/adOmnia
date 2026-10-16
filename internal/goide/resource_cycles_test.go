package goide

import (
	"runtime"
	"sync"
	"testing"
	"time"

	"adomnia/internal/ide/graph"
)

func TestSessionCyclesReleaseDocumentsWatchersAndGraphCaches(t *testing.T) {
	root := t.TempDir()
	writeFixtureFile(t, root, "go.mod", "module example.test/cycles\n\ngo 1.26\n")
	writeFixtureFile(t, root, "main.go", "package main\nfunc main() {}\n")
	service := NewService(&memoryStore{}, nil)
	t.Cleanup(service.Shutdown)
	graphs := service.graphs()
	before := runtime.NumGoroutine()
	for cycle := 0; cycle < 15; cycle++ {
		session, err := service.OpenProject(root)
		if err != nil {
			t.Fatal(err)
		}
		id := string(session.ID)
		if _, err := service.OpenDocument(id, "main.go"); err != nil {
			t.Fatal(err)
		}
		service.depGraph.set(dependencyGraphKey(session.ID, root, "go"), "stamp", DependencyGraphReport{ModulePath: "fixture"})
		service.remember(id, graph.Graph{})
		graphs.mu.Lock()
		graphs.building[id] = &sync.Mutex{}
		graphs.mu.Unlock()
		if err := service.CloseSession(id); err != nil {
			t.Fatal(err)
		}
		// Simulate a graph computation finishing after CloseSession returned.
		service.remember(id, graph.Graph{})
		if service.workspace.whileOpen(session.ID, func() { t.Fatal("closed session accepted a cache update") }) {
			t.Fatal("session still open")
		}
		service.depGraph.mu.Lock()
		depEntries := len(service.depGraph.entries)
		service.depGraph.mu.Unlock()
		graphs.mu.Lock()
		graphEntries, builders := len(graphs.cached), len(graphs.building)
		graphs.mu.Unlock()
		service.documents.mu.RLock()
		documents := len(service.documents.documents)
		service.documents.mu.RUnlock()
		service.watcher.mu.Lock()
		watchers := len(service.watcher.sessions)
		service.watcher.mu.Unlock()
		if depEntries+graphEntries+builders+documents+watchers != 0 {
			t.Fatalf("cycle %d retained deps=%d graphs=%d builders=%d documents=%d watchers=%d", cycle, depEntries, graphEntries, builders, documents, watchers)
		}
	}
	deadline := time.Now().Add(3 * time.Second)
	for runtime.NumGoroutine() > before+2 && time.Now().Before(deadline) {
		time.Sleep(20 * time.Millisecond)
	}
	after := runtime.NumGoroutine()
	t.Logf("15 workspace cycles: goroutines %d -> %d; session caches/documents/watchers=0", before, after)
	if after > before+2 {
		t.Fatalf("persistent goroutine growth: %d -> %d", before, after)
	}
}
