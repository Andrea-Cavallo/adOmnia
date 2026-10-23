package codestudio

import (
	"context"
	"io"
	"net/http"
	"os"
	"path/filepath"
	"strconv"
	"strings"
	"sync"
	"testing"
	"time"

	"adomnia/internal/devsession"
)

const liveServiceSource = `package main

import (
	"fmt"
	"log"
	"net/http"
	"os"
)

func updateUser(w http.ResponseWriter, r *http.Request) {
	id := r.PathValue("id")
	log.Printf("updating user %s request_id=%s", id, r.Header.Get("X-AdOmnia-Request-ID"))
	fmt.Fprintf(w, "ok %s", id)
}

func main() {
	mux := http.NewServeMux()
	mux.HandleFunc("PUT /users/{id}", updateUser)
	addr := "127.0.0.1:" + os.Getenv("PORT")
	log.Printf("listening on %s", addr)
	log.Fatal(http.ListenAndServe(addr, mux))
}
`

// liveBreakpointLine is the log.Printf line inside updateUser.
const liveBreakpointLine = 13

type liveEvents struct {
	mu     sync.Mutex
	events []devsession.Event
}

func (l *liveEvents) add(event devsession.Event) {
	l.mu.Lock()
	l.events = append(l.events, event)
	l.mu.Unlock()
}

func (l *liveEvents) wait(t *testing.T, eventType string) devsession.Event {
	t.Helper()
	deadline := time.Now().Add(90 * time.Second)
	for time.Now().Before(deadline) {
		l.mu.Lock()
		for _, event := range l.events {
			if event.Type == eventType {
				l.mu.Unlock()
				return event
			}
		}
		l.mu.Unlock()
		time.Sleep(20 * time.Millisecond)
	}
	t.Fatalf("event %s not received", eventType)
	return devsession.Event{}
}

// liveResult is the answer of the debugged service to the request sent by the test.
type liveResult struct {
	status int
	body   string
	err    error
}

// newLiveManager wires an IDE service and a live-session manager the way the app does: debug events
// of the IDE feed the manager, and the manager steps and stops through the IDE.
func newLiveManager(t *testing.T, root string, events *liveEvents) (*devsession.Manager, *Service) {
	t.Helper()
	var manager *devsession.Manager
	ide := NewService(&memoryStore{}, func(event EventEnvelope) {
		if manager == nil {
			return
		}
		switch payload := event.Payload.(type) {
		case DebugSessionInfo:
			manager.DebugState(string(event.SessionID), string(payload.ID), payload.State, payload.Title, payload.StopReason, payload.ThreadID, payload.Error)
		case DebugOutput:
			manager.DebugOutput(string(payload.DebugID), payload.Category, payload.Text)
		}
	})
	t.Cleanup(ide.Shutdown)
	manager = devsession.NewManager(devsession.Hooks{
		Stack: func(debugID string, threadID int) ([]devsession.Frame, error) {
			frames, err := ide.DebugStackTrace(debugID, threadID)
			out := make([]devsession.Frame, 0, len(frames))
			for _, frame := range frames {
				out = append(out, devsession.Frame{Function: frame.Name, File: frame.Path, RelativePath: frame.RelativePath, Line: frame.Line})
			}
			return out, err
		},
		Step:      ide.DebugStep,
		StopDebug: ide.StopDebug,
		Project:   func(string) (string, string) { return "users-service", root },
	}, events.add)
	return manager, ide
}

// startLiveDebug opens the project, trusts it, configures Delve, sets the breakpoint and starts the
// service under the debugger; it returns the live session id and the port the service listens on.
func startLiveDebug(t *testing.T, ide *Service, manager *devsession.Manager, root, delve string) (string, int) {
	t.Helper()
	session, err := ide.OpenProject(root)
	if err != nil {
		t.Fatal(err)
	}
	if _, err := ide.SetToolAuthorization(string(session.ID), true); err != nil {
		t.Fatal(err)
	}
	if info, err := ide.DetectToolchain(string(session.ID)); err != nil || !info.Available {
		t.Fatalf("toolchain not available: %v", err)
	}
	if err := ide.ConfigureDelve(string(session.ID), delve); err != nil {
		t.Fatal(err)
	}
	if _, err := ide.SetBreakpoints(string(session.ID), "main.go", lineBreakpoints(liveBreakpointLine)); err != nil {
		t.Fatal(err)
	}
	port := freePort(t)
	started, err := ide.StartDebug(DebugRequest{SessionID: session.ID, Mode: "debug", Target: ".", Environment: map[string]string{"PORT": strconv.Itoa(port)}})
	if err != nil {
		t.Fatal(err)
	}
	liveID := "debug:" + string(started.ID)
	t.Cleanup(func() { _ = manager.Stop(liveID) })
	return liveID, port
}

