package devsession

import (
	"crypto/rand"
	"encoding/hex"
	"fmt"
	"sort"
	"sync"
	"time"
)

const (
	maxEndedSessions = 10
	maxRuns          = 200
	maxLogLines      = 5000
	maxQueries       = 500
	maxMessages      = 500
)

// Hooks are the operations the manager needs from gO and the OS. They are
// plain functions so the package stays testable without a debugger.
type Hooks struct {
	// Stack returns the frames of the paused goroutine, top first.
	Stack func(debugID string, threadID int) ([]Frame, error)
	// Step runs continue / next / stepIn / stepOut / pause on a debug session.
	Step      func(debugID, action string, threadID int) error
	StopDebug func(debugID string) error
	StopRun   func(runID string) error
	// RunPort returns the PORT a gO run configuration injected, or 0.
	RunPort func(runID string) int
	// ListPorts returns the listening sockets of the machine.
	ListPorts func() ([]Port, error)
	// Project returns the service name and folder of a gO session.
	Project func(goSessionID string) (service, root string)
}

// Manager is the single owner of live sessions and request runs.
type Manager struct {
	mu       sync.Mutex
	sessions map[string]*Session
	order    []string
	runs     map[string]*RequestRun
	runOrder []string
	logs     map[string][]LogEntry
	partial  map[string]string
	queries  []Query
	messages []Message
	seq      int64
	hooks    Hooks
	emit     func(Event)
	now      func() time.Time
	// detect tunes port detection; tests shorten it.
	detect detectConfig
	// debugGen counts debugger state changes per session (see DebugState).
	debugGen map[string]int
}

func NewManager(hooks Hooks, emit func(Event)) *Manager {
	if emit == nil {
		emit = func(Event) {}
	}
	return &Manager{
		sessions: make(map[string]*Session), runs: make(map[string]*RequestRun),
		logs: make(map[string][]LogEntry), partial: make(map[string]string),
		hooks: hooks, emit: emit, now: time.Now, detect: defaultDetect, debugGen: make(map[string]int),
	}
}

func sessionKey(kind, resourceID string) string { return kind + ":" + resourceID }

func newID(prefix string) string {
	var b [6]byte
	_, _ = rand.Read(b[:])
	return prefix + hex.EncodeToString(b[:])
}

// publish emits events outside the lock.
func (m *Manager) publish(events []Event) {
	for _, event := range events {
		m.emit(event)
	}
}

// Snapshot returns a copy of every session and the recent request runs.
func (m *Manager) Snapshot() Snapshot {
	m.mu.Lock()
	defer m.mu.Unlock()
	snapshot := Snapshot{Sessions: make([]Session, 0, len(m.order)), Runs: make([]RequestRun, 0, len(m.runOrder))}
	for _, id := range m.order {
		snapshot.Sessions = append(snapshot.Sessions, cloneSession(m.sessions[id]))
	}
	for _, id := range m.runOrder {
		snapshot.Runs = append(snapshot.Runs, cloneRun(m.runs[id]))
	}
	return snapshot
}

func cloneSession(session *Session) Session {
	out := *session
	if session.Pause != nil {
		pause := *session.Pause
		pause.Stack = append([]Frame(nil), session.Pause.Stack...)
		out.Pause = &pause
	}
	return out
}

func cloneRun(run *RequestRun) RequestRun {
	out := *run
	// Never nil: the UI reads hits.length, and a nil slice would reach it as JSON null.
	out.Hits = append([]Hit{}, run.Hits...)
	return out
}

// sessionLocked returns a live (not stopped) session by id.
func (m *Manager) sessionLocked(id string) (*Session, error) {
	session, ok := m.sessions[id]
	if !ok {
		return nil, fmt.Errorf("live session %s not found", id)
	}
	return session, nil
}

func (m *Manager) addSessionLocked(session *Session) {
	m.sessions[session.ID] = session
	m.order = append(m.order, session.ID)
}

// pruneLocked drops the oldest ended sessions beyond the history limit.
func (m *Manager) pruneLocked() {
	ended := 0
	for i := len(m.order) - 1; i >= 0; i-- {
		session := m.sessions[m.order[i]]
		if session.EndedAt == nil {
			continue
		}
		ended++
		if ended > maxEndedSessions {
			delete(m.sessions, session.ID)
			delete(m.logs, session.ID)
			delete(m.partial, session.ID)
			m.order = append(m.order[:i], m.order[i+1:]...)
		}
	}
}

// startSession registers a session for a gO run or debug resource.
func (m *Manager) startSession(goSessionID, kind, resourceID, title string, pid int, state string) {
	service, root := "", ""
	if m.hooks.Project != nil {
		service, root = m.hooks.Project(goSessionID)
	}
	m.mu.Lock()
	if _, exists := m.sessions[sessionKey(kind, resourceID)]; exists {
		m.mu.Unlock()
		return
	}
	session := &Session{
		ID: sessionKey(kind, resourceID), GoSessionID: goSessionID, Service: service, ProjectRoot: root,
		Kind: kind, ResourceID: resourceID, Title: title, PID: pid, State: state, StartedAt: m.now(),
	}
	m.addSessionLocked(session)
	events := []Event{{Type: "service.started", SessionID: session.ID, Payload: cloneSession(session)}}
	if kind == "debug" {
		events = append(events, Event{Type: "debug.started", SessionID: session.ID, Payload: cloneSession(session)})
	}
	m.mu.Unlock()
	m.publish(events)
	go m.detectPort(session.ID)
}

