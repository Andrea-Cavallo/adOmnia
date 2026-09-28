package goide

import (
	"bufio"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"os/exec"
	"strings"
	"sync"
	"time"

	"adomnia/internal/goide/lsp"
)

const (
	MaxPendingLSPRequests   = 128
	maxLanguageServerLog    = 500
	maxCrashRestarts        = 3
	crashWindow             = 2 * time.Minute
	initializeTimeout       = 60 * time.Second
	shutdownTimeout         = 2 * time.Second
	defaultRequestTimeout   = 15 * time.Second
	maxCodeActionCacheItems = 64
)

// LanguageServerOptions descrive come avviare gopls per una sessione.
type LanguageServerOptions struct {
	Binary      string
	Version     string
	Environment []string
	Settings    LanguageServerSettings
}

type lspEmitter func(eventType string, sessionID SessionID, resourceID string, payload any)

type serverProcess struct {
	command *exec.Cmd
	stdin   io.WriteCloser
	conn    *lsp.Conn
	exited  chan struct{}
}

type trackedDocument struct {
	id         DocumentID
	uri        string
	path       string
	languageID string
	version    int
	text       string
	readOnly   bool
}

type lspSession struct {
	mu          sync.Mutex
	id          SessionID
	root        string
	rootURI     string
	name        string
	options     LanguageServerOptions
	status      LanguageServerStatus
	process     *serverProcess
	stopping    bool
	launching   bool
	crashes     []time.Time
	documents   map[DocumentID]*trackedDocument
	byURI       map[string]DocumentID
	log         []string
	codeActions map[string]lsp.CodeAction
	applyEdits  []lsp.WorkspaceEdit
	diagnostics map[string][]lsp.Diagnostic
}

type LSPManager struct {
	mu       sync.Mutex
	sessions map[SessionID]*lspSession
	emit     lspEmitter
}

func NewLSPManager() *LSPManager {
	return &LSPManager{sessions: make(map[SessionID]*lspSession)}
}

// SetEmitter collega gli eventi LSP al proprietario applicativo.
func (m *LSPManager) SetEmitter(emit lspEmitter) {
	m.mu.Lock()
	m.emit = emit
	m.mu.Unlock()
}

func (m *LSPManager) publish(eventType string, sessionID SessionID, resourceID string, payload any) {
	m.mu.Lock()
	emit := m.emit
	m.mu.Unlock()
	if emit != nil {
		emit(eventType, sessionID, resourceID, payload)
	}
}

func (m *LSPManager) ensure(session Session) *lspSession {
	m.mu.Lock()
	defer m.mu.Unlock()
	if existing, ok := m.sessions[session.ID]; ok {
		return existing
	}
	created := &lspSession{
		id: session.ID, root: session.Project.RealPath, rootURI: fileURI(session.Project.RealPath), name: session.Project.Name,
		status:    LanguageServerStatus{SessionID: session.ID, State: LanguageServerStopped},
		documents: make(map[DocumentID]*trackedDocument), byURI: make(map[string]DocumentID),
		codeActions: make(map[string]lsp.CodeAction), diagnostics: make(map[string][]lsp.Diagnostic),
	}
	m.sessions[session.ID] = created
	return created
}

func (m *LSPManager) get(sessionID SessionID) (*lspSession, bool) {
	m.mu.Lock()
	defer m.mu.Unlock()
	session, ok := m.sessions[sessionID]
	return session, ok
}

// Status restituisce lo stato corrente di gopls per la sessione.
func (m *LSPManager) Status(sessionID SessionID) LanguageServerStatus {
	session, ok := m.get(sessionID)
	if !ok {
		return LanguageServerStatus{SessionID: sessionID, State: LanguageServerStopped}
	}
	session.mu.Lock()
	defer session.mu.Unlock()
	return session.status
}

// Log restituisce le ultime righe di log del language server della sessione.
func (m *LSPManager) Log(sessionID SessionID) []string {
	session, ok := m.get(sessionID)
	if !ok {
		return []string{}
	}
	session.mu.Lock()
	defer session.mu.Unlock()
	return append([]string(nil), session.log...)
}

