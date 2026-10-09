package devsession

import (
	"encoding/json"
	"regexp"
	"sort"
	"strings"
)

const maxLogLineBytes = 8 << 10

// Output ingests stdout/stderr of a run or a debugged program. Lines are split
// here so a chunk boundary never cuts a correlation id in half.
func (m *Manager) Output(kind, resourceID, stream, text string) {
	if text == "" {
		return
	}
	id := sessionKey(kind, resourceID)
	m.mu.Lock()
	session, ok := m.sessions[id]
	if !ok || session.EndedAt != nil {
		m.mu.Unlock()
		return
	}
	buffer := m.partial[id] + text
	lines := strings.Split(buffer, "\n")
	m.partial[id] = lines[len(lines)-1]
	if len(m.partial[id]) > maxLogLineBytes {
		lines[len(lines)-1], m.partial[id] = m.partial[id], ""
	} else {
		lines = lines[:len(lines)-1]
	}
	events, port := m.appendLinesLocked(session, stream, lines)
	m.mu.Unlock()
	m.publish(events)
	if port > 0 {
		m.setDetectedPort(id, port, "output")
	}
}

// flushPartialLocked emits the last unterminated line of an ending session.
func (m *Manager) flushPartialLocked(id string) {
	rest := m.partial[id]
	delete(m.partial, id)
	if strings.TrimSpace(rest) == "" {
		return
	}
	if session, ok := m.sessions[id]; ok {
		events, _ := m.appendLinesLocked(session, "stdout", []string{rest})
		go m.publish(events)
	}
}

func (m *Manager) appendLinesLocked(session *Session, stream string, lines []string) ([]Event, int) {
	var entries []LogEntry
	var queries []Query
	var runs []RequestRun
	port := 0
	now := m.now()
	for _, raw := range lines {
		line := strings.TrimRight(raw, "\r")
		if strings.TrimSpace(line) == "" {
			continue
		}
		if len(line) > maxLogLineBytes {
			line = line[:maxLogLineBytes]
		}
		m.seq++
		entry := LogEntry{Seq: m.seq, SessionID: session.ID, At: now, Stream: stream, Text: line, Level: logLevel(line)}
		run, match := m.attributeLocked(session.ID, line, now)
		if run != nil {
			entry.RequestRunID, entry.Match = run.ID, match
			run.Logs++
		}
		if session.Port == 0 && port == 0 {
			port = portFromOutput(line)
		}
		if sql := sqlFromLog(line); sql != "" {
			query := Query{ID: newID("q-"), SessionID: session.ID, At: now, SQL: sql, Source: "log"}
			if run != nil {
				query.RequestRunID, query.Match = run.ID, match
				run.Queries++
			}
			m.queries = appendCapped(m.queries, query, maxQueries)
			queries = append(queries, query)
		}
		if run != nil {
			runs = append(runs, cloneRun(run))
		}
		entries = append(entries, entry)
	}
	if len(entries) == 0 {
		return nil, port
	}
	log := append(m.logs[session.ID], entries...)
	if len(log) > maxLogLines {
		log = append([]LogEntry(nil), log[len(log)-maxLogLines:]...)
	}
	m.logs[session.ID] = log
	events := []Event{{Type: "log.received", SessionID: session.ID, Payload: entries}}
	for _, query := range queries {
		events = append(events, Event{Type: "database.query", SessionID: session.ID, Payload: query})
	}
	if len(runs) > 0 {
		events = append(events, Event{Type: "request.updated", SessionID: session.ID, Payload: runs[len(runs)-1]})
	}
	return events, port
}

func appendCapped[T any](list []T, item T, limit int) []T {
	list = append(list, item)
	if len(list) > limit {
		list = append([]T(nil), list[len(list)-limit:]...)
	}
	return list
}

var levelToken = regexp.MustCompile(`(?i)\b(panic|fatal|error|err|warn(?:ing)?|info|debug|trace)\b`)

// logLevel reads the level of a structured (JSON) or plain log line.
func logLevel(line string) string {
	trimmed := strings.TrimSpace(line)
	if strings.HasPrefix(trimmed, "{") {
		var fields map[string]any
		if json.Unmarshal([]byte(trimmed), &fields) == nil {
			for _, key := range []string{"level", "lvl", "severity"} {
				if value, ok := fields[key].(string); ok {
					return normalizeLevel(value)
				}
			}
		}
	}
	if strings.HasPrefix(trimmed, "panic:") || strings.HasPrefix(trimmed, "goroutine ") {
		return "error"
	}
	if match := levelToken.FindStringSubmatch(line); match != nil {
		return normalizeLevel(match[1])
	}
	return ""
}

func normalizeLevel(level string) string {
	switch strings.ToLower(level) {
	case "panic", "fatal", "error", "err", "dpanic":
		return "error"
	case "warn", "warning":
		return "warn"
	case "info", "notice":
		return "info"
	case "debug", "trace":
		return "debug"
	}
	return strings.ToLower(level)
}

var sqlStatement = regexp.MustCompile(`(?is)\b(SELECT\s+.+?\s+FROM\s+\S+.*|INSERT\s+INTO\s+\S+.*|UPDATE\s+\S+\s+SET\s+.*|DELETE\s+FROM\s+\S+.*)`)