// endSession marks a session stopped and fails its in-flight requests.
func (m *Manager) endSession(id, errText string) {
	m.mu.Lock()
	session, ok := m.sessions[id]
	if !ok || session.EndedAt != nil {
		m.mu.Unlock()
		return
	}
	ended := m.now()
	session.EndedAt = &ended
	session.Pause = nil
	session.State = StateStopped
	if errText != "" {
		session.State, session.Error = StateError, errText
	}
	m.flushPartialLocked(id)
	events := []Event{}
	// Requests still in flight will never get their response from this process.
	for _, run := range m.inFlightLocked(id) {
		run.State, run.Error, run.CompletedAt = RunError, "the service stopped", &ended
		events = append(events, Event{Type: "request.completed", SessionID: id, Payload: cloneRun(run)})
	}
	if session.Kind == "debug" {
		events = append(events, Event{Type: "debug.stopped", SessionID: id, Payload: cloneSession(session)})
	}
	events = append(events, Event{Type: "service.stopped", SessionID: id, Payload: cloneSession(session)})
	m.pruneLocked()
	m.mu.Unlock()
	m.publish(events)
}

// RenameService updates the service name of every session of a gO project.
func (m *Manager) RenameService(goSessionID, service string) {
	m.mu.Lock()
	var events []Event
	for _, id := range m.order {
		session := m.sessions[id]
		if session.GoSessionID == goSessionID {
			session.Service = service
			events = append(events, Event{Type: "service.updated", SessionID: id, Payload: cloneSession(session)})
		}
	}
	m.mu.Unlock()
	m.publish(events)
}

// GoSessionClosed ends every session of a closed gO project and returns their ids.
func (m *Manager) GoSessionClosed(goSessionID string) []string {
	m.mu.Lock()
	var ids []string
	for _, id := range m.order {
		if session := m.sessions[id]; session.GoSessionID == goSessionID && session.EndedAt == nil {
			ids = append(ids, id)
		}
	}
	m.mu.Unlock()
	for _, id := range ids {
		m.endSession(id, "")
	}
	return ids
}

// RunStarted registers a long-running gO execution (go run, compiled binary).
func (m *Manager) RunStarted(goSessionID, runID, kind, command string, pid int) {
	if kind != "run" && kind != "binary" {
		return
	}
	m.startSession(goSessionID, "run", runID, command, pid, StateRunning)
}

// RunFinished ends the session of a gO execution.
func (m *Manager) RunFinished(runID, errText string) {
	m.endSession(sessionKey("run", runID), errText)
}

// DebugState follows the Delve lifecycle: starting, running, stopped (paused), terminated.
func (m *Manager) DebugState(goSessionID, debugID, state, title, reason string, threadID int, errText string) {
	id := sessionKey("debug", debugID)
	// Every state change invalidates a pause still resolving its stack: a
	// resume or a newer stop must never be overwritten by an older pause.
	m.mu.Lock()
	m.debugGen[id]++
	gen := m.debugGen[id]
	m.mu.Unlock()
	switch state {
	case "starting", "running":
		m.mu.Lock()
		_, exists := m.sessions[id]
		m.mu.Unlock()
		if !exists {
			m.startSession(goSessionID, "debug", debugID, title, 0, stateFor(state))
			if state == "starting" {
				return
			}
		}
		m.resume(id)
	case "stopped":
		m.mu.Lock()
		_, exists := m.sessions[id]
		m.mu.Unlock()
		if !exists {
			m.startSession(goSessionID, "debug", debugID, title, 0, StateRunning)
		}
		// The stack comes from a DAP call: never on the event goroutine, which
		// is the one that must read the DAP response.
		go m.pause(id, debugID, threadID, reason, gen)
	case "terminated":
		m.endSession(id, errText)
		m.mu.Lock()
		delete(m.debugGen, id)
		m.mu.Unlock()
	}
}

func stateFor(debugState string) string {
	if debugState == "starting" {
		return StateStarting
	}
	return StateRunning
}

// resume clears the pause and puts paused requests back in flight.
func (m *Manager) resume(id string) {
	m.mu.Lock()
	session, ok := m.sessions[id]
	if !ok || session.EndedAt != nil {
		m.mu.Unlock()
		return
	}
	wasPaused := session.State == StatePaused
	session.State, session.Pause = StateRunning, nil
	var events []Event
	for _, runID := range m.runOrder {
		if run := m.runs[runID]; run.SessionID == id && run.State == RunPaused {
			run.State = RunSent
		}
	}
	if wasPaused {
		events = append(events, Event{Type: "debug.resumed", SessionID: id, Payload: cloneSession(session)})
	} else {
		events = append(events, Event{Type: "service.updated", SessionID: id, Payload: cloneSession(session)})
	}
	m.mu.Unlock()
	m.publish(events)
}

