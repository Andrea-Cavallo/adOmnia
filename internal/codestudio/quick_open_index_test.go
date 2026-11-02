package codestudio

import (
	"os"
	"path/filepath"
	"sync"
	"testing"
	"time"
)

func quickOpenNames(t *testing.T, service *Service, id SessionID, query string) map[string]bool {
	t.Helper()
	results, err := service.QuickOpen(string(id), query, MaxQuickOpenResults)
	if err != nil {
		t.Fatal(err)
	}
	names := map[string]bool{}
	for _, result := range results {
		names[result.RelativePath] = true
	}
	return names
}

func TestQuickOpenIndexFollowsWatcherWithoutRebuild(t *testing.T) {
	root := writeOpenFixture(t, 100)
	service := NewService(&memoryStore{}, nil)
	t.Cleanup(service.Shutdown)
	session, err := service.OpenProject(root)
	if err != nil {
		t.Fatal(err)
	}
	quickOpenNames(t, service, session.ID, "")
	builds := func() float64 { return service.GetWorkspaceLoadPerformance()["fileIndexBuildCount"] }
	if builds() != 1 {
		t.Fatalf("fileIndexBuildCount = %v dopo la prima query", builds())
	}

	created := filepath.Join(root, "svc000", "internal", "pkg0000", "fresh_delta.go")
	if err := os.WriteFile(created, []byte("package pkg0000\n"), 0o644); err != nil {
		t.Fatal(err)
	}
	removedDir := filepath.Join(root, "svc000", "internal", "pkg0001")
	if err := os.RemoveAll(removedDir); err != nil {
		t.Fatal(err)
	}
	service.filesChanged(session.ID, FilesChanged{Changes: []DiskChange{
		{Path: created, RelativePath: "svc000/internal/pkg0000/fresh_delta.go", Kind: FileCreated},
		{Path: removedDir, RelativePath: "svc000/internal/pkg0001", Kind: FileDeleted},
	}})
	names := quickOpenNames(t, service, session.ID, "")
	if !names["svc000/internal/pkg0000/fresh_delta.go"] {
		t.Error("file creato assente dall'indice")
	}
	for name := range names {
		if filepath.ToSlash(filepath.Dir(name)) == "svc000/internal/pkg0001" {
			t.Fatalf("file della cartella eliminata ancora nell'indice: %s", name)
		}
	}
	if builds() != 1 {
		t.Fatalf("il delta ha ricostruito l'indice: fileIndexBuildCount = %v", builds())
	}

	// Una cartella nuova porta un sottoalbero: si ricostruisce.
	newDir := filepath.Join(root, "svc000", "internal", "pkgnew")
	if err := os.MkdirAll(newDir, 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(newDir, "inside.go"), []byte("package pkgnew\n"), 0o644); err != nil {
		t.Fatal(err)
	}
	service.filesChanged(session.ID, FilesChanged{Changes: []DiskChange{{Path: newDir, RelativePath: "svc000/internal/pkgnew", Kind: FileCreated}}})
	if !quickOpenNames(t, service, session.ID, "inside")["svc000/internal/pkgnew/inside.go"] {
		t.Error("file dentro la cartella nuova assente dopo la ricostruzione")
	}
	if builds() != 2 {
		t.Fatalf("fileIndexBuildCount = %v, attesa una ricostruzione", builds())
	}
}

func TestConcurrentQuickOpenBuildsIndexOnce(t *testing.T) {
	root := writeOpenFixture(t, 2000)
	service := NewService(&memoryStore{}, nil)
	t.Cleanup(service.Shutdown)
	session, err := service.OpenProject(root)
	if err != nil {
		t.Fatal(err)
	}
	var group sync.WaitGroup
	for range 8 {
		group.Go(func() {
			if _, err := service.QuickOpen(string(session.ID), "handler", 10); err != nil {
				t.Error(err)
			}
		})
	}
	group.Wait()
	if got := service.GetWorkspaceLoadPerformance()["fileIndexBuildCount"]; got != 1 {
		t.Fatalf("fileIndexBuildCount = %v con 8 ricerche concorrenti, attesa 1", got)
	}
}

func TestIndexWarmsInBackgroundAfterWatcher(t *testing.T) {
	root := writeOpenFixture(t, 100)
	service := NewService(&memoryStore{}, nil)
	t.Cleanup(service.Shutdown)
	service.warmer.delay = time.Millisecond
	if _, err := service.OpenProject(root); err != nil {
		t.Fatal(err)
	}
	deadline := time.Now().Add(10 * time.Second)
	for service.GetWorkspaceLoadPerformance()["fileIndexBuildCount"] != 1 {
		if time.Now().After(deadline) {
			t.Fatal("indice Quick Open non preparato in background")
		}
		time.Sleep(5 * time.Millisecond)
	}
}

func TestShutdownStopsPendingIndexWarm(t *testing.T) {
	warmer := newIndexWarmer()
	warmer.delay = 20 * time.Millisecond
	ran := make(chan struct{}, 1)
	warmer.schedule("s1", func() { ran <- struct{}{} })
	warmer.stopAll()
	warmer.schedule("s2", func() { ran <- struct{}{} })
	select {
	case <-ran:
		t.Fatal("warm partito dopo lo shutdown")
	case <-time.After(60 * time.Millisecond):
	}
}

func TestQuickOpenBuildsOnlyOnDemand(t *testing.T) {
	root := writeOpenFixture(t, 100)
	service := NewService(&memoryStore{}, nil)
	t.Cleanup(service.Shutdown)
	session, err := service.OpenProject(root)
	if err != nil {
		t.Fatal(err)
	}
	if got := service.GetWorkspaceLoadPerformance()["fileIndexBuildCount"]; got != 0 {
		t.Fatalf("index built before search: %v", got)
	}
	first := quickOpenNames(t, service, session.ID, "")
	if len(first) == 0 {
		t.Fatal("first search returned no results")
	}
	quickOpenNames(t, service, session.ID, "")
	if got := service.GetWorkspaceLoadPerformance()["fileIndexBuildCount"]; got != 1 {
		t.Fatalf("expected a single cached build: %v", got)
	}
}