// Start avvia gopls per la sessione se non è già attivo; i documenti tracciati vengono riaperti.
func (m *LSPManager) Start(session Session, options LanguageServerOptions) (LanguageServerStatus, error) {
	state := m.ensure(session)
	state.mu.Lock()
	if state.process != nil || state.launching {
		status := state.status
		state.mu.Unlock()
		return status, nil
	}
	state.launching = true
	state.options = options
	state.stopping = false
	state.status = LanguageServerStatus{SessionID: session.ID, State: LanguageServerStarting, Binary: options.Binary, Version: options.Version, Restarts: state.status.Restarts}
	state.mu.Unlock()
	m.publishStatus(state)
	if err := m.launch(state); err != nil {
		m.setState(state, LanguageServerCrashed, err.Error())
		return m.Status(session.ID), err
	}
	return m.Status(session.ID), nil
}

// launch avvia il processo; il chiamante deve aver impostato launching, che viene sempre azzerato.
func (m *LSPManager) launch(state *lspSession) error {
	defer func() {
		state.mu.Lock()
		state.launching = false
		state.mu.Unlock()
	}()
	state.mu.Lock()
	options := state.options
	root := state.root
	state.mu.Unlock()

	command := exec.Command(options.Binary)
	command.Dir = root
	command.Env = options.Environment
	configureProcess(command, false)
	stdin, err := command.StdinPipe()
	if err != nil {
		return fmt.Errorf("impossibile collegare stdin di gopls: %w", err)
	}
	stdout, err := command.StdoutPipe()
	if err != nil {
		return fmt.Errorf("impossibile collegare stdout di gopls: %w", err)
	}
	stderr, err := command.StderrPipe()
	if err != nil {
		return fmt.Errorf("impossibile collegare stderr di gopls: %w", err)
	}
	if err := command.Start(); err != nil {
		return fmt.Errorf("avvio gopls fallito: %w", err)
	}
	process := &serverProcess{command: command, stdin: stdin, exited: make(chan struct{})}
	process.conn = lsp.NewConn(stdout, stdin, &lspHandler{manager: m, session: state, process: process})
	go process.conn.Run()
	go m.collectStderr(state, process, stderr)
	go m.watch(state, process)

	state.mu.Lock()
	state.process = process
	state.status.PID = command.Process.Pid
	state.mu.Unlock()

	ctx, cancel := context.WithTimeout(context.Background(), initializeTimeout)
	defer cancel()
	var initialized initializeResult
	if err := process.conn.Call(ctx, "initialize", initializeParams(state), &initialized); err != nil {
		m.abandon(state, process)
		return fmt.Errorf("inizializzazione gopls fallita: %w", err)
	}
	features := initialized.Capabilities.features()
	state.mu.Lock()
	state.status.Features = &features
	state.mu.Unlock()
	if err := process.conn.Notify("initialized", map[string]any{}); err != nil {
		m.abandon(state, process)
		return err
	}
	m.reopenDocuments(state, process)
	m.setState(state, LanguageServerReady, "")
	return nil
}

func (m *LSPManager) reopenDocuments(state *lspSession, process *serverProcess) {
	state.mu.Lock()
	documents := make([]trackedDocument, 0, len(state.documents))
	for _, document := range state.documents {
		documents = append(documents, *document)
	}
	state.mu.Unlock()
	for _, document := range documents {
		_ = process.conn.Notify("textDocument/didOpen", map[string]any{"textDocument": lsp.TextDocumentItem{
			URI: document.uri, LanguageID: document.languageID, Version: document.version, Text: document.text,
		}})
	}
}

func (m *LSPManager) collectStderr(state *lspSession, process *serverProcess, stderr io.Reader) {
	scanner := bufio.NewScanner(stderr)
	scanner.Buffer(make([]byte, 64*1024), 1024*1024)
	for scanner.Scan() {
		if !m.isCurrent(state, process) {
			continue
		}
		m.appendLog(state, "stderr: "+scanner.Text())
	}
}

func (m *LSPManager) watch(state *lspSession, process *serverProcess) {
	err := process.command.Wait()
	// exited si chiude solo dopo l'aggiornamento di stato: chi attende Stop vede già lo stato finale.
	defer close(process.exited)
	state.mu.Lock()
	if state.process != process {
		state.mu.Unlock()
		return
	}
	state.process = nil
	stopping := state.stopping
	state.status.PID = 0
	state.mu.Unlock()
	if stopping {
		m.setState(state, LanguageServerStopped, "")
		return
	}
	reason := "gopls terminato inaspettatamente"
	if err != nil {
		reason = fmt.Sprintf("%s: %v", reason, err)
	}
	m.appendLog(state, reason)
	m.handleCrash(state, reason)
}

