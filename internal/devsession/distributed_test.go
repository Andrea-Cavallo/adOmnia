package devsession

import "testing"

func TestDistributedRequestTracksSecondaryServiceAndGoroutine(t *testing.T) {
	m, events := testManager(Hooks{Stack: func(id string, thread int) ([]Frame, error) {
		return []Frame{{Function: id + ".handler", RelativePath: "handler.go", Line: 12}}, nil
	}})
	m.DebugState("go-a", "a", "running", "a", "", 0, "")
	m.DebugState("go-b", "b", "running", "b", "", 0, "")
	run, err := m.Begin(BeginRequest{SessionID: "debug:a", SessionIDs: []string{"debug:a", "debug:b", "debug:b"}, Method: "GET", URL: "http://localhost:8080/"})
	if err != nil {
		t.Fatal(err)
	}
	if len(run.SessionIDs) != 2 {
		t.Fatalf("deduplication: %+v", run)
	}
	m.DebugState("go-b", "b", "stopped", "", "breakpoint", 23, "")
	waitFor(t, "secondary breakpoint", func() bool { return events.has("breakpoint.hit") })
	paused, _ := m.Run(run.ID)
	if paused.State != RunPaused || len(paused.Hits) != 1 || paused.Hits[0].SessionID != "debug:b" || paused.Hits[0].ThreadID != 23 || paused.Hits[0].Confidence != "probable" {
		t.Fatalf("secondary origin lost: %+v", paused)
	}
	paused.SessionIDs[0] = "mutated"
	paused.Hits[0].Stack[0].Line = 99
	original, _ := m.Run(run.ID)
	if original.SessionIDs[0] != "debug:a" || original.Hits[0].Stack[0].Line != 12 {
		t.Fatal("snapshot aliases mutable state")
	}
	m.DebugState("go-b", "b", "running", "", "", 0, "")
	resumed, _ := m.Run(run.ID)
	if resumed.State != RunSent || !events.has("request.updated") {
		t.Fatalf("secondary resume: %+v", resumed)
	}
	if _, err = m.Begin(BeginRequest{SessionID: "debug:a", SessionIDs: []string{"missing"}, URL: "http://localhost/"}); err == nil {
		t.Fatal("stale member accepted")
	}
}
