package goide

import (
	"bufio"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net"
	"os/exec"
	"path/filepath"
	"sort"
	"strings"
	"sync"
	"time"

	"adomnia/internal/goide/dap"
)

const (
	debugAddressTimeout = 20 * time.Second
	debugRequestTimeout = 15 * time.Second
	// debugDisconnectTimeout è il tempo concesso a Delve per fermare e chiudere il programma debuggato.
	debugDisconnectTimeout = 5 * time.Second
	// debugLaunchTimeout copre la compilazione del programma fatta da Delve durante launch.
	debugLaunchTimeout = 3 * time.Minute
	maxDebugVariables  = 500
	maxDebugFrames     = 200
	listeningPrefix    = "DAP server listening at: "
)

// Stati di una sessione di debug.
const (
	DebugStarting   = "starting"
	DebugRunning    = "running"
	DebugStopped    = "stopped"
	DebugTerminated = "terminated"
)

// DebugRequest avvia il debug di un package main o di un singolo test, sempre su azione esplicita.
type DebugRequest struct {
	SessionID SessionID `json:"sessionId"`
	// Mode è "debug" (programma) o "test".
	Mode string `json:"mode"`
	// WorkingDirectory è la cartella del modulo relativa al progetto.
	WorkingDirectory string `json:"workingDirectory"`
	// Target è il package relativo al modulo, es. "." o "./cmd/api".
	Target           string            `json:"target"`
	TestName         string            `json:"testName,omitempty"`
	ProgramArguments []string          `json:"programArguments,omitempty"`
	BuildTags        []string          `json:"buildTags,omitempty"`
	Environment      map[string]string `json:"environment,omitempty"`
}

// DebugSessionInfo è lo stato pubblicato con l'evento debug.state.
type DebugSessionInfo struct {
	ID         DebugSessionID `json:"id"`
	SessionID  SessionID      `json:"sessionId"`
	State      string         `json:"state"`
	Title      string         `json:"title"`
	StopReason string         `json:"stopReason,omitempty"`
	ThreadID   int            `json:"threadId,omitempty"`
	Error      string         `json:"error,omitempty"`
	StartedAt  time.Time      `json:"startedAt"`
}

// DebugOutput è una riga della console di debug (stdout/stderr del programma o messaggi di Delve).
type DebugOutput struct {
	DebugID  DebugSessionID `json:"debugId"`
	Category string         `json:"category"`
	Text     string         `json:"text"`
}

// BreakpointState è un breakpoint di riga con la verifica di Delve (la riga può essere spostata).
type BreakpointState struct {
	Line     int    `json:"line"`
	Verified bool   `json:"verified"`
	Message  string `json:"message,omitempty"`
}

// FileBreakpoints è il payload di debug.breakpoints.
type FileBreakpoints struct {
	SessionID    SessionID         `json:"sessionId"`
	RelativePath string            `json:"relativePath"`
	Breakpoints  []BreakpointState `json:"breakpoints"`
}

type DebugThread struct {
	ID   int    `json:"id"`
	Name string `json:"name"`
}

type DebugFrame struct {
	ID           int    `json:"id"`
	Name         string `json:"name"`
	Path         string `json:"path,omitempty"`
	RelativePath string `json:"relativePath,omitempty"`
	Line         int    `json:"line"`
	Column       int    `json:"column"`
}

type DebugScope struct {
	Name               string `json:"name"`
	VariablesReference int    `json:"variablesReference"`
	Expensive          bool   `json:"expensive"`
}

type DebugVariable struct {
	Name               string `json:"name"`
	Value              string `json:"value"`
	Type               string `json:"type,omitempty"`
	VariablesReference int    `json:"variablesReference"`
}

type EvaluateResult struct {
	Result             string `json:"result"`
	Type               string `json:"type,omitempty"`
	VariablesReference int    `json:"variablesReference"`
}

