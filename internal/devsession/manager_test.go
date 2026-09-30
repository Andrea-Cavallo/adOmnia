package devsession

import (
	"context"
	"net"
	"net/http"
	"net/http/httptest"
	"sync"
	"testing"
	"time"
)

type recorder struct {
	mu     sync.Mutex
	events []Event
}

func (r *recorder) emit(event Event) {
	r.mu.Lock()
	r.events = append(r.events, event)
	r.mu.Unlock()
}

func (r *recorder) has(eventType string) bool {
	r.mu.Lock()
	defer r.mu.Unlock()
	for _, event := range r.events {
		if event.Type == eventType {
			return true
		}
	}
	return false
}

func waitFor(t *testing.T, what string, cond func() bool) {
	t.Helper()
	deadline := time.Now().Add(3 * time.Second)
	for time.Now().Before(deadline) {
		if cond() {
			return
		}
		time.Sleep(10 * time.Millisecond)
	}
	t.Fatalf("timed out waiting for %s", what)
}

func testManager(hooks Hooks) (*Manager, *recorder) {
	events := &recorder{}
	if hooks.Project == nil {
		hooks.Project = func(string) (string, string) { return "users-service", "/projects/users-service" }
	}
	manager := NewManager(hooks, events.emit)
	manager.detect = detectConfig{interval: 5 * time.Millisecond, timeout: 200 * time.Millisecond}
	return manager, events
}

// The central scenario: a request in flight when Delve stops is marked paused
// at the breakpoint, and goes back in flight on continue.
func TestBreakpointHitTiesToRequestInFlight(t *testing.T) {
	stack := []Frame{
		{Function: "runtime.gopark"},
		{Function: "handler.UpdateUser", RelativePath: "internal/handler/user_handler.go", File: "/p/internal/handler/user_handler.go", Line: 84},
		{Function: "handler.Router.ServeHTTP", RelativePath: "internal/handler/router.go", Line: 30},
	}
	stepped := ""
	manager, events := testManager(Hooks{
		Stack: func(debugID string, threadID int) ([]Frame, error) { return stack, nil },
		Step:  func(debugID, action string, threadID int) error { stepped = debugID + "/" + action; return nil },
	})
	manager.DebugState("go-1", "dbg-1", "running", "users-service", "", 0, "")
	if err := manager.SetPort("debug:dbg-1", 8080); err != nil {
		t.Fatal(err)
	}
	run, err := manager.Begin(BeginRequest{Method: "put", URL: "http://localhost:8080/users/123", TabID: "tab-1"})
	if err != nil || run.ID == "" || run.SessionID != "debug:dbg-1" {
		t.Fatalf("request not tied to the session: %+v %v", run, err)
	}
	manager.DebugState("go-1", "dbg-1", "stopped", "", "breakpoint", 7, "")
	waitFor(t, "breakpoint hit", func() bool { return events.has("breakpoint.hit") })

	paused, _ := manager.Run(run.ID)
	if paused.State != RunPaused || len(paused.Hits) != 1 || paused.Hits[0].Line != 84 || paused.Hits[0].Confidence != "likely" {
		t.Fatalf("unexpected run after pause: %+v", paused)
	}
	session := manager.Snapshot().Sessions[0]
	if session.State != StatePaused || session.Pause.Function != "handler.UpdateUser" || session.Pause.ThreadID != 7 {
		t.Fatalf("unexpected session after pause: %+v", session)
	}
	if err := manager.Step(session.ID, "next"); err != nil || stepped != "dbg-1/next" {
		t.Fatalf("step not forwarded: %q %v", stepped, err)
	}
	manager.DebugState("go-1", "dbg-1", "running", "", "", 0, "")
	resumed, _ := manager.Run(run.ID)
	if resumed.State != RunSent || !events.has("debug.resumed") {
		t.Fatalf("request not back in flight: %+v", resumed)
	}
	done, _ := manager.End(run.ID, 200, 142, "")
	if done.State != RunCompleted || done.Status != 200 {
		t.Fatalf("unexpected completed run: %+v", done)
	}
	manager.DebugState("go-1", "dbg-1", "terminated", "", "", 0, "")
	if got := manager.Snapshot().Sessions[0]; got.State != StateStopped || got.EndedAt == nil || !events.has("debug.stopped") {
		t.Fatalf("session not stopped: %+v", got)
	}
}

