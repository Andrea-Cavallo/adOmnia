package codestudio

import (
	"fmt"
	"os"
	"path/filepath"
	"testing"
	"time"
)

func writeStreamFixture(t *testing.T, files int) string {
	t.Helper()
	root := t.TempDir()
	for index := range files {
		name := filepath.Join(root, fmt.Sprintf("File%04d.java", index))
		if err := os.WriteFile(name, []byte("class File {}\n"), 0o644); err != nil {
			t.Fatal(err)
		}
	}
	return root
}

// A folder larger than the first page returns it synchronously and completes the sorted listing with
// one `directory.entries` event carrying the same stream id.
func TestDirectoryStreamCompletesTheListingWithAnEvent(t *testing.T) {
	root := writeStreamFixture(t, directoryStreamFirstPage+50)
	events := make(chan EventEnvelope, 4)
	service := NewService(&memoryStore{}, func(event EventEnvelope) { events <- event })
	t.Cleanup(service.Shutdown)
	session, err := service.OpenProject(root)
	if err != nil {
		t.Fatal(err)
	}

	start, err := service.StartDirectoryStream(string(session.ID), "", false)
	if err != nil {
		t.Fatal(err)
	}
	if start.Done || start.StreamID == "" {
		t.Fatalf("start = %+v, want a stream", start)
	}
	if len(start.Entries) != directoryStreamFirstPage {
		t.Fatalf("first page = %d entries, want %d", len(start.Entries), directoryStreamFirstPage)
	}

	deadline := time.After(5 * time.Second)
	for {
		select {
		case event := <-events:
			if event.Type != "directory.entries" {
				continue // session.opened and detection events share the sink
			}
			if event.ResourceID != start.StreamID {
				t.Fatalf("event resource = %q, want stream %q", event.ResourceID, start.StreamID)
			}
			chunk, ok := event.Payload.(DirectoryStreamChunk)
			if !ok || !chunk.Done || chunk.StreamID != start.StreamID || len(chunk.Entries) != directoryStreamFirstPage+50 {
				t.Fatalf("chunk = %+v", event.Payload)
			}
			return
		case <-deadline:
			t.Fatal("no directory.entries event")
		}
	}
}

// A folder that fits in the first page needs no event and no stream id.
func TestDirectoryStreamSkipsTheEventForASmallFolder(t *testing.T) {
	root := writeStreamFixture(t, 3)
	events := make(chan EventEnvelope, 2)
	service := NewService(&memoryStore{}, func(event EventEnvelope) { events <- event })
	t.Cleanup(service.Shutdown)
	session, err := service.OpenProject(root)
	if err != nil {
		t.Fatal(err)
	}
	start, err := service.StartDirectoryStream(string(session.ID), "", false)
	if err != nil {
		t.Fatal(err)
	}
	if !start.Done || start.StreamID != "" || len(start.Entries) != 3 {
		t.Fatalf("start = %+v", start)
	}
	deadline := time.After(200 * time.Millisecond)
	for {
		select {
		case event := <-events:
			if event.Type == "directory.entries" {
				t.Fatalf("unexpected directory event: %+v", event)
			}
		case <-deadline:
			return
		}
	}
}