type debugger struct {
	mu      sync.Mutex
	exited  chan struct{}
	info    DebugSessionInfo
	root    string
	command *exec.Cmd
	conn    net.Conn
	client  *dap.Client
	closed  bool
}

// DebugManager possiede i processi dlv e i breakpoint dei progetti; ogni evento porta l'id della sessione di debug.
type DebugManager struct {
	mu          sync.Mutex
	sessions    map[DebugSessionID]*debugger
	breakpoints map[SessionID]map[string][]int
	emit        func(eventType string, sessionID SessionID, resourceID string, payload any)
}

func NewDebugManager() *DebugManager {
	return &DebugManager{sessions: make(map[DebugSessionID]*debugger), breakpoints: make(map[SessionID]map[string][]int)}
}

// SetEmitter collega gli eventi del debugger al servizio.
func (m *DebugManager) SetEmitter(emit func(string, SessionID, string, any)) {
	m.mu.Lock()
	m.emit = emit
	m.mu.Unlock()
}

func (m *DebugManager) publish(eventType string, sessionID SessionID, resourceID string, payload any) {
	m.mu.Lock()
	emit := m.emit
	m.mu.Unlock()
	if emit != nil {
		emit(eventType, sessionID, resourceID, payload)
	}
}

func (m *DebugManager) get(id DebugSessionID) (*debugger, error) {
	m.mu.Lock()
	defer m.mu.Unlock()
	session, ok := m.sessions[id]
	if !ok {
		return nil, fmt.Errorf("sessione di debug non trovata o terminata")
	}
	return session, nil
}

// debugLaunch contiene tutto il necessario per avviare dlv, già validato dal servizio.
type debugLaunch struct {
	session     Session
	request     DebugRequest
	binary      string
	moduleDir   string
	program     string
	environment []string
}

// Start avvia dlv dap e restituisce subito la sessione in stato starting; il resto procede in background.
func (m *DebugManager) Start(launch debugLaunch) (DebugSessionInfo, error) {
	title := launch.request.Target
	if launch.request.Mode == "test" && launch.request.TestName != "" {
		title = launch.request.TestName
	}
	session := &debugger{exited: make(chan struct{}), root: launch.session.Project.RealPath, info: DebugSessionInfo{
		ID: DebugSessionID(newID("debug")), SessionID: launch.session.ID, State: DebugStarting, Title: title, StartedAt: time.Now().UTC(),
	}}
	command := exec.Command(launch.binary, "dap", "--listen=127.0.0.1:0")
	command.Dir = launch.moduleDir
	command.Env = launch.environment
	configureProcess(command, false)
	stdout, err := command.StdoutPipe()
	if err != nil {
		return DebugSessionInfo{}, err
	}
	command.Stderr = command.Stdout
	if err := command.Start(); err != nil {
		return DebugSessionInfo{}, fmt.Errorf("avvio di Delve fallito: %w", err)
	}
	session.command = command
	m.mu.Lock()
	m.sessions[session.info.ID] = session
	m.mu.Unlock()
	m.publishState(session)
	go m.run(session, launch, stdout)
	return session.info, nil
}

func (m *DebugManager) run(session *debugger, launch debugLaunch, stdout io.Reader) {
	address := make(chan string, 1)
	go m.readProcessOutput(session, stdout, address)
	go func() {
		_ = session.command.Wait()
		close(session.exited)
		m.terminate(session, "")
	}()
	var endpoint string
	select {
	case endpoint = <-address:
	case <-time.After(debugAddressTimeout):
		m.terminate(session, "Delve non ha aperto l'endpoint DAP in tempo")
		return
	}
	conn, err := net.DialTimeout("tcp", endpoint, 5*time.Second)
	if err != nil {
		m.terminate(session, fmt.Sprintf("connessione a Delve fallita: %v", err))
		return
	}
	client := dap.NewClient(conn)
	session.mu.Lock()
	session.conn, session.client = conn, client
	session.mu.Unlock()
	initialized := make(chan struct{})
	go m.readEvents(session, client, initialized)
	if err := m.handshake(session, launch, client, initialized); err != nil {
		m.terminate(session, err.Error())
	}
}

