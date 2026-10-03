package dap

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
	"sort"
	"strings"
	"sync"
	"time"

	"adomnia/internal/ide/process"
	"crypto/rand"
	"encoding/hex"
)

const (
	debugAddressTimeout = 20 * time.Second
	debugRequestTimeout = 15 * time.Second
	// debugDisconnectTimeout è il tempo concesso a debug adapter per fermare e chiudere il programma debuggato.
	debugDisconnectTimeout = 5 * time.Second
	// debugLaunchTimeout copre la compilazione del programma fatta da debug adapter durante launch.
	debugLaunchTimeout = 3 * time.Minute
	maxDebugVariables  = 500
	maxDebugFrames     = 200
	maxDisassembly     = 200
)

// Stati di una sessione di debug.
const (
	DebugStarting   = "starting"
	DebugRunning    = "running"
	DebugStopped    = "stopped"
	DebugTerminated = "terminated"
)

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

// DebugOutput è una riga della console di debug (stdout/stderr del programma o messaggi di debug adapter).
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
	// InstructionPointer è l'indirizzo dell'istruzione corrente, da usare con DebugDisassemble.
	InstructionPointer string `json:"instructionPointer,omitempty"`
}

// DebugInstruction è un'istruzione macchina con la riga sorgente che l'ha generata, se nota.
type DebugInstruction struct {
	Address      string `json:"address"`
	Bytes        string `json:"bytes,omitempty"`
	Instruction  string `json:"instruction"`
	Symbol       string `json:"symbol,omitempty"`
	Path         string `json:"path,omitempty"`
	RelativePath string `json:"relativePath,omitempty"`
	Line         int    `json:"line,omitempty"`
	// Current marca l'istruzione su cui il frame è fermo.
	Current bool `json:"current,omitempty"`
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
	// buildDir ospita il binario compilato da debug adapter, fuori dal progetto; si elimina all'uscita di adapter.
	buildDir string
	// detach: allo Stop debug adapter si stacca senza terminare il programma (attach e remote), come in GoLand.
	detach  bool
	command *exec.Cmd
	conn    io.Closer
	spec    AdapterSpec
	client  *Client
	closed  bool
	// runTo è il breakpoint temporaneo di Run to Cursor: si rimuove alla prima fermata.
	runTo *runToCursor
}

// DebugManager possiede i processi adapter e i breakpoint dei progetti; ogni evento porta l'id della sessione di debug.
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

