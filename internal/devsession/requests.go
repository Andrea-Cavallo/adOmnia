package devsession

import (
	"fmt"
	"net"
	"net/url"
	"strconv"
	"strings"
	"time"
)

// CorrelationHeader carries the request id to the service so its logs and
// messages can be tied back to the request.
const CorrelationHeader = "X-AdOmnia-Request-ID"

// Begin records a request about to be sent to a live session. When the
// request targets no live session the returned run has an empty ID and
// nothing is tracked.
func (m *Manager) Begin(request BeginRequest) (RequestRun, error) {
	if strings.TrimSpace(request.URL) == "" {
		return RequestRun{}, fmt.Errorf("request URL is empty")
	}
	sessionID := request.SessionID
	if sessionID == "" {
		sessionID = m.MatchURL(request.URL)
	}
	if sessionID == "" {
		return RequestRun{}, nil
	}
	m.mu.Lock()
	session, err := m.sessionLocked(sessionID)
	if err != nil || session.EndedAt != nil {
		m.mu.Unlock()
		return RequestRun{}, nil
	}
	run := &RequestRun{
		ID: newID("run-"), SessionID: sessionID, TabID: request.TabID, Name: request.Name,
		Method: strings.ToUpper(request.Method), URL: request.URL, CorrelationID: newID("adm-"),
		State: RunSent, StartedAt: m.now(), Hits: []Hit{},
	}
	m.runs[run.ID] = run
	m.runOrder = append(m.runOrder, run.ID)
	for len(m.runOrder) > maxRuns {
		delete(m.runs, m.runOrder[0])
		m.runOrder = m.runOrder[1:]
	}
	out := cloneRun(run)
	m.mu.Unlock()
	m.publish([]Event{{Type: "request.started", SessionID: sessionID, Payload: out}})
	return out, nil
}

// End completes a request run with its HTTP outcome.
func (m *Manager) End(runID string, status int, durationMs int64, errText string) (RequestRun, error) {
	m.mu.Lock()
	run, ok := m.runs[runID]
	if !ok {
		m.mu.Unlock()
		return RequestRun{}, fmt.Errorf("request run %s not found", runID)
	}
	completed := m.now()
	run.CompletedAt, run.Status, run.DurationMs, run.Error = &completed, status, durationMs, errText
	run.State = RunCompleted
	if errText != "" {
		run.State = RunError
	}
	out := cloneRun(run)
	m.mu.Unlock()
	m.publish([]Event{{Type: "request.completed", SessionID: out.SessionID, Payload: out}})
	return out, nil
}

// Run returns one request run.
func (m *Manager) Run(runID string) (RequestRun, error) {
	m.mu.Lock()
	defer m.mu.Unlock()
	run, ok := m.runs[runID]
	if !ok {
		return RequestRun{}, fmt.Errorf("request run %s not found", runID)
	}
	return cloneRun(run), nil
}

// MatchURL returns the newest live session whose port serves a local URL.
func (m *Manager) MatchURL(raw string) string {
	port := localPort(raw)
	if port == 0 {
		return ""
	}
	for _, session := range m.sortedLive() {
		if session.Port == port {
			return session.ID
		}
	}
	return ""
}

// localPort returns the port of a loopback http(s) URL, or 0.
func localPort(raw string) int {
	parsed, err := url.Parse(strings.TrimSpace(raw))
	if err != nil || (parsed.Scheme != "http" && parsed.Scheme != "https" && parsed.Scheme != "ws" && parsed.Scheme != "wss") {
		return 0
	}
	host := parsed.Hostname()
	if host != "localhost" && host != "0.0.0.0" {
		ip := net.ParseIP(host)
		if ip == nil || !ip.IsLoopback() {
			return 0
		}
	}
	if parsed.Port() == "" {
		if parsed.Scheme == "https" || parsed.Scheme == "wss" {
			return 443
		}
		return 80
	}
	port, _ := strconv.Atoi(parsed.Port())
	return port
}

// attributeLocked ties something the service did (a log line, a query, a
// message) to a request: by correlation id when the text carries it,
// otherwise to the newest request in flight at that moment.
func (m *Manager) attributeLocked(sessionID, text string, at time.Time) (*RequestRun, string) {
	if text != "" {
		for i := len(m.runOrder) - 1; i >= 0; i-- {
			run := m.runs[m.runOrder[i]]
			if run.SessionID == sessionID && strings.Contains(text, run.CorrelationID) {
				return run, MatchID
			}
		}
	}
	inFlight := m.inFlightLocked(sessionID)
	for i := len(inFlight) - 1; i >= 0; i-- {
		if !inFlight[i].StartedAt.After(at) {
			return inFlight[i], MatchTime
		}
	}
	// A service often logs or publishes right after writing the response.
	for i := len(m.runOrder) - 1; i >= 0; i-- {
		run := m.runs[m.runOrder[i]]
		if run.SessionID == sessionID && run.CompletedAt != nil && !at.Before(*run.CompletedAt) && at.Sub(*run.CompletedAt) <= afterResponseGrace {
			return run, MatchTime
		}
	}
	return nil, ""
}

// afterResponseGrace is how long after the response a line still counts as the request's.
const afterResponseGrace = time.Second