// handshake esegue initialize → launch → (initialized) setBreakpoints → configurationDone.
func (m *DebugManager) handshake(session *debugger, launch debugLaunch, client *dap.Client, initialized <-chan struct{}) error {
	ctx, cancel := context.WithTimeout(context.Background(), debugRequestTimeout)
	defer cancel()
	if err := client.Call(ctx, "initialize", map[string]any{
		"clientID": "adomnia", "clientName": "adOmnia Go Studio", "adapterID": "go", "pathFormat": "path",
		"linesStartAt1": true, "columnsStartAt1": true, "supportsVariableType": true, "locale": "en",
	}, nil); err != nil {
		return fmt.Errorf("initialize DAP fallito: %w", err)
	}
	arguments := map[string]any{"request": "launch", "mode": launch.request.Mode, "program": launch.program, "cwd": launch.moduleDir, "stopOnEntry": false}
	args := append([]string(nil), launch.request.ProgramArguments...)
	if launch.request.Mode == "test" && launch.request.TestName != "" {
		args = append([]string{"-test.run", launch.request.TestName}, args...)
	}
	if len(args) > 0 {
		arguments["args"] = args
	}
	if len(launch.request.BuildTags) > 0 {
		arguments["buildFlags"] = "-tags=" + strings.Join(launch.request.BuildTags, ",")
	}
	launchCtx, cancelLaunch := context.WithTimeout(context.Background(), debugLaunchTimeout)
	defer cancelLaunch()
	if err := client.Call(launchCtx, "launch", arguments, nil); err != nil {
		return fmt.Errorf("avvio del programma in debug fallito: %w", err)
	}
	select {
	case <-initialized:
	case <-time.After(debugRequestTimeout):
		return fmt.Errorf("Delve non ha completato l'inizializzazione")
	}
	_, projectID := session.identity()
	for path, lines := range m.breakpointsFor(projectID) {
		m.sendBreakpoints(session, path, lines)
	}
	if err := client.Call(ctx, "configurationDone", map[string]any{}, nil); err != nil {
		return fmt.Errorf("configurationDone fallito: %w", err)
	}
	session.mu.Lock()
	if session.info.State == DebugStarting {
		session.info.State = DebugRunning
	}
	session.mu.Unlock()
	m.publishState(session)
	return nil
}

// readProcessOutput cerca l'endpoint DAP e inoltra il resto dell'output di dlv alla console di debug.
func (m *DebugManager) readProcessOutput(session *debugger, stdout io.Reader, address chan<- string) {
	scanner := bufio.NewScanner(stdout)
	scanner.Buffer(make([]byte, 64*1024), 1024*1024)
	found := false
	for scanner.Scan() {
		line := scanner.Text()
		if !found && strings.HasPrefix(line, listeningPrefix) {
			found = true
			address <- strings.TrimSpace(strings.TrimPrefix(line, listeningPrefix))
			continue
		}
		m.output(session, "console", line+"\n")
	}
}

func (m *DebugManager) readEvents(session *debugger, client *dap.Client, initialized chan<- struct{}) {
	signalled := false
	for event := range client.Events() {
		if m.isClosed(session) {
			continue
		}
		switch event.Event {
		case "initialized":
			if !signalled {
				signalled = true
				close(initialized)
			}
		case "stopped":
			var body struct {
				Reason   string `json:"reason"`
				ThreadID int    `json:"threadId"`
			}
			_ = json.Unmarshal(event.Body, &body)
			session.mu.Lock()
			session.info.State, session.info.StopReason, session.info.ThreadID = DebugStopped, body.Reason, body.ThreadID
			session.mu.Unlock()
			m.publishState(session)
		case "continued":
			session.mu.Lock()
			session.info.State, session.info.StopReason = DebugRunning, ""
			session.mu.Unlock()
			m.publishState(session)
		case "output":
			var body struct {
				Category string `json:"category"`
				Output   string `json:"output"`
			}
			_ = json.Unmarshal(event.Body, &body)
			if body.Category == "" {
				body.Category = "console"
			}
			m.output(session, body.Category, body.Output)
		case "terminated", "exited":
			go m.terminate(session, "")
		}
	}
}

