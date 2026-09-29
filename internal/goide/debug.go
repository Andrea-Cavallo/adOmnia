package goide

import (
	"bufio"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net"
	"os"
	"os/exec"
	"path/filepath"
	"regexp"
	"runtime"
	"sort"
	"strings"
	"sync"
	"time"

	"adomnia/internal/goide/dap"
)

const (
	debugModeAttach = "attach"
	debugModeRemote = "remote"
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
	// Mode è "debug" (programma), "test", "attach" (processo locale) o "remote" (dlv --headless già avviato).
	Mode string `json:"mode"`
	// ProcessID è il processo a cui agganciarsi in modalità attach.
	ProcessID int `json:"processId,omitempty"`
	// Address è host:porta del server Delve in modalità remote.
	Address string `json:"address,omitempty"`
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
	mu     sync.Mutex
	exited chan struct{}
	info   DebugSessionInfo
	root   string
	// buildDir ospita il binario compilato da Delve, fuori dal progetto; si elimina all'uscita di dlv.
	buildDir string
	// detach: allo Stop Delve si stacca senza terminare il programma (attach e remote), come in GoLand.
	detach  bool
	command *exec.Cmd
	conn    net.Conn
	client  *dap.Client
	closed  bool
	// runTo è il breakpoint temporaneo di Run to Cursor: si rimuove alla prima fermata.
	runTo *runToCursor
}

// DebugManager possiede i processi dlv e i breakpoint dei progetti; ogni evento porta l'id della sessione di debug.
type DebugManager struct {
	mu          sync.Mutex
	sessions    map[DebugSessionID]*debugger
	breakpoints map[SessionID]map[string][]Breakpoint
	functions   map[SessionID]FunctionBreakpointSettings
	emit        func(eventType string, sessionID SessionID, resourceID string, payload any)
}

func NewDebugManager() *DebugManager {
	return &DebugManager{sessions: make(map[DebugSessionID]*debugger), breakpoints: make(map[SessionID]map[string][]Breakpoint), functions: make(map[SessionID]FunctionBreakpointSettings)}
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
	if launch.request.Mode == debugModeRemote {
		return m.startRemote(launch), nil
	}
	buildDir, err := os.MkdirTemp("", "adomnia-debug-")
	if err != nil {
		return DebugSessionInfo{}, fmt.Errorf("cartella temporanea per il debug non disponibile: %w", err)
	}
	session := &debugger{exited: make(chan struct{}), root: launch.session.Project.RealPath, buildDir: buildDir, detach: launch.request.Mode == debugModeAttach, info: DebugSessionInfo{
		ID: DebugSessionID(newID("debug")), SessionID: launch.session.ID, State: DebugStarting, Title: debugTitle(launch.request), StartedAt: time.Now().UTC(),
	}}
	command := exec.Command(launch.binary, "dap", "--listen=127.0.0.1:0")
	command.Dir = launch.moduleDir
	command.Env = launch.environment
	configureProcess(command, false)
	stdout, err := command.StdoutPipe()
	if err != nil {
		_ = os.RemoveAll(buildDir)
		return DebugSessionInfo{}, err
	}
	command.Stderr = command.Stdout
	if err := command.Start(); err != nil {
		_ = os.RemoveAll(buildDir)
		return DebugSessionInfo{}, fmt.Errorf("avvio di Delve fallito: %w", err)
	}
	session.command = command
	m.mu.Lock()
	m.sessions[session.info.ID] = session
	m.mu.Unlock()
	m.publishState(session)
	// Copia presa prima di avviare la goroutine che aggiorna lo stato: leggerla dopo sarebbe un data race.
	info := session.info
	go m.run(session, launch, stdout)
	return info, nil
}

// startRemote si collega a un server Delve già in ascolto: nessun processo locale da avviare o chiudere.
func (m *DebugManager) startRemote(launch debugLaunch) DebugSessionInfo {
	session := &debugger{exited: make(chan struct{}), root: launch.session.Project.RealPath, detach: true, info: DebugSessionInfo{
		ID: DebugSessionID(newID("debug")), SessionID: launch.session.ID, State: DebugStarting, Title: debugTitle(launch.request), StartedAt: time.Now().UTC(),
	}}
	close(session.exited)
	m.mu.Lock()
	m.sessions[session.info.ID] = session
	m.mu.Unlock()
	m.publishState(session)
	info := session.info
	go m.connect(session, launch, launch.request.Address)
	return info
}