// Start avvia adapter dap e restituisce subito la sessione in stato starting; il resto procede in background.
func (m *DebugManager) Start(launch Launch) (DebugSessionInfo, error) {
	if launch.Spec.AdapterID == "" || launch.Spec.Launch == nil {
		return DebugSessionInfo{}, errors.New("specifica del debug adapter incompleta")
	}
	if launch.Spec.Address == "" {
		if launch.Spec.Executable == "" {
			return DebugSessionInfo{}, errors.New("eseguibile del debug adapter mancante")
		}
		switch launch.Spec.Transport {
		case Stdio:
		case TCPListen:
			ready, err := regexp.Compile(launch.Spec.ReadyPattern)
			if err != nil || ready.NumSubexp() < 1 {
				return DebugSessionInfo{}, errors.New("il pattern DAP deve catturare l'indirizzo TCP")
			}
		default:
			return DebugSessionInfo{}, fmt.Errorf("trasporto DAP non supportato: %s", launch.Spec.Transport)
		}
	}
	if launch.Spec.Address != "" {
		return m.startRemote(launch), nil
	}
	buildDir, err := os.MkdirTemp("", "adomnia-debug-")
	if err != nil {
		return DebugSessionInfo{}, fmt.Errorf("cartella temporanea per il debug non disponibile: %w", err)
	}
	session := &debugger{spec: launch.Spec, exited: make(chan struct{}), root: launch.Root, buildDir: buildDir, detach: launch.Spec.Detach, info: DebugSessionInfo{
		ID: DebugSessionID(newID("debug")), SessionID: launch.SessionID, State: DebugStarting, Title: launch.Spec.Title, StartedAt: time.Now().UTC(),
	}}
	command := exec.Command(launch.Spec.Executable, launch.Spec.Arguments...)
	command.Dir = launch.Spec.WorkingDirectory
	command.Env = launch.Spec.Environment
	process.Configure(command, false)
	stdout, err := command.StdoutPipe()
	if err != nil {
		_ = os.RemoveAll(buildDir)
		return DebugSessionInfo{}, err
	}
	var stdin io.WriteCloser
	var stderr io.ReadCloser
	if launch.Spec.Transport == Stdio {
		stdin, err = command.StdinPipe()
		if err == nil {
			stderr, err = command.StderrPipe()
		}
		if err != nil {
			_ = stdout.Close()
			if stdin != nil {
				_ = stdin.Close()
			}
			_ = os.RemoveAll(buildDir)
			return DebugSessionInfo{}, err
		}
	} else {
		command.Stderr = command.Stdout
	}
	if err := command.Start(); err != nil {
		_ = os.RemoveAll(buildDir)
		return DebugSessionInfo{}, fmt.Errorf("avvio di debug adapter fallito: %w", err)
	}
	session.command = command
	m.mu.Lock()
	m.sessions[session.info.ID] = session
	m.mu.Unlock()
	m.publishState(session)
	// Copia presa prima di avviare la goroutine che aggiorna lo stato: leggerla dopo sarebbe un data race.
	info := session.info
	if launch.Spec.Transport == Stdio {
		stream := &stdioStream{Reader: stdout, Writer: stdin, reader: stdout, writer: stdin}
		go m.readProcessOutput(session, stderr, nil)
		go m.waitAdapter(session)
		go m.connectStream(session, launch, stream, stream)
	} else {
		go m.run(session, launch, stdout)
	}
	return info, nil
}

// startRemote si collega a un server debug adapter già in ascolto: nessun processo locale da avviare o chiudere.
func (m *DebugManager) startRemote(launch Launch) DebugSessionInfo {
	session := &debugger{spec: launch.Spec, exited: make(chan struct{}), root: launch.Root, detach: true, info: DebugSessionInfo{
		ID: DebugSessionID(newID("debug")), SessionID: launch.SessionID, State: DebugStarting, Title: launch.Spec.Title, StartedAt: time.Now().UTC(),
	}}
	close(session.exited)
	m.mu.Lock()
	m.sessions[session.info.ID] = session
	m.mu.Unlock()
	m.publishState(session)
	info := session.info
	go m.connect(session, launch, launch.Spec.Address)
	return info
}

func (m *DebugManager) run(session *debugger, launch Launch, stdout io.Reader) {
	address := make(chan string, 1)
	go m.readProcessOutput(session, stdout, address)
	go m.waitAdapter(session)
	var endpoint string
	select {
	case endpoint = <-address:
	case <-session.exited:
		return
	case <-time.After(debugAddressTimeout):
		m.terminate(session, "debug adapter non ha aperto l'endpoint DAP in tempo")
		return
	}
	m.connect(session, launch, endpoint)
}

// connect apre la connessione DAP ed esegue l'handshake; la chiusura della connessione chiude la sessione.
func (m *DebugManager) connect(session *debugger, launch Launch, endpoint string) {
	conn, err := net.DialTimeout("tcp", endpoint, 5*time.Second)
	if err != nil {
		m.terminate(session, fmt.Sprintf("connessione a debug adapter fallita: %v", err))
		return
	}
	client := NewClient(conn)
	m.connectClient(session, launch, client, conn)
}

func (m *DebugManager) connectStream(session *debugger, launch Launch, stream io.ReadWriter, closer io.Closer) {
	m.connectClient(session, launch, NewClient(stream), closer)
}