func (m *LSPManager) handleCrash(state *lspSession, reason string) {
	state.mu.Lock()
	now := time.Now()
	recent := state.crashes[:0]
	for _, crash := range state.crashes {
		if now.Sub(crash) < crashWindow {
			recent = append(recent, crash)
		}
	}
	state.crashes = append(recent, now)
	attempt := len(state.crashes)
	state.status.Restarts++
	state.mu.Unlock()
	if attempt > maxCrashRestarts {
		m.setState(state, LanguageServerCrashed, reason+"; riavvio automatico sospeso, usa Restart")
		return
	}
	m.setState(state, LanguageServerStarting, reason+"; riavvio in corso")
	go func() {
		time.Sleep(time.Duration(1<<(attempt-1)) * time.Second)
		state.mu.Lock()
		cancelled := state.stopping || state.process != nil || state.launching
		if !cancelled {
			state.launching = true
		}
		state.mu.Unlock()
		if cancelled {
			return
		}
		if err := m.launch(state); err != nil {
			m.handleCrash(state, err.Error())
		}
	}()
}

// Stop chiude gopls con shutdown/exit e termina il process tree se non risponde.
func (m *LSPManager) Stop(sessionID SessionID) {
	state, ok := m.get(sessionID)
	if !ok {
		return
	}
	state.mu.Lock()
	state.stopping = true
	process := state.process
	state.mu.Unlock()
	if process == nil {
		m.setState(state, LanguageServerStopped, "")
		return
	}
	ctx, cancel := context.WithTimeout(context.Background(), shutdownTimeout)
	_ = process.conn.Call(ctx, "shutdown", nil, nil)
	cancel()
	_ = process.conn.Notify("exit", nil)
	_ = process.stdin.Close()
	select {
	case <-process.exited:
	case <-time.After(shutdownTimeout):
		_ = terminateProcessTree(process.command)
		<-process.exited
	}
}

// Restart arresta e riavvia gopls azzerando il contatore dei crash.
func (m *LSPManager) Restart(session Session, options LanguageServerOptions) (LanguageServerStatus, error) {
	m.Stop(session.ID)
	if state, ok := m.get(session.ID); ok {
		state.mu.Lock()
		state.crashes = nil
		state.mu.Unlock()
	}
	return m.Start(session, options)
}

// CloseSession arresta gopls e dimentica documenti e diagnostica della sessione.
func (m *LSPManager) CloseSession(sessionID SessionID) {
	m.Stop(sessionID)
	m.mu.Lock()
	delete(m.sessions, sessionID)
	m.mu.Unlock()
}

// Shutdown arresta tutti i language server posseduti dal manager.
func (m *LSPManager) Shutdown() {
	m.mu.Lock()
	ids := make([]SessionID, 0, len(m.sessions))
	for id := range m.sessions {
		ids = append(ids, id)
	}
	m.mu.Unlock()
	var group sync.WaitGroup
	for _, id := range ids {
		group.Add(1)
		go func(id SessionID) { defer group.Done(); m.Stop(id) }(id)
	}
	group.Wait()
}

// abandon stacca il processo dalla sessione prima di terminarlo, così il watcher non lo tratta come crash.
func (m *LSPManager) abandon(state *lspSession, process *serverProcess) {
	state.mu.Lock()
	if state.process == process {
		state.process = nil
		state.status.PID = 0
	}
	state.mu.Unlock()
	_ = process.stdin.Close()
	_ = terminateProcessTree(process.command)
}

func (m *LSPManager) isCurrent(state *lspSession, process *serverProcess) bool {
	state.mu.Lock()
	defer state.mu.Unlock()
	return state.process == process
}

func (m *LSPManager) setState(state *lspSession, value LanguageServerState, message string) {
	state.mu.Lock()
	state.status.State = value
	state.status.Error = message
	state.mu.Unlock()
	m.publishStatus(state)
}

func (m *LSPManager) publishStatus(state *lspSession) {
	state.mu.Lock()
	status := state.status
	state.mu.Unlock()
	m.publish("lsp.status", status.SessionID, string(status.SessionID), status)
}

