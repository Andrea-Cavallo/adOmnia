package goide

import (
	"path/filepath"
	"strings"
	"testing"
	"time"
)

func waitServiceEvent(t *testing.T, events <-chan EventEnvelope, predicate func(EventEnvelope) bool) EventEnvelope {
	t.Helper()
	deadline := time.After(30 * time.Second)
	for {
		select {
		case event := <-events:
			if predicate(event) {
				return event
			}
		case <-deadline:
			t.Fatal("timeout in attesa dell'evento Go Studio")
		}
	}
}

func TestServiceRunFixtureEndToEnd(t *testing.T) {
	fixture, err := filepath.Abs(filepath.Join("testdata", "interactive"))
	if err != nil {
		t.Fatal(err)
	}
	events := make(chan EventEnvelope, 256)
	service := NewService(&memoryStore{}, func(event EventEnvelope) { events <- event })
	t.Cleanup(service.Shutdown)
	session, err := service.OpenProject(fixture)
	if err != nil {
		t.Fatal(err)
	}
	if _, err := service.SetToolAuthorization(string(session.ID), true); err != nil {
		t.Fatal(err)
	}
	execution, err := service.StartRun(RunRequest{SessionID: session.ID, Kind: "run", Target: "."})
	if err != nil {
		t.Fatal(err)
	}
	waitServiceEvent(t, events, func(event EventEnvelope) bool {
		output, ok := event.Payload.(ProcessOutput)
		return ok && output.RunID == execution.ID && strings.Contains(output.Text, "fixture ready")
	})
	if err := service.WriteRunInput(string(execution.ID), "adomnia\n"); err != nil {
		t.Fatal(err)
	}
	waitServiceEvent(t, events, func(event EventEnvelope) bool {
		output, ok := event.Payload.(ProcessOutput)
		return ok && output.RunID == execution.ID && strings.Contains(output.Text, "echo: adomnia")
	})
	if err := service.StopRun(string(execution.ID)); err != nil {
		t.Fatal(err)
	}
	finished := waitServiceEvent(t, events, func(event EventEnvelope) bool {
		next, ok := event.Payload.(Execution)
		return event.Type == "run.finished" && ok && next.ID == execution.ID
	})
	final := finished.Payload.(Execution)
	if final.Status != "stopped" || service.HasActiveRuns(string(session.ID)) {
		t.Fatalf("cleanup esecuzione incompleto: %#v", final)
	}
}