func TestTwoRequestsInFlightAreOnlyProbable(t *testing.T) {
	manager, events := testManager(Hooks{Stack: func(string, int) ([]Frame, error) {
		return []Frame{{Function: "main.h", RelativePath: "main.go", Line: 3}}, nil
	}})
	manager.DebugState("go-1", "d", "running", "", "", 0, "")
	_ = manager.SetPort("debug:d", 9000)
	first, _ := manager.Begin(BeginRequest{Method: "GET", URL: "http://127.0.0.1:9000/a"})
	second, _ := manager.Begin(BeginRequest{Method: "GET", URL: "http://127.0.0.1:9000/b"})
	manager.DebugState("go-1", "d", "stopped", "", "breakpoint", 1, "")
	waitFor(t, "hit", func() bool { return events.has("breakpoint.hit") })
	a, _ := manager.Run(first.ID)
	b, _ := manager.Run(second.ID)
	if len(a.Hits) != 0 || len(b.Hits) != 1 || b.Hits[0].Confidence != "probable" {
		t.Fatalf("expected the newest request to get a probable hit: %+v %+v", a, b)
	}
}

func TestLogsCorrelateByIDThenByTime(t *testing.T) {
	manager, _ := testManager(Hooks{})
	manager.RunStarted("go-1", "r1", "run", "go run .", 42)
	_ = manager.SetPort("run:r1", 8080)
	run, _ := manager.Begin(BeginRequest{Method: "GET", URL: "http://localhost:8080/users"})
	other, _ := manager.Begin(BeginRequest{Method: "GET", URL: "http://localhost:8080/other"})

	manager.Output("run", "r1", "stdout", `{"level":"INFO","msg":"updating user","request_id":"`+run.CorrelationID+`"}`+"\n")
	manager.Output("run", "r1", "stderr", "2026/09/30 WARN slow query SELECT id, name FROM users WHERE id = $1\npartial")
	logs := manager.Logs("run:r1", "", 0)
	if len(logs) != 2 {
		t.Fatalf("expected 2 complete lines, got %+v", logs)
	}
	if logs[0].RequestRunID != run.ID || logs[0].Match != MatchID || logs[0].Level != "info" {
		t.Fatalf("first line should match by id: %+v", logs[0])
	}
	if logs[1].RequestRunID != other.ID || logs[1].Match != MatchTime || logs[1].Level != "warn" {
		t.Fatalf("second line should match the newest request by time: %+v", logs[1])
	}
	queries := manager.Queries(other.ID)
	if len(queries) != 1 || queries[0].SQL != "SELECT id, name FROM users WHERE id = $1" {
		t.Fatalf("SQL not detected: %+v", queries)
	}
	manager.RunFinished("r1", "")
	if last := manager.Logs("run:r1", "", 0); last[len(last)-1].Text != "partial" {
		t.Fatalf("unterminated line not flushed at the end: %+v", last)
	}
}

func TestMessagesMatchCorrelationHeader(t *testing.T) {
	manager, _ := testManager(Hooks{})
	manager.RunStarted("go-1", "r1", "run", "go run .", 42)
	_ = manager.SetPort("run:r1", 8080)
	run, _ := manager.Begin(BeginRequest{Method: "PUT", URL: "http://localhost:8080/users/1"})
	manager.RecordMessage(Message{SessionID: "run:r1", Broker: "kafka", Topic: "user.updated", Partition: 2, Offset: 82912, Headers: map[string]string{CorrelationHeader: run.CorrelationID}})
	messages := manager.Messages(run.ID)
	if len(messages) != 1 || messages[0].Match != MatchID {
		t.Fatalf("message not tied to the request: %+v", messages)
	}
	if got, _ := manager.Run(run.ID); got.Messages != 1 {
		t.Fatalf("run counter not updated: %+v", got)
	}
}

func TestRequestsToOtherHostsAreNotTracked(t *testing.T) {
	manager, _ := testManager(Hooks{})
	manager.RunStarted("go-1", "r1", "run", "go run .", 42)
	_ = manager.SetPort("run:r1", 8080)
	for _, url := range []string{"https://api.example.com/users", "http://localhost:9999/x", "http://10.0.0.5:8080/"} {
		if run, err := manager.Begin(BeginRequest{Method: "GET", URL: url}); err != nil || run.ID != "" {
			t.Fatalf("%s should not be tracked: %+v %v", url, run, err)
		}
	}
}