func (m *DebugManager) connectClient(session *debugger, launch Launch, client *Client, conn io.Closer) {
	session.mu.Lock()
	if session.closed {
		session.mu.Unlock()
		_ = conn.Close()
		return
	}
	session.conn, session.client = conn, client
	session.mu.Unlock()
	initialized := make(chan struct{})
	go m.readEvents(session, client, initialized)
	if err := m.handshake(session, launch, client, initialized); err != nil {
		m.terminate(session, err.Error())
	}
}

// handshake esegue initialize → launch → (initialized) setBreakpoints → configurationDone.
func (m *DebugManager) handshake(session *debugger, launch Launch, client *Client, initialized <-chan struct{}) error {
	ctx, cancel := context.WithTimeout(context.Background(), debugRequestTimeout)
	defer cancel()
	if err := client.Call(ctx, "initialize", map[string]any{
		"clientID": "adomnia", "clientName": "adOmnia IDE", "adapterID": launch.Spec.AdapterID, "pathFormat": "path",
		"linesStartAt1": true, "columnsStartAt1": true, "supportsVariableType": true, "locale": "en",
	}, nil); err != nil {
		return fmt.Errorf("initialize DAP fallito: %w", err)
	}
	command, arguments := launch.Spec.Launch(session.buildDir)
	launchCtx, cancelLaunch := context.WithTimeout(context.Background(), debugLaunchTimeout)
	defer cancelLaunch()
	if err := client.Call(launchCtx, command, arguments, nil); err != nil {
		if launch.Spec.ExplainError != nil {
			return launch.Spec.ExplainError(err)
		}
		return err
	}
	select {
	case <-initialized:
	case <-time.After(debugRequestTimeout):
		return errors.New("debug adapter non ha completato l'inizializzazione")
	}
	_, projectID := session.identity()
	for path, breakpoints := range m.breakpointsFor(projectID) {
		m.sendBreakpoints(session, path, breakpoints)
	}
	m.publishFunctionBreakpoints(session, m.sendFunctionBreakpoints(session, m.functionsFor(projectID)))
	configurationCtx, cancelConfiguration := context.WithTimeout(context.Background(), debugRequestTimeout)
	defer cancelConfiguration()
	if err := client.Call(configurationCtx, "configurationDone", map[string]any{}, nil); err != nil {
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

// readProcessOutput cerca l'endpoint DAP e inoltra il resto dell'output di adapter alla console di debug.
func (m *DebugManager) readProcessOutput(session *debugger, stdout io.Reader, address chan<- string) {
	var ready *regexp.Regexp
	if address != nil {
		ready = regexp.MustCompile(session.spec.ReadyPattern)
	}
	scanner := bufio.NewScanner(stdout)
	scanner.Buffer(make([]byte, 64*1024), 1024*1024)
	found := false
	for scanner.Scan() {
		line := scanner.Text()
		if ready != nil && !found {
			if match := ready.FindStringSubmatch(line); len(match) > 1 {
				found = true
				address <- strings.TrimSpace(match[1])
				continue
			}
		}
		m.output(session, "console", line+"\n")
	}
}

func (m *DebugManager) readEvents(session *debugger, client *Client, initialized chan<- struct{}) {
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

// terminate chiude connessione, adapter e programma debuggato; è idempotente e scarta gli eventi successivi.
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
	// debug adapter termina il programma debuggato solo se gli si lascia completare disconnect: prima la
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
		_ = process.TerminateTree(command)
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
			InstructionPointerReference string `json:"instructionPointerReference"`
		} `json:"stackFrames"`
	}
	if err := m.call(id, "stackTrace", map[string]any{"threadId": threadID, "startFrame": 0, "levels": levels}, &response); err != nil {
		return nil, err
	}
	frames := make([]DebugFrame, 0, len(response.StackFrames))
	for _, frame := range response.StackFrames {
		converted := DebugFrame{ID: frame.ID, Name: frame.Name, Line: frame.Line, Column: frame.Column, InstructionPointer: frame.InstructionPointerReference}
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

// ShowRegisters aggiunge (o toglie) lo scope "Registers" ai frame, tramite la configurazione DAP di debug adapter.

// Disassemble restituisce le istruzioni attorno a un indirizzo (DAP disassemble): before istruzioni
// prima e after dopo quella indicata, che resta marcata come corrente.
func (m *DebugManager) Disassemble(id DebugSessionID, address string, before, after int) ([]DebugInstruction, error) {
	session, err := m.get(id)
	if err != nil {
		return nil, err
	}
	address = strings.TrimSpace(address)
	if address == "" {
		return nil, fmt.Errorf("indirizzo dell'istruzione mancante: il frame non ha un instruction pointer")
	}
	before, after = min(max(before, 0), maxDisassembly), min(max(after, 0), maxDisassembly)
	var response struct {
		Instructions []struct {
			Address          string `json:"address"`
			InstructionBytes string `json:"instructionBytes"`
			Instruction      string `json:"instruction"`
			Symbol           string `json:"symbol"`
			Location         *struct {
				Path string `json:"path"`
			} `json:"location"`
			Line int `json:"line"`
		} `json:"instructions"`
	}
	arguments := map[string]any{"memoryReference": address, "instructionOffset": -before, "instructionCount": before + after + 1, "resolveSymbols": true}
	if err := m.call(id, "disassemble", arguments, &response); err != nil {
		return nil, err
	}
	instructions := make([]DebugInstruction, 0, len(response.Instructions))
	for _, item := range response.Instructions {
		// La corrente si riconosce dall'indirizzo: debug adapter può restituire meno istruzioni prima.
		converted := DebugInstruction{Address: item.Address, Bytes: item.InstructionBytes, Instruction: item.Instruction, Symbol: item.Symbol, Line: item.Line, Current: strings.EqualFold(item.Address, address)}
		if item.Location != nil {
			converted.Path = item.Location.Path
			converted.RelativePath = filepath.ToSlash(relativeWithin(session.root, item.Location.Path))
		}
		instructions = append(instructions, converted)
	}
	return instructions, nil
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

// Evaluate valuta un'espressione nel frame (watch o console); gli errori di debug adapter arrivano leggibili.
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
	session, lookupErr := m.get(id)
	if lookupErr != nil {
		return EvaluateResult{}, lookupErr
	}
	if err != nil && session.spec.RetryEvaluate != nil {
		if replacement, retry := session.spec.RetryEvaluate(expression, context, err); retry {
			arguments["expression"] = replacement
			response = EvaluateResult{}
			err = m.call(id, "evaluate", arguments, &response)
		}
	}
	if err != nil {
		if session.spec.ExplainEvaluateError != nil {
			return EvaluateResult{}, session.spec.ExplainEvaluateError(err, context)
		}
		return EvaluateResult{}, err
	}
	return response, nil
}

func newID(prefix string) string {
	random := make([]byte, 12)
	if _, err := rand.Read(random); err != nil {
		return fmt.Sprintf("%s-%d", prefix, time.Now().UnixNano())
	}
	return prefix + "-" + hex.EncodeToString(random)
}

func relativeWithin(root, path string) string {
	relative, err := filepath.Rel(root, path)
	if err != nil || relative == ".." || strings.HasPrefix(relative, ".."+string(filepath.Separator)) {
		return ""
	}
	return relative
}
func (m *DebugManager) Call(id DebugSessionID, command string, arguments, result any) error {
	return m.call(id, command, arguments, result)
}
func (m *DebugManager) StackTraceLimit(id DebugSessionID, threadID, levels int) ([]DebugFrame, error) {
	return m.stackTrace(id, threadID, levels)
}
func (m *DebugManager) BuildDirectory(id DebugSessionID) (string, error) {
	session, err := m.get(id)
	if err != nil {
		return "", err
	}
	return session.buildDir, nil
}
