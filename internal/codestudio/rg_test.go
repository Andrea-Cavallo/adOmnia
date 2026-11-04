package codestudio

import (
	"context"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"
)

func requireRipgrep(t *testing.T, service *Service) string {
	t.Helper()
	binary, ok := RipgrepBinary(service.toolsRoot)
	if !ok {
		t.Skip("ripgrep is not installed: the Go engine is the fallback")
	}
	return binary
}

func writeSearchTree(t *testing.T, files map[string]string) string {
	t.Helper()
	root := t.TempDir()
	for name, content := range files {
		path := filepath.Join(root, filepath.FromSlash(name))
		if err := os.MkdirAll(filepath.Dir(path), 0o755); err != nil {
			t.Fatal(err)
		}
		if err := os.WriteFile(path, []byte(content), 0o644); err != nil {
			t.Fatal(err)
		}
	}
	return root
}

func TestRipgrepReportsNoMatchesAsSuccess(t *testing.T) {
	service := NewService(&memoryStore{}, nil)
	requireRipgrep(t, service)
	root := writeSearchTree(t, map[string]string{"a.go": "package main\n"})
	session, err := service.OpenProject(root)
	if err != nil {
		t.Fatal(err)
	}
	result, err := service.SearchProject(context.Background(), SearchQuery{SessionID: session.ID, Pattern: "nothing-matches-this"})
	if err != nil {
		t.Fatalf("exit code 1 must be an empty success, got %v", err)
	}
	if len(result.Matches) != 0 || result.Truncated {
		t.Fatalf("result = %+v", result)
	}
}

func TestRipgrepReportsRealErrors(t *testing.T) {
	service := NewService(&memoryStore{}, nil)
	requireRipgrep(t, service)
	root := writeSearchTree(t, map[string]string{"a.go": "package main\n"})
	session, err := service.OpenProject(root)
	if err != nil {
		t.Fatal(err)
	}
	// An invalid glob makes ripgrep exit with 2: that is an error, not "no results".
	_, err = service.SearchProject(context.Background(), SearchQuery{SessionID: session.ID, Pattern: "main", Exclude: []string{"["}})
	if err == nil {
		t.Fatal("an invalid glob must be reported")
	}
}

func TestStartProjectSearchStreamsBatches(t *testing.T) {
	events := make(chan EventEnvelope, 256)
	service := NewService(&memoryStore{}, func(event EventEnvelope) { events <- event })
	requireRipgrep(t, service)
	root := writeSearchTree(t, map[string]string{
		"a.go": strings.Repeat("needle\n", 150),
		"b.go": strings.Repeat("needle\n", 150),
	})
	session, err := service.OpenProject(root)
	if err != nil {
		t.Fatal(err)
	}
	job, err := service.StartProjectSearch(SearchQuery{SessionID: session.ID, Pattern: "needle"})
	if err != nil {
		t.Fatal(err)
	}
	if job.Engine != "ripgrep" || job.ID == "" {
		t.Fatalf("job = %+v", job)
	}
	var batches int
	deadline := time.After(20 * time.Second)
	for {
		select {
		case event := <-events:
			if event.ResourceID != job.ID {
				continue
			}
			switch event.Type {
			case "search.matches":
				batches++
			case "search.done":
				done, ok := event.Payload.(SearchDone)
				if !ok {
					t.Fatalf("done payload = %T", event.Payload)
				}
				if done.Matches != 300 || done.Engine != "ripgrep" {
					t.Fatalf("done = %+v", done)
				}
				if batches < 2 {
					t.Fatalf("expected progressive batches, got %d", batches)
				}
				return
			case "search.error":
				t.Fatalf("search failed: %+v", event.Payload)
			}
		case <-deadline:
			t.Fatal("the search never completed")
		}
	}
}

func TestCancelProjectSearchStopsTheJob(t *testing.T) {
	events := make(chan EventEnvelope, 64)
	service := NewService(&memoryStore{}, func(event EventEnvelope) { events <- event })
	requireRipgrep(t, service)
	root := writeSearchTree(t, map[string]string{"big.go": strings.Repeat("token\n", 2000)})
	session, err := service.OpenProject(root)
	if err != nil {
		t.Fatal(err)
	}
	job, err := service.StartProjectSearch(SearchQuery{SessionID: session.ID, Pattern: "token"})
	if err != nil {
		t.Fatal(err)
	}
	service.CancelProjectSearch(job.ID)
	// A cancelled job must not report a done event: the next search owns the UI.
	timeout := time.After(2 * time.Second)
	for {
		select {
		case event := <-events:
			if event.ResourceID == job.ID && event.Type == "search.done" {
				t.Fatal("a cancelled search reported done")
			}
		case <-timeout:
			return
		}
	}
}