func TestPortDetection(t *testing.T) {
	calls := 0
	manager, _ := testManager(Hooks{ListPorts: func() ([]Port, error) {
		calls++
		ports := []Port{{Port: 5432, PID: 10, Process: "postgres.exe"}}
		if calls > 1 {
			ports = append(ports, Port{Port: 51000, PID: 20, Process: "dlv.exe"}, Port{Port: 8081, PID: 21, Process: "__debug_bin123.exe"})
		}
		return ports, nil
	}})
	manager.DebugState("go-1", "d", "running", "", "", 0, "")
	waitFor(t, "port", func() bool { return manager.Snapshot().Sessions[0].Port == 8081 })
	if source := manager.Snapshot().Sessions[0].PortSource; source != "listening" {
		t.Fatalf("unexpected source %q", source)
	}

	fromEnv, _ := testManager(Hooks{RunPort: func(string) int { return 7070 }})
	fromEnv.RunStarted("go-1", "r", "run", "go run .", 1)
	waitFor(t, "env port", func() bool { return fromEnv.Snapshot().Sessions[0].Port == 7070 })

	fromOutput, _ := testManager(Hooks{})
	fromOutput.RunStarted("go-1", "r", "run", "go run .", 1)
	fromOutput.Output("run", "r", "stdout", "[GIN-debug] Listening and serving HTTP on :8090\n")
	if got := fromOutput.Snapshot().Sessions[0]; got.Port != 8090 || got.PortSource != "output" {
		t.Fatalf("port not read from output: %+v", got)
	}
}

func TestPortFromOutput(t *testing.T) {
	cases := map[string]int{
		"listening on :8080":                                8080,
		"server started at http://localhost:3000/api":       3000,
		"⇨ http server started on [::]:1323":                1323,
		`{"msg":"listening","addr":"0.0.0.0:9090"}`:         9090,
		"loaded 42 users":                                   0,
		"2026/09/30 11:45:02 listening on 127.0.0.1:52345":  52345,
		"2026/09/30 11:45:02 server started":                0,
		"starting server port=7070":                         7070,
		"time=11:45:02 level=INFO msg=ready addr=[::]:8443": 8443,
		"retrying in 5 seconds":                             0,
	}
	for line, want := range cases {
		if got := portFromOutput(line); got != want {
			t.Errorf("portFromOutput(%q) = %d, want %d", line, got, want)
		}
	}
}

func TestWaitReady(t *testing.T) {
	listener, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		t.Fatal(err)
	}
	defer listener.Close()
	port := listener.Addr().(*net.TCPAddr).Port
	manager, _ := testManager(Hooks{})
	manager.RunStarted("go-1", "r", "run", "go run .", 1)
	_ = manager.SetPort("run:r", port)
	ctx, cancel := context.WithTimeout(context.Background(), 2*time.Second)
	defer cancel()
	if err := manager.WaitReady(ctx, "run:r"); err != nil {
		t.Fatal(err)
	}
	manager.RunStarted("go-1", "none", "run", "go run .", 1)
	short, cancelShort := context.WithTimeout(context.Background(), 400*time.Millisecond)
	defer cancelShort()
	if err := manager.WaitReady(short, "run:none"); err == nil {
		t.Fatal("expected an error without a port")
	}
}

func TestNonServiceRunsAreIgnored(t *testing.T) {
	manager, _ := testManager(Hooks{})
	manager.RunStarted("go-1", "t", "test", "go test ./...", 1)
	manager.RunStarted("go-1", "b", "build", "go build", 1)
	if n := len(manager.Snapshot().Sessions); n != 0 {
		t.Fatalf("tests and builds are not services, got %d sessions", n)
	}
}

func TestDebugOutputKeepsProgramLinesOnly(t *testing.T) {
	manager, _ := testManager(Hooks{})
	manager.DebugState("go-1", "d", "running", "", "", 0, "")
	manager.DebugOutput("d", "stdout", "Building /tmp/p\n")
	manager.DebugOutput("d", "console", "Type 'dlv help' for list of commands.\n2026/09/30 listening on 127.0.0.1:45661\n")
	manager.DebugOutput("d", "telemetry", "ignored\n")
	logs := manager.Logs("debug:d", "", 0)
	if len(logs) != 1 || logs[0].Text != "2026/09/30 listening on 127.0.0.1:45661" {
		t.Fatalf("unexpected lines: %+v", logs)
	}
	if got := manager.Snapshot().Sessions[0].Port; got != 45661 {
		t.Fatalf("port from console output = %d", got)
	}
}

func TestWaitReadyWithHealthPath(t *testing.T) {
	ready := false
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != "/healthz" || !ready {
			w.WriteHeader(http.StatusServiceUnavailable)
			ready = true // the second probe succeeds
			return
		}
		w.WriteHeader(http.StatusOK)
	}))
	defer server.Close()
	manager, _ := testManager(Hooks{})
	manager.RunStarted("go-1", "r", "run", "go run .", 1)
	_ = manager.SetPort("run:r", server.Listener.Addr().(*net.TCPAddr).Port)
	ctx, cancel := context.WithTimeout(context.Background(), 3*time.Second)
	defer cancel()
	if err := manager.WaitReadyAt(ctx, "run:r", "healthz"); err != nil {
		t.Fatal(err)
	}
	if !ready {
		t.Fatal("the health path was never probed")
	}
}