func (m *DebugManager) output(session *debugger, category, text string) {
	if text == "" || m.isClosed(session) {
		return
	}
	id, sessionID := session.identity()
	m.publish("debug.output", sessionID, string(id), DebugOutput{DebugID: id, Category: category, Text: text})
}

// identity restituisce gli identificativi, immutabili dopo la creazione ma letti sotto lock per coerenza.
func (session *debugger) identity() (DebugSessionID, SessionID) {
	session.mu.Lock()
	defer session.mu.Unlock()
	return session.info.ID, session.info.SessionID
}

func (m *DebugManager) isClosed(session *debugger) bool {
	session.mu.Lock()
	defer session.mu.Unlock()
	return session.closed
}

func (m *DebugManager) publishState(session *debugger) {
	session.mu.Lock()
	info := session.info
	session.mu.Unlock()
	m.publish("debug.state", info.SessionID, string(info.ID), info)
}

// terminate chiude connessione, dlv e programma debuggato; è idempotente e scarta gli eventi successivi.
func (m *DebugManager) terminate(session *debugger, reason string) {
	session.mu.Lock()
	if session.closed {
		session.mu.Unlock()
		return
	}
	session.closed = true
	session.info.State = DebugTerminated
	if reason != "" {
		session.info.Error = reason
	}
	client, conn, command, info := session.client, session.conn, session.command, session.info
	session.mu.Unlock()
	// Delve termina il programma debuggato solo se gli si lascia completare disconnect: prima la
	// richiesta, poi l'attesa della sua uscita, e solo alla fine la chiusura forzata dell'albero.
	if client != nil {
		ctx, cancel := context.WithTimeout(context.Background(), debugDisconnectTimeout)
		_ = client.Call(ctx, "disconnect", map[string]any{"terminateDebuggee": true}, nil)
		cancel()
	}
	if conn != nil {
		_ = conn.Close()
	}
	if command != nil && command.Process != nil {
		select {
		case <-session.exited:
		case <-time.After(debugDisconnectTimeout):
		}
		_ = terminateProcessTree(command)
	}
	m.mu.Lock()
	delete(m.sessions, info.ID)
	m.mu.Unlock()
	m.publish("debug.state", info.SessionID, string(info.ID), info)
}

// Stop termina la sessione di debug indicata.
func (m *DebugManager) Stop(id DebugSessionID) error {
	session, err := m.get(id)
	if err != nil {
		return nil
	}
	m.terminate(session, "")
	return nil
}

// StopSession termina tutte le sessioni di debug di un progetto.
func (m *DebugManager) StopSession(sessionID SessionID) {
	for _, session := range m.list(sessionID) {
		m.terminate(session, "")
	}
	m.mu.Lock()
	delete(m.breakpoints, sessionID)
	m.mu.Unlock()
}

func (m *DebugManager) list(sessionID SessionID) []*debugger {
	m.mu.Lock()
	defer m.mu.Unlock()
	sessions := make([]*debugger, 0, len(m.sessions))
	for _, session := range m.sessions {
		if sessionID == "" || session.info.SessionID == sessionID {
			sessions = append(sessions, session)
		}
	}
	return sessions
}

// Active restituisce le sessioni di debug in corso del progetto.
func (m *DebugManager) Active(sessionID SessionID) []DebugSessionInfo {
	sessions := m.list(sessionID)
	result := make([]DebugSessionInfo, 0, len(sessions))
	for _, session := range sessions {
		session.mu.Lock()
		result = append(result, session.info)
		session.mu.Unlock()
	}
	sort.Slice(result, func(left, right int) bool { return result[left].StartedAt.Before(result[right].StartedAt) })
	return result
}

