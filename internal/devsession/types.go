// Package devsession owns the Live Development Sessions: a Go service started
// from gO (run or debug) seen by every adOmnia tool as one shared object. It
// tracks the runtime (PID, port, debugger state), the API requests sent to the
// service, and what those requests caused (breakpoint hits, log lines, SQL
// queries, Kafka messages), so each tool can show and navigate the same flow.
package devsession

import "time"

// Session states. "paused" means the debugger is stopped at a breakpoint.
const (
	StateStarting = "starting"
	StateRunning  = "running"
	StatePaused   = "paused"
	StateStopped  = "stopped"
	StateError    = "error"
)

// Request run states.
const (
	RunSent      = "sent"
	RunPaused    = "paused"
	RunCompleted = "completed"
	RunError     = "error"
)

// Match says how a log line, query or message was tied to a request:
// "id" when it carried the request's correlation id, "time" when it only
// happened while the request was in flight (a guess, shown as such).
const (
	MatchID   = "id"
	MatchTime = "time"
)

// Frame is one stack frame of the paused goroutine.
type Frame struct {
	Function     string `json:"function"`
	File         string `json:"file,omitempty"`
	RelativePath string `json:"relativePath,omitempty"`
	Line         int    `json:"line"`
}

// Pause is where the debugger stopped.
type Pause struct {
	Frame
	ThreadID int       `json:"threadId"`
	Reason   string    `json:"reason,omitempty"`
	Stack    []Frame   `json:"stack,omitempty"`
	At       time.Time `json:"at"`
}

// Session is one running Go service owned by a gO project.
type Session struct {
	ID          string `json:"id"`
	GoSessionID string `json:"goSessionId"`
	Service     string `json:"service"`
	ProjectRoot string `json:"projectRoot"`
	// Kind is "run" (go run / binary) or "debug" (Delve).
	Kind string `json:"kind"`
	// ResourceID is the gO run id or debug id.
	ResourceID string `json:"resourceId"`
	Title      string `json:"title"`
	PID        int    `json:"pid,omitempty"`
	Port       int    `json:"port,omitempty"`
	// PortSource is "env", "output", "listening" or "manual".
	PortSource string     `json:"portSource,omitempty"`
	State      string     `json:"state"`
	Pause      *Pause     `json:"pause,omitempty"`
	Error      string     `json:"error,omitempty"`
	StartedAt  time.Time  `json:"startedAt"`
	EndedAt    *time.Time `json:"endedAt,omitempty"`
}

// Hit is a breakpoint reached while a request was in flight.
type Hit struct {
	Frame
	Stack []Frame   `json:"stack,omitempty"`
	At    time.Time `json:"at"`
	// Confidence is "likely" with one request in flight, "probable" with more.
	Confidence string `json:"confidence"`
}

// RequestRun is one API request sent to a live session.
type RequestRun struct {
	ID            string     `json:"id"`
	SessionID     string     `json:"sessionId"`
	TabID         string     `json:"tabId,omitempty"`
	Name          string     `json:"name,omitempty"`
	Method        string     `json:"method"`
	URL           string     `json:"url"`
	CorrelationID string     `json:"correlationId"`
	State         string     `json:"state"`
	StartedAt     time.Time  `json:"startedAt"`
	CompletedAt   *time.Time `json:"completedAt,omitempty"`
	Status        int        `json:"status,omitempty"`
	DurationMs    int64      `json:"durationMs,omitempty"`
	Error         string     `json:"error,omitempty"`
	Hits          []Hit      `json:"hits"`
	Logs          int        `json:"logs"`
	Queries       int        `json:"queries"`
	Messages      int        `json:"messages"`
}

// BeginRequest describes a request about to be sent. An empty SessionID lets
// the manager match the URL against the live sessions' ports.
type BeginRequest struct {
	SessionID string `json:"sessionId"`
	TabID     string `json:"tabId"`
	Name      string `json:"name"`
	Method    string `json:"method"`
	URL       string `json:"url"`
}

// LogEntry is one output line of a live session.
type LogEntry struct {
	Seq          int64     `json:"seq"`
	SessionID    string    `json:"sessionId"`
	At           time.Time `json:"at"`
	Stream       string    `json:"stream"`
	Text         string    `json:"text"`
	Level        string    `json:"level,omitempty"`
	RequestRunID string    `json:"requestRunId,omitempty"`
	Match        string    `json:"match,omitempty"`
}

// Query is a SQL statement the service ran, seen in its logs or through the
// capture proxy.
type Query struct {
	ID           string    `json:"id"`
	SessionID    string    `json:"sessionId"`
	RequestRunID string    `json:"requestRunId,omitempty"`
	Match        string    `json:"match,omitempty"`
	At           time.Time `json:"at"`
	SQL          string    `json:"sql"`
	// Source is "log" or "proxy".
	Source     string `json:"source"`
	Datasource string `json:"datasource,omitempty"`
	// Statement outcome, known only for statements seen by the SQL proxy.
	// Kind is "statement" or "transaction" (a whole transaction, from its first statement to COMMIT/ROLLBACK).
	Kind       string   `json:"kind,omitempty"`
	DurationMs *float64 `json:"durationMs,omitempty"`
	Rows       *int64   `json:"rows,omitempty"`
	Error      string   `json:"error,omitempty"`
	ErrorCode  string   `json:"errorCode,omitempty"`
	Incomplete bool     `json:"incomplete,omitempty"`
}

// Message is a broker message produced while a request was in flight.
type Message struct {
	ID           string            `json:"id"`
	SessionID    string            `json:"sessionId"`
	RequestRunID string            `json:"requestRunId,omitempty"`
	Match        string            `json:"match,omitempty"`
	At           time.Time         `json:"at"`
	Broker       string            `json:"broker"`
	Topic        string            `json:"topic"`
	Partition    int32             `json:"partition"`
	Offset       int64             `json:"offset"`
	Key          string            `json:"key,omitempty"`
	Headers      map[string]string `json:"headers,omitempty"`
	Preview      string            `json:"preview,omitempty"`
}

// Snapshot is the whole live state, fetched once by the frontend at start.
type Snapshot struct {
	Sessions []Session    `json:"sessions"`
	Runs     []RequestRun `json:"runs"`
}

// Event is published on the "devsession:event" channel.
type Event struct {
	Type      string `json:"type"`
	SessionID string `json:"sessionId,omitempty"`
	Payload   any    `json:"payload,omitempty"`
}

// Port is one listening socket.
type Port struct {
	Port    int
	PID     int
	Process string
}
