package testing

import (
	"adomnia/internal/ide/run"
	"encoding/json"
	"fmt"
	"os"
	"sync"
	"testing"
	"time"
)

type neutralParser struct{}

func (neutralParser) Parse(line []byte) (Event, bool) {
	if string(line) == "pass" {
		return Event{Action: "pass", Package: "neutral", Test: "one", Output: "pass", Failure: &TestLocation{File: "source", Line: 1}}, true
	}
	return Event{}, false
}
func TestNeutralProcess(t *testing.T) {
	if os.Getenv("ADOMNIA_NEUTRAL_TEST") == "1" {
		fmt.Print("pass")
		os.Exit(0)
	}
}

func TestManagerHistoryTailAndSnapshotIsolation(t *testing.T) {
	processes := run.NewProcessManager()
	t.Cleanup(processes.Shutdown)
	manager := NewManager()
	binary, err := os.Executable()
	if err != nil {
		t.Fatal(err)
	}
	var mu sync.Mutex
	finals := make(map[run.RunID]int)
	var first, last run.RunID
	for i := 0; i < 23; i++ {
		done := make(chan Snapshot, 1)
		env, err := run.Environment(map[string]string{"ADOMNIA_NEUTRAL_TEST": "1", "GORACE": "atexit_sleep_ms=0"})
		if err != nil {
			t.Fatal(err)
		}
		snapshot, err := manager.Start(processes, run.CommandSpec{SessionID: "session", Executable: binary, Arguments: []string{"-test.run=^TestNeutralProcess$"}, Environment: env}, neutralParser{}, json.RawMessage(`{"custom":true}`), Hooks{Publish: func(s Snapshot) {
			if s.Status != "running" {
				mu.Lock()
				finals[s.RunID]++
				mu.Unlock()
				done <- s
			}
		}})
		if err != nil {
			t.Fatal(err)
		}
		if i == 0 {
			first = snapshot.RunID
		}
		last = snapshot.RunID
		select {
		case finished := <-done:
			if finished.RunID == "" || finished.Summary.Passed != 1 || finished.FinishedAt == nil {
				t.Fatalf("bad final snapshot: %+v", finished)
			}
		case <-time.After(10 * time.Second):
			t.Fatal("completion lost")
		}
	}
	if len(manager.List("session")) != 20 {
		t.Fatal("history is not bounded")
	}
	if _, err := manager.Snapshot(first); err == nil {
		t.Fatal("oldest run retained")
	}
	if len(manager.List("other")) != 0 {
		t.Fatal("sessions mixed")
	}
	s, err := manager.Snapshot(last)
	if err != nil {
		t.Fatal(err)
	}
	s.Request[0] = 'X'
	*s.FinishedAt = time.Time{}
	for i := range s.Results {
		if s.Results[i].Failure != nil {
			s.Results[i].Failure.File = "mutated"
		}
	}
	again, err := manager.Snapshot(last)
	if err != nil || again.Request[0] != '{' || again.FinishedAt.IsZero() {
		t.Fatal("snapshot mutated stored state")
	}
	for _, result := range again.Results {
		if result.Failure != nil && result.Failure.File != "source" {
			t.Fatal("snapshot mutated stored source location")
		}
	}
	mu.Lock()
	for _, count := range finals {
		if count != 1 {
			t.Fatal("duplicate completion")
		}
	}
	mu.Unlock()
	manager.CloseSession("session")
	if len(manager.List("session")) != 0 {
		t.Fatal("close retained history")
	}
}