func (m *LSPManager) appendLog(state *lspSession, line string) {
	stamped := time.Now().Format("15:04:05.000") + " " + strings.TrimRight(line, "\r\n")
	state.mu.Lock()
	state.log = append(state.log, stamped)
	if overflow := len(state.log) - maxLanguageServerLog; overflow > 0 {
		state.log = append([]string(nil), state.log[overflow:]...)
	}
	state.mu.Unlock()
}

func initializeParams(state *lspSession) map[string]any {
	state.mu.Lock()
	defer state.mu.Unlock()
	return map[string]any{
		"processId":             nil,
		"clientInfo":            map[string]any{"name": "adOmnia Go Studio"},
		"rootUri":               state.rootURI,
		"workspaceFolders":      []map[string]any{{"uri": state.rootURI, "name": state.name}},
		"initializationOptions": goplsSettings(state.options.Settings),
		"capabilities": map[string]any{
			"general": map[string]any{"positionEncodings": []string{"utf-16"}},
			"workspace": map[string]any{
				"applyEdit": true, "configuration": true, "workspaceFolders": true,
				"workspaceEdit": map[string]any{"documentChanges": true, "resourceOperations": []string{}},
				"symbol":        map[string]any{"dynamicRegistration": false},
			},
			"window": map[string]any{"workDoneProgress": true, "showMessage": map[string]any{}},
			"textDocument": map[string]any{
				"synchronization": map[string]any{"didSave": true, "willSave": false},
				"completion": map[string]any{
					"completionItem": map[string]any{
						"snippetSupport": true, "documentationFormat": []string{"markdown", "plaintext"},
						"deprecatedSupport": true, "preselectSupport": true, "tagSupport": map[string]any{"valueSet": []int{1}},
					},
					"contextSupport": true,
				},
				"hover":          map[string]any{"contentFormat": []string{"markdown", "plaintext"}},
				"signatureHelp":  map[string]any{"signatureInformation": map[string]any{"documentationFormat": []string{"markdown", "plaintext"}, "parameterInformation": map[string]any{"labelOffsetSupport": true}}},
				"definition":     map[string]any{"linkSupport": true},
				"typeDefinition": map[string]any{"linkSupport": true},
				"implementation": map[string]any{"linkSupport": true},
				"references":     map[string]any{},
				"documentSymbol": map[string]any{"hierarchicalDocumentSymbolSupport": true},
				"formatting":     map[string]any{},
				"rename":         map[string]any{"prepareSupport": true},
				"codeAction": map[string]any{
					"codeActionLiteralSupport": map[string]any{"codeActionKind": map[string]any{"valueSet": []string{
						"", "quickfix", "refactor", "refactor.extract", "refactor.inline", "refactor.rewrite", "source", "source.organizeImports", "source.fixAll",
					}}},
					"resolveSupport": map[string]any{"properties": []string{"edit"}},
					"dataSupport":    true, "isPreferredSupport": true, "disabledSupport": true,
				},
				"publishDiagnostics": map[string]any{"relatedInformation": false, "versionSupport": true},
				"documentHighlight":  map[string]any{},
				"callHierarchy":      map[string]any{},
				"inlayHint":          map[string]any{},
				"semanticTokens": map[string]any{
					"requests":       map[string]any{"full": true, "range": false},
					"tokenTypes":     semanticTokenTypes,
					"tokenModifiers": semanticTokenModifiers,
					"formats":        []string{"relative"},
				},
			},
		},
	}
}

// goplsSettings traduce le preferenze della sessione nella configurazione gopls; i link esterni restano disattivati (local-first).
func goplsSettings(settings LanguageServerSettings) map[string]any {
	return map[string]any{
		"gofumpt":            settings.Gofumpt,
		"staticcheck":        settings.Staticcheck,
		"usePlaceholders":    settings.Placeholders,
		"completeUnimported": true,
		"hoverKind":          "FullDocumentation",
		"linksInHover":       settings.SemanticLinks,
		"semanticTokens":     true,
		// Stringhe e numeri li colora già Monaco: gopls invia solo i token che aggiungono informazione.
		"semanticTokenTypes": map[string]bool{"string": false, "number": false},
		"hints": map[string]bool{
			"parameterNames":         true,
			"functionTypeParameters": true,
		},
	}
}