func (m *DebugManager) run(session *debugger, launch debugLaunch, stdout io.Reader) {
	address := make(chan string, 1)
	go m.readProcessOutput(session, stdout, address)
	go func() {
		_ = session.command.Wait()
		_ = os.RemoveAll(session.buildDir)
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
	m.connect(session, launch, endpoint)
}

// connect apre la connessione DAP ed esegue l'handshake; la chiusura della connessione chiude la sessione.
func (m *DebugManager) connect(session *debugger, launch debugLaunch, endpoint string) {
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
	command, arguments := launchArguments(session, launch)
	launchCtx, cancelLaunch := context.WithTimeout(context.Background(), debugLaunchTimeout)
	defer cancelLaunch()
	if err := client.Call(launchCtx, command, arguments, nil); err != nil {
		return explainLaunchError(err)
	}
	select {
	case <-initialized:
	case <-time.After(debugRequestTimeout):
		return errors.New("delve non ha completato l'inizializzazione")
	}
	_, projectID := session.identity()
	for path, breakpoints := range m.breakpointsFor(projectID) {
		m.sendBreakpoints(session, path, breakpoints)
	}
	m.publishFunctionBreakpoints(session, m.sendFunctionBreakpoints(session, m.functionsFor(projectID)))
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
			finished := session.runTo
			session.runTo = nil
			session.mu.Unlock()
			m.publishState(session)
			if finished != nil {
				// Fuori dal ciclo degli eventi: la risposta di setBreakpoints passa da qui.
				go m.resendFile(session, finished.path)
			}
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
	// Connessione chiusa dall'altra parte (es. server remoto fermato): la sessione finisce.
	go m.terminate(session, "")
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
	client, conn, command, info, detach := session.client, session.conn, session.command, session.info, session.detach
	session.mu.Unlock()
	// Delve termina il programma debuggato solo se gli si lascia completare disconnect: prima la
	// richiesta, poi l'attesa della sua uscita, e solo alla fine la chiusura forzata dell'albero.
	if client != nil {
		ctx, cancel := context.WithTimeout(context.Background(), debugDisconnectTimeout)
		_ = client.Call(ctx, "disconnect", map[string]any{"terminateDebuggee": !detach}, nil)
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
	delete(m.functions, sessionID)
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

// launchArguments costruisce la richiesta DAP: launch per programmi e test, attach per processi locali e server remoti.
func launchArguments(session *debugger, launch debugLaunch) (string, map[string]any) {
	switch launch.request.Mode {
	case debugModeAttach:
		return "attach", map[string]any{"request": "attach", "mode": "local", "processId": launch.request.ProcessID}
	case debugModeRemote:
		return "attach", map[string]any{"request": "attach", "mode": "remote"}
	}
	arguments := map[string]any{
		"request": "launch", "mode": launch.request.Mode, "program": launch.program, "cwd": launch.moduleDir, "stopOnEntry": false,
		"output": filepath.Join(session.buildDir, debugBinaryName()),
		// Come GoLand: variabili di package nel pannello Variables e solo le goroutine dell'utente.
		"showGlobalVariables": true, "hideSystemGoroutines": true,
	}
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
	return "launch", arguments
}

// debugTitle dà un nome leggibile alla sessione: il test senza ancore regex, o il package del programma.
func debugTitle(request DebugRequest) string {
	switch request.Mode {
	case debugModeAttach:
		return fmt.Sprintf("attach %d", request.ProcessID)
	case debugModeRemote:
		return "remote " + request.Address
	}
	if request.Mode == "test" {
		name := request.TestName
		if name == "^$" {
			for index, argument := range request.ProgramArguments {
				if argument == "-test.bench" && index+1 < len(request.ProgramArguments) {
					name = request.ProgramArguments[index+1]
				}
			}
		}
		if name = strings.NewReplacer("^", "", "$", "").Replace(name); name != "" {
			return name
		}
		return "tests " + request.Target
	}
	target := strings.TrimPrefix(strings.TrimSpace(request.Target), "./")
	if target == "" || target == "." {
		return "main"
	}
	return target
}

func debugBinaryName() string {
	if runtime.GOOS == "windows" {
		return "__debug_bin.exe"
	}
	return "__debug_bin"
}

// explainLaunchError rende azionabile l'errore più comune: Delve più recente dell'SDK Go del progetto.
func explainLaunchError(err error) error {
	if strings.Contains(err.Error(), "too old for this version of Delve") {
		return fmt.Errorf("the project Go SDK is older than this Delve supports: select a newer SDK (Go → Go SDKs & Toolchains…) or point to a compatible dlv (Go → Tool Paths…). Details: %w", err)
	}
	return fmt.Errorf("avvio del programma in debug fallito: %w", err)
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
	return m.stackTrace(id, threadID, maxDebugFrames)
}

func (m *DebugManager) stackTrace(id DebugSessionID, threadID, levels int) ([]DebugFrame, error) {
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
	if err := m.call(id, "stackTrace", map[string]any{"threadId": threadID, "startFrame": 0, "levels": levels}, &response); err != nil {
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
	expression = strings.TrimSpace(expression)
	if expression == "" {
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
	// In console le chiamate di funzione funzionano come in GoLand: Delve vuole il prefisso "call".
	// Watch e hover non le eseguono mai, perché eseguirebbero codice del programma di nascosto.
	if err != nil && context == "repl" && strings.Contains(err.Error(), evaluateNeedsCall) {
		arguments["expression"] = "call " + expression
		response = EvaluateResult{}
		err = m.call(id, "evaluate", arguments, &response)
	}
	if err != nil {
		return EvaluateResult{}, explainEvaluateError(err, context)
	}
	return response, nil
}

const (
	evaluateErrorPrefix = "Unable to evaluate expression: "
	evaluateNeedsCall   = "function calls not allowed without using 'call'"
)

var missingSymbol = regexp.MustCompile(`could not find symbol (?:value for )?(\S+)`)

// explainEvaluateError traduce gli errori di Delve in messaggi brevi e azionabili.
func explainEvaluateError(err error, context string) error {
	message := strings.TrimPrefix(err.Error(), evaluateErrorPrefix)
	if match := missingSymbol.FindStringSubmatch(message); match != nil {
		return fmt.Errorf("%s is not visible in the selected frame", match[1])
	}
	if strings.Contains(message, evaluateNeedsCall) && context != "repl" {
		return fmt.Errorf("function calls run only from the Debug console")
	}
	return fmt.Errorf("%s", message)
}
