package testing

import (
	"encoding/json"
	"fmt"
	"os"
	"sync"
	"testing"
	"time"

	"github.com/Andrea-Cavallo/adOmnia/internal/ide/run"
)

type neutralParser struct{}

func (neutralParser) Parse(line []byte) (Event, bool) {
	if string(line) == "pass" {
		return Event{Action: "pass", Package: "neutral", Test: "one", Output: "pass", Failure: &TestLocation{File: "source", Line: 1}}, true
	}
	return Event{}, false
}
func TestNeutralProcess(t *testing.T) {
	if os.Getenv("ADOMNIA_NEUTRAL_FAIL") == "1" {
		fmt.Fprint(os.Stderr, "compile failed: missing symbol\n")
		os.Exit(2)
	}
	if os.Getenv("ADOMNIA_NEUTRAL_TEST") == "1" {
		fmt.Print("pass")
		os.Exit(0)
	}
}

// closingParser non emette righe: chiude l'albero solo quando il processo termina.
type closingParser struct{ closed bool }

func (closingParser) Parse([]byte) (Event, bool) { return Event{}, false }

func (p *closingParser) Finish() []Event {
	if p.closed {
		return nil
	}
	p.closed = true
	return []Event{{Action: "skip", Package: "neutral", Test: "notfinished"}}
}

// TestManagerFinishesOpenTestsWhenTheProcessEnds: un run annullato non manda il report finale; il
// parser chiude i test aperti una sola volta (PY-5.6).
func TestManagerFinishesOpenTestsWhenTheProcessEnds(t *testing.T) {
	processes := run.NewProcessManager()
	t.Cleanup(processes.Shutdown)
	manager := NewManager()
	binary, err := os.Executable()
	if err != nil {
		t.Fatal(err)
	}
	done := make(chan Snapshot, 1)
	parser := &closingParser{}
	_, err = manager.Start(processes, run.CommandSpec{SessionID: "stopped", Executable: binary, Arguments: []string{"-test.run=^TestNeutralProcess$"}}, parser, nil, Hooks{Publish: func(snapshot Snapshot) {
		if snapshot.Status != TestRunning {
			done <- snapshot
		}
	}})
	if err != nil {
		t.Fatal(err)
	}
	select {
	case snapshot := <-done:
		if snapshot.Summary.Skipped != 1 || snapshot.Summary.Running != 0 {
			t.Fatalf("unfinished tests were not closed: %+v", snapshot)
		}
	case <-time.After(10 * time.Second):
		t.Fatal("completion lost")
	}
}

func TestManagerPreservesFailureExitCodeAndDiagnostics(t *testing.T) {
	processes := run.NewProcessManager()
	t.Cleanup(processes.Shutdown)
	manager := NewManager()
	binary, err := os.Executable()
	if err != nil {
		t.Fatal(err)
	}
	env, err := run.Environment(map[string]string{"ADOMNIA_NEUTRAL_FAIL": "1", "GORACE": "atexit_sleep_ms=0"})
	if err != nil {
		t.Fatal(err)
	}
	done := make(chan Snapshot, 1)
	_, err = manager.Start(processes, run.CommandSpec{SessionID: "failure", Executable: binary, Arguments: []string{"-test.run=^TestNeutralProcess$"}, Environment: env}, neutralParser{}, nil, Hooks{Publish: func(snapshot Snapshot) {
		if snapshot.Status != TestRunning {
			done <- snapshot
		}
	}})
	if err != nil {
		t.Fatal(err)
	}
	select {
	case snapshot := <-done:
		if snapshot.Status != "failed" || snapshot.ExitCode == nil || *snapshot.ExitCode != 2 {
			t.Fatalf("failure metadata lost: %+v", snapshot)
		}
		if snapshot.Diagnostics != "compile failed: missing symbol\n" {
			t.Fatalf("stderr lost: %q", snapshot.Diagnostics)
		}
	case <-time.After(10 * time.Second):
		t.Fatal("failure completion lost")
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
	for i := range 23 {
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