// sqlFromLog finds a SQL statement printed by the service (GORM, sqlx, pgx and
// most query loggers print the statement text).
func sqlFromLog(line string) string {
	text := line
	if strings.HasPrefix(strings.TrimSpace(line), "{") {
		var fields map[string]any
		if json.Unmarshal([]byte(strings.TrimSpace(line)), &fields) == nil {
			for _, key := range []string{"sql", "query", "statement", "stmt"} {
				if value, ok := fields[key].(string); ok && value != "" {
					text = value
					break
				}
			}
		}
	}
	match := sqlStatement.FindString(text)
	if match == "" {
		return ""
	}
	match = strings.TrimSpace(strings.TrimRight(match, `"'}`))
	if len(match) > 2000 {
		match = match[:2000]
	}
	return match
}

// Logs returns the log lines of a session, optionally only those of a request.
func (m *Manager) Logs(sessionID, runID string, limit int) []LogEntry {
	m.mu.Lock()
	defer m.mu.Unlock()
	var out []LogEntry
	if runID == "" {
		out = append(out, m.logs[sessionID]...)
	} else {
		// A request's lines can come from other services (matched by its id).
		for _, source := range m.logs {
			for _, entry := range source {
				if entry.RequestRunID == runID {
					out = append(out, entry)
				}
			}
		}
		sort.Slice(out, func(i, j int) bool { return out[i].Seq < out[j].Seq })
	}
	if limit > 0 && len(out) > limit {
		out = out[len(out)-limit:]
	}
	return out
}

// Queries returns the SQL statements of a request run (or all, with "").
func (m *Manager) Queries(runID string) []Query {
	m.mu.Lock()
	defer m.mu.Unlock()
	var out []Query
	for _, query := range m.queries {
		if runID == "" || query.RequestRunID == runID {
			out = append(out, query)
		}
	}
	return out
}

// Messages returns the broker messages of a request run (or all, with "").
func (m *Manager) Messages(runID string) []Message {
	m.mu.Lock()
	defer m.mu.Unlock()
	var out []Message
	for _, message := range m.messages {
		if runID == "" || message.RequestRunID == runID {
			out = append(out, message)
		}
	}
	return out
}

// RecordStatement adds a statement seen by the SQL capture proxy, with its outcome. It is
// attributed to the request that was running when the statement was sent.
func (m *Manager) RecordStatement(sessionID, datasource string, statement Statement) {
	m.mu.Lock()
	at := statement.Started
	if at.IsZero() {
		at = m.now()
	}
	query := Query{ID: newID("q-"), SessionID: sessionID, At: at, SQL: statement.SQL, Source: "proxy", Datasource: datasource, Kind: statement.Kind, Error: statement.Error, ErrorCode: statement.Code, Incomplete: !statement.Completed}
	if statement.Completed {
		duration := float64(statement.Duration.Microseconds()) / 1000
		query.DurationMs = &duration
		if statement.Rows >= 0 {
			rows := statement.Rows
			query.Rows = &rows
		}
	}
	events := []Event{}
	if run, match := m.attributeLocked(sessionID, statement.SQL, at); run != nil {
		query.RequestRunID, query.Match = run.ID, match
		run.Queries++
		events = append(events, Event{Type: "request.updated", SessionID: sessionID, Payload: cloneRun(run)})
	}
	m.queries = appendCapped(m.queries, query, maxQueries)
	events = append([]Event{{Type: "database.query", SessionID: sessionID, Payload: query}}, events...)
	m.mu.Unlock()
	m.publish(events)
}

// RecordMessage adds a broker message observed while watching a session's topics.
func (m *Manager) RecordMessage(message Message) {
	m.mu.Lock()
	now := m.now()
	if message.At.IsZero() {
		message.At = now
	}
	message.ID = newID("msg-")
	events := []Event{}
	correlation := message.Headers[CorrelationHeader]
	if correlation == "" {
		correlation = message.Headers[strings.ToLower(CorrelationHeader)]
	}
	if correlation == "" {
		// OpenTelemetry instrumentation propagates the request's traceparent into the message.
		correlation = message.Headers["traceparent"]
	}
	if run, match := m.attributeLocked(message.SessionID, correlation, message.At); run != nil {
		message.RequestRunID, message.Match = run.ID, match
		run.Messages++
		events = append(events, Event{Type: "request.updated", SessionID: message.SessionID, Payload: cloneRun(run)})
	}
	m.messages = appendCapped(m.messages, message, maxMessages)
	events = append([]Event{{Type: "kafka.produced", SessionID: message.SessionID, Payload: message}}, events...)
	m.mu.Unlock()
	m.publish(events)
}

// delveNoise are Delve's own console messages, not the service's output.
var delveNoise = regexp.MustCompile(`^(?:Type 'dlv help'|Building |Detaching|Process \d+ has exited|dlv dap|DAP server listening|API server listening)`)

// DebugOutput ingests the output of a debugged program. Delve forwards the
// program's stdout/stderr as "console" on some platforms, mixed with its own
// messages, which are dropped.
func (m *Manager) DebugOutput(debugID, category, text string) {
	if category != "stdout" && category != "stderr" && category != "console" {
		return
	}
	stream := category
	if stream == "console" {
		stream = "stdout"
	}
	var kept []string
	for _, line := range strings.SplitAfter(text, "\n") {
		if !delveNoise.MatchString(strings.TrimSpace(line)) {
			kept = append(kept, line)
		}
	}
	m.Output("debug", debugID, stream, strings.Join(kept, ""))
}