// pause resolves the stopped location and ties it to the requests in flight.
func (m *Manager) pause(id, debugID string, threadID int, reason string, gen int) {
	var stack []Frame
	if m.hooks.Stack != nil {
		frames, err := m.hooks.Stack(debugID, threadID)
		if err == nil {
			stack = frames
		}
	}
	pause := &Pause{ThreadID: threadID, Reason: reason, Stack: stack, At: m.now()}
	if top := topFrame(stack); top != nil {
		pause.Frame = *top
	}
	m.mu.Lock()
	session, ok := m.sessions[id]
	if !ok || session.EndedAt != nil || m.debugGen[id] != gen {
		m.mu.Unlock()
		return
	}
	session.State, session.Pause = StatePaused, pause
	events := []Event{{Type: "debug.paused", SessionID: id, Payload: cloneSession(session)}}
	inFlight := m.inFlightLocked(id)
	if len(inFlight) > 0 {
		confidence := "likely"
		if len(inFlight) > 1 {
			confidence = "probable"
		}
		// With several requests in flight the newest one is the best guess.
		run := inFlight[len(inFlight)-1]
		hit := Hit{Frame: pause.Frame, Stack: stack, At: pause.At, Confidence: confidence}
		run.Hits = append(run.Hits, hit)
		run.State = RunPaused
		events = append(events, Event{Type: "breakpoint.hit", SessionID: id, Payload: map[string]any{"run": cloneRun(run), "hit": hit}})
	}
	m.mu.Unlock()
	m.publish(events)
}

// topFrame is the first frame with a source file: runtime frames without one are skipped.
func topFrame(stack []Frame) *Frame {
	for i := range stack {
		if stack[i].File != "" || stack[i].RelativePath != "" {
			return &stack[i]
		}
	}
	if len(stack) > 0 {
		return &stack[0]
	}
	return nil
}

// inFlightLocked returns the session's requests not yet completed, oldest first.
func (m *Manager) inFlightLocked(sessionID string) []*RequestRun {
	var runs []*RequestRun
	for _, runID := range m.runOrder {
		run := m.runs[runID]
		if run.SessionID == sessionID && (run.State == RunSent || run.State == RunPaused) {
			runs = append(runs, run)
		}
	}
	return runs
}

// Step drives the debugger of a live session from any adOmnia view.
func (m *Manager) Step(id, action string) error {
	m.mu.Lock()
	session, err := m.sessionLocked(id)
	if err != nil {
		m.mu.Unlock()
		return err
	}
	if session.Kind != "debug" || session.EndedAt != nil {
		m.mu.Unlock()
		return fmt.Errorf("%s is not being debugged", session.Service)
	}
	debugID, threadID := session.ResourceID, 0
	if session.Pause != nil {
		threadID = session.Pause.ThreadID
	}
	m.mu.Unlock()
	switch action {
	case "continue", "next", "stepIn", "stepOut", "pause":
	default:
		return fmt.Errorf("unknown debugger action %q", action)
	}
	if m.hooks.Step == nil {
		return fmt.Errorf("debugger unavailable")
	}
	return m.hooks.Step(debugID, action, threadID)
}

// Stop ends a live session: the debugger or the process.
func (m *Manager) Stop(id string) error {
	m.mu.Lock()
	session, err := m.sessionLocked(id)
	if err != nil {
		m.mu.Unlock()
		return err
	}
	kind, resourceID := session.Kind, session.ResourceID
	m.mu.Unlock()
	if kind == "debug" {
		if m.hooks.StopDebug == nil {
			return fmt.Errorf("debugger unavailable")
		}
		return m.hooks.StopDebug(resourceID)
	}
	if m.hooks.StopRun == nil {
		return fmt.Errorf("process control unavailable")
	}
	return m.hooks.StopRun(resourceID)
}

// SetPort fixes the port of a session by hand when detection guessed wrong.
func (m *Manager) SetPort(id string, port int) error {
	if port <= 0 || port > 65535 {
		return fmt.Errorf("invalid port %d", port)
	}
	m.mu.Lock()
	session, err := m.sessionLocked(id)
	if err != nil {
		m.mu.Unlock()
		return err
	}
	session.Port, session.PortSource = port, "manual"
	event := Event{Type: "service.updated", SessionID: id, Payload: cloneSession(session)}
	m.mu.Unlock()
	m.publish([]Event{event})
	return nil
}

// sortedLive returns copies: callers read them without the lock.
func (m *Manager) sortedLive() []Session {
	m.mu.Lock()
	defer m.mu.Unlock()
	var live []Session
	for _, id := range m.order {
		if session := m.sessions[id]; session.EndedAt == nil {
			live = append(live, cloneSession(session))
		}
	}
	sort.SliceStable(live, func(i, j int) bool { return live[i].StartedAt.After(live[j].StartedAt) })
	return live
}