// sendLiveRequest performs the PUT in the background, tagged with the run's correlation id.
func sendLiveRequest(url, correlationID string) <-chan liveResult {
	done := make(chan liveResult, 1)
	go func() {
		request, _ := http.NewRequest(http.MethodPut, url, nil)
		request.Header.Set(devsession.CorrelationHeader, correlationID)
		response, err := (&http.Client{Timeout: 2 * time.Minute}).Do(request)
		if err != nil {
			done <- liveResult{err: err}
			return
		}
		defer response.Body.Close()
		body, _ := io.ReadAll(response.Body)
		done <- liveResult{status: response.StatusCode, body: string(body)}
	}()
	return done
}

// expectPausedAtBreakpoint checks that the pause is tied to the request and sits on updateUser,
// and that the HTTP response is still held back by the debugger.
func expectPausedAtBreakpoint(t *testing.T, events *liveEvents, run devsession.RequestRun, done <-chan liveResult) {
	t.Helper()
	hit := events.wait(t, "breakpoint.hit")
	paused := hit.Payload.(map[string]any)["run"].(devsession.RequestRun)
	if paused.ID != run.ID || paused.State != devsession.RunPaused || len(paused.Hits) != 1 {
		t.Fatalf("pause not tied to the request: %+v", paused)
	}
	if h := paused.Hits[0]; h.RelativePath != "main.go" || h.Line != liveBreakpointLine || !strings.HasSuffix(h.Function, "updateUser") {
		t.Fatalf("unexpected breakpoint location: %+v", h)
	}
	select {
	case r := <-done:
		t.Fatalf("the response must wait for the debugger, got %+v", r)
	case <-time.After(300 * time.Millisecond):
	}
}

// expectLogTiedToRun waits for the service's log line carrying the run's correlation id.
func expectLogTiedToRun(t *testing.T, manager *devsession.Manager, liveID, runID string) {
	t.Helper()
	deadline := time.Now().Add(10 * time.Second)
	for time.Now().Before(deadline) {
		for _, entry := range manager.Logs(liveID, runID, 0) {
			if strings.Contains(entry.Text, "updating user 123") && entry.Match == devsession.MatchID {
				return
			}
		}
		time.Sleep(50 * time.Millisecond)
	}
	t.Fatalf("service log line not tied to the request: %+v", manager.Logs(liveID, "", 0))
}

// The Phase 1 loop end to end with a real Go service under a real Delve:
// Run with Debug → the API request reaches the breakpoint → the manager ties
// the pause to the request → Continue from outside Code Studio → HTTP 200, with
// the service's log line tied to the request by its correlation id.
func TestLiveSessionDebugRequestEndToEnd(t *testing.T) {
	delve := findDelveForTest(t)
	root := t.TempDir()
	if err := os.WriteFile(filepath.Join(root, "go.mod"), []byte("module users-service\n\ngo 1.22\n"), 0o644); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(root, "main.go"), []byte(liveServiceSource), 0o644); err != nil {
		t.Fatal(err)
	}
	events := &liveEvents{}
	manager, ide := newLiveManager(t, root, events)
	liveID, port := startLiveDebug(t, ide, manager, root, delve)

	// The port comes from the service's own "listening on" line.
	ready, cancel := context.WithTimeout(context.Background(), 90*time.Second)
	defer cancel()
	if err := manager.WaitReady(ready, liveID); err != nil {
		t.Fatalf("service not ready: %v (%+v)", err, manager.Snapshot().Sessions)
	}
	if got := manager.Snapshot().Sessions[0]; got.Port != port || got.PortSource != "output" {
		t.Fatalf("port not detected from the output: %+v", got)
	}

	url := "http://127.0.0.1:" + strconv.Itoa(port) + "/users/123"
	run, err := manager.Begin(devsession.BeginRequest{Method: "PUT", URL: url, TabID: "tab-1"})
	if err != nil || run.SessionID != liveID {
		t.Fatalf("request not tied to the live session: %+v %v", run, err)
	}
	done := sendLiveRequest(url, run.CorrelationID)
	expectPausedAtBreakpoint(t, events, run, done)

	if err := manager.Step(liveID, "continue"); err != nil {
		t.Fatal(err)
	}
	var r liveResult
	select {
	case r = <-done:
	case <-time.After(60 * time.Second):
		t.Fatal("no response after continue")
	}
	if r.err != nil || r.status != http.StatusOK || r.body != "ok 123" {
		t.Fatalf("unexpected response: %+v", r)
	}
	completed, err := manager.End(run.ID, r.status, 0, "")
	if err != nil || completed.State != devsession.RunCompleted || len(completed.Hits) != 1 {
		t.Fatalf("run not completed: %+v %v", completed, err)
	}
	expectLogTiedToRun(t, manager, liveID, run.ID)
}