type lspHandler struct {
	manager *LSPManager
	session *lspSession
	process *serverProcess
}

// HandleNotification scarta i messaggi di processi gopls non più correnti.
func (h *lspHandler) HandleNotification(method string, params json.RawMessage) {
	if !h.manager.isCurrent(h.session, h.process) {
		return
	}
	switch method {
	case "textDocument/publishDiagnostics":
		var report lsp.PublishDiagnosticsParams
		if json.Unmarshal(params, &report) == nil {
			h.manager.publishDiagnostics(h.session, report)
		}
	case "window/logMessage", "window/showMessage":
		var message LanguageServerMessage
		if json.Unmarshal(params, &message) != nil {
			return
		}
		h.manager.appendLog(h.session, message.Message)
		if method == "window/showMessage" && message.Type <= 2 {
			h.manager.publish("lsp.message", h.session.id, string(h.session.id), message)
		}
	case "$/progress":
		h.manager.publishProgress(h.session, params)
	}
}

// HandleRequest risponde alle richieste gopls necessarie; workspace/applyEdit viene catturato per l'anteprima.
func (h *lspHandler) HandleRequest(_ context.Context, method string, params json.RawMessage) (any, error) {
	switch method {
	case "workspace/configuration":
		var request struct {
			Items []json.RawMessage `json:"items"`
		}
		_ = json.Unmarshal(params, &request)
		h.session.mu.Lock()
		settings := goplsSettings(h.session.options.Settings)
		h.session.mu.Unlock()
		result := make([]any, len(request.Items))
		for index := range result {
			result[index] = settings
		}
		return result, nil
	case "window/workDoneProgress/create", "client/registerCapability", "client/unregisterCapability":
		return nil, nil
	case "workspace/workspaceFolders":
		return []map[string]any{{"uri": h.session.rootURI, "name": h.session.name}}, nil
	case "workspace/applyEdit":
		var request lsp.ApplyWorkspaceEditParams
		if err := json.Unmarshal(params, &request); err != nil {
			return map[string]any{"applied": false, "failureReason": "edit non valido"}, nil
		}
		h.session.mu.Lock()
		h.session.applyEdits = append(h.session.applyEdits, request.Edit)
		h.session.mu.Unlock()
		return map[string]any{"applied": true}, nil
	case "window/showDocument":
		return map[string]any{"success": false}, nil
	}
	return nil, lsp.ErrMethodNotFound
}

func (m *LSPManager) publishProgress(state *lspSession, params json.RawMessage) {
	var envelope struct {
		Token json.RawMessage `json:"token"`
		Value struct {
			Kind       string `json:"kind"`
			Title      string `json:"title"`
			Message    string `json:"message"`
			Percentage *int   `json:"percentage"`
		} `json:"value"`
	}
	if json.Unmarshal(params, &envelope) != nil || envelope.Value.Kind == "" {
		return
	}
	m.publish("lsp.progress", state.id, string(state.id), LanguageServerProgress{
		Token: strings.Trim(string(envelope.Token), `"`), Kind: envelope.Value.Kind, Title: envelope.Value.Title,
		Message: envelope.Value.Message, Percentage: envelope.Value.Percentage,
	})
}

func (m *LSPManager) publishDiagnostics(state *lspSession, report lsp.PublishDiagnosticsParams) {
	path := pathFromURI(report.URI)
	state.mu.Lock()
	documentID := state.byURI[report.URI]
	root := state.root
	if len(report.Diagnostics) == 0 {
		delete(state.diagnostics, report.URI)
	} else {
		state.diagnostics[report.URI] = report.Diagnostics
	}
	state.mu.Unlock()
	diagnostics := make([]EditorDiagnostic, 0, len(report.Diagnostics))
	for _, diagnostic := range report.Diagnostics {
		diagnostics = append(diagnostics, EditorDiagnostic{
			Range: editorRange(diagnostic.Range), Severity: max(1, diagnostic.Severity), Message: diagnostic.Message,
			Source: diagnostic.Source, Code: strings.Trim(string(diagnostic.Code), `"`),
		})
	}
	m.publish("lsp.diagnostics", state.id, report.URI, DiagnosticsReport{
		URI: report.URI, Path: path, RelativePath: relativeWithin(root, path), DocumentID: documentID, Diagnostics: diagnostics,
	})
}