// Shutdown termina tutte le sessioni di debug.
func (m *DebugManager) Shutdown() {
	for _, session := range m.list("") {
		m.terminate(session, "")
	}
}

func (m *DebugManager) breakpointsFor(sessionID SessionID) map[string][]int {
	m.mu.Lock()
	defer m.mu.Unlock()
	copyOf := map[string][]int{}
	for path, lines := range m.breakpoints[sessionID] {
		copyOf[path] = append([]int(nil), lines...)
	}
	return copyOf
}

// SetBreakpoints sostituisce i breakpoint di un file; con un debug attivo li invia subito a Delve e ne pubblica la verifica.
func (m *DebugManager) SetBreakpoints(sessionID SessionID, root, path string, lines []int) []BreakpointState {
	unique := uniqueSortedLines(lines)
	m.mu.Lock()
	if m.breakpoints[sessionID] == nil {
		m.breakpoints[sessionID] = map[string][]int{}
	}
	if len(unique) == 0 {
		delete(m.breakpoints[sessionID], path)
	} else {
		m.breakpoints[sessionID][path] = unique
	}
	m.mu.Unlock()
	states := make([]BreakpointState, 0, len(unique))
	for _, line := range unique {
		states = append(states, BreakpointState{Line: line})
	}
	for _, session := range m.list(sessionID) {
		if verified := m.sendBreakpoints(session, path, unique); verified != nil {
			states = verified
		}
	}
	m.publish("debug.breakpoints", sessionID, relativeWithin(root, path), FileBreakpoints{SessionID: sessionID, RelativePath: filepath.ToSlash(relativeWithin(root, path)), Breakpoints: states})
	return states
}

func uniqueSortedLines(lines []int) []int {
	seen := map[int]bool{}
	unique := make([]int, 0, len(lines))
	for _, line := range lines {
		if line > 0 && !seen[line] {
			seen[line] = true
			unique = append(unique, line)
		}
	}
	sort.Ints(unique)
	return unique
}

func (m *DebugManager) sendBreakpoints(session *debugger, path string, lines []int) []BreakpointState {
	session.mu.Lock()
	client := session.client
	session.mu.Unlock()
	if client == nil {
		return nil
	}
	requested := make([]map[string]int, 0, len(lines))
	for _, line := range lines {
		requested = append(requested, map[string]int{"line": line})
	}
	var response struct {
		Breakpoints []struct {
			Verified bool   `json:"verified"`
			Line     int    `json:"line"`
			Message  string `json:"message"`
		} `json:"breakpoints"`
	}
	ctx, cancel := context.WithTimeout(context.Background(), debugRequestTimeout)
	defer cancel()
	if err := client.Call(ctx, "setBreakpoints", map[string]any{"source": map[string]string{"path": path}, "breakpoints": requested}, &response); err != nil {
		return nil
	}
	states := make([]BreakpointState, 0, len(response.Breakpoints))
	for index, breakpoint := range response.Breakpoints {
		line := breakpoint.Line
		if line == 0 && index < len(lines) {
			line = lines[index]
		}
		states = append(states, BreakpointState{Line: line, Verified: breakpoint.Verified, Message: breakpoint.Message})
	}
	return states
}

// call esegue una richiesta DAP su una sessione ancora aperta.
func (m *DebugManager) call(id DebugSessionID, command string, arguments, result any) error {
	session, err := m.get(id)
	if err != nil {
		return err
	}
	session.mu.Lock()
	client := session.client
	session.mu.Unlock()
	if client == nil {
		return fmt.Errorf("il debugger si sta ancora avviando")
	}
	ctx, cancel := context.WithTimeout(context.Background(), debugRequestTimeout)
	defer cancel()
	return client.Call(ctx, command, arguments, result)
}

// Step esegue continue, pause, next, stepIn o stepOut sul thread indicato.
func (m *DebugManager) Step(id DebugSessionID, action string, threadID int) error {
	commands := map[string]string{"continue": "continue", "pause": "pause", "next": "next", "stepIn": "stepIn", "stepOut": "stepOut"}
	command, ok := commands[action]
	if !ok {
		return fmt.Errorf("azione di debug non supportata")
	}
	if err := m.call(id, command, map[string]any{"threadId": threadID}, nil); err != nil {
		return err
	}
	if action != "pause" {
		if session, err := m.get(id); err == nil {
			session.mu.Lock()
			session.info.State, session.info.StopReason = DebugRunning, ""
			session.mu.Unlock()
			m.publishState(session)
		}
	}
	return nil
}

// Threads restituisce le goroutine del programma fermo.
func (m *DebugManager) Threads(id DebugSessionID) ([]DebugThread, error) {
	var response struct {
		Threads []DebugThread `json:"threads"`
	}
	if err := m.call(id, "threads", nil, &response); err != nil {
		return nil, err
	}
	return response.Threads, nil
}

// StackTrace restituisce i frame della goroutine, con i percorsi relativi al progetto quando possibile.
func (m *DebugManager) StackTrace(id DebugSessionID, threadID int) ([]DebugFrame, error) {
	session, err := m.get(id)
	if err != nil {
		return nil, err
	}
	var response struct {
		StackFrames []struct {
			ID     int    `json:"id"`
			Name   string `json:"name"`
			Line   int    `json:"line"`
			Column int    `json:"column"`
			Source *struct {
				Path string `json:"path"`
			} `json:"source"`
		} `json:"stackFrames"`
	}
	if err := m.call(id, "stackTrace", map[string]any{"threadId": threadID, "startFrame": 0, "levels": maxDebugFrames}, &response); err != nil {
		return nil, err
	}
	frames := make([]DebugFrame, 0, len(response.StackFrames))
	for _, frame := range response.StackFrames {
		converted := DebugFrame{ID: frame.ID, Name: frame.Name, Line: frame.Line, Column: frame.Column}
		if frame.Source != nil {
			converted.Path = frame.Source.Path
			converted.RelativePath = filepath.ToSlash(relativeWithin(session.root, frame.Source.Path))
		}
		frames = append(frames, converted)
	}
	return frames, nil
}

// Scopes restituisce gli scope (argomenti, locali) di un frame.
func (m *DebugManager) Scopes(id DebugSessionID, frameID int) ([]DebugScope, error) {
	var response struct {
		Scopes []DebugScope `json:"scopes"`
	}
	if err := m.call(id, "scopes", map[string]any{"frameId": frameID}, &response); err != nil {
		return nil, err
	}
	return response.Scopes, nil
}

// Variables espande un riferimento (scope o variabile composta), con un limite al numero di figli.
func (m *DebugManager) Variables(id DebugSessionID, reference int) ([]DebugVariable, error) {
	var response struct {
		Variables []DebugVariable `json:"variables"`
	}
	if err := m.call(id, "variables", map[string]any{"variablesReference": reference, "count": maxDebugVariables}, &response); err != nil {
		return nil, err
	}
	if len(response.Variables) > maxDebugVariables {
		response.Variables = response.Variables[:maxDebugVariables]
	}
	return response.Variables, nil
}

// Evaluate valuta un'espressione nel frame (watch o console); gli errori di Delve arrivano leggibili.
func (m *DebugManager) Evaluate(id DebugSessionID, expression string, frameID int, context string) (EvaluateResult, error) {
	if strings.TrimSpace(expression) == "" {
		return EvaluateResult{}, fmt.Errorf("espressione vuota")
	}
	if context != "watch" && context != "repl" && context != "hover" {
		context = "watch"
	}
	arguments := map[string]any{"expression": expression, "context": context}
	if frameID > 0 {
		arguments["frameId"] = frameID
	}
	var response EvaluateResult
	err := m.call(id, "evaluate", arguments, &response)
	return response, err
}
