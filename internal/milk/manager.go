package milk

import (
	"adomnia/internal/netpolicy"

	"bufio"
	"context"
	"errors"
	"fmt"
	"io"
	"os"
	"os/exec"
	"path/filepath"
	"runtime"
	"strings"
	"sync"
	"time"
)

const (
	editorName = "adOmnia"
	// ponytail: 2 minuti perché il primo `npx` di Claude Code scarica l'adapter.
	initializeTimeout   = 2 * time.Minute
	sessionTimeout      = 15 * time.Second
	promptTimeout       = 10 * time.Minute
	permissionTimeout   = 90 * time.Second
	stopTimeout         = 2 * time.Second
	maxLogLines         = 400
	maxPromptBytes      = 256 * 1024
	checkStatusDebounce = 500 * time.Millisecond
	installTimeout      = 10 * time.Minute
)

// ErrNotInstalled indica che il binario milk non è stato trovato nel PATH.
var ErrNotInstalled = errors.New("milk is not installed; install it or set its path in milk settings")

// restartBackoff è l'attesa prima di ogni riavvio automatico.
var restartBackoff = []time.Duration{time.Second, 2 * time.Second, 5 * time.Second, 10 * time.Second}

// Emitter pubblica gli eventi verso il frontend (milk.status, milk.chat, milk.permission).
type Emitter func(event string, payload any)

type process struct {
	cmd    *exec.Cmd
	stdin  io.WriteCloser
	conn   *Conn
	exited chan struct{}
}

// permission è una richiesta di autorizzazione in attesa di risposta.
type permission struct {
	ch chan bool
}

// Manager possiede il processo di un agente ACP (milk, Claude Code): avvio, handshake,
// sessioni per progetto, turni di chat, autorizzazioni e riavvio con backoff.
type Manager struct {
	agent         Agent
	mu            sync.Mutex
	store         *SettingsStore
	settings      Settings
	status        Status
	current       *process
	launching     bool
	stopping      bool
	crashes       int
	root          string
	sessions      map[string]string // root -> sessionId
	rootBySession map[string]string
	turns         map[string]string // sessionId -> token
	launchKey     string            // Launch.Key del processo in esecuzione
	pending       map[string]*permission
	log           []string
	emit          Emitter
}

// NewManager crea il manager di milk; il processo parte solo con Start.
func NewManager(store *SettingsStore) *Manager {
	return NewAgentManager(store, MilkAgent())
}

// NewAgentManager crea il manager di un agente ACP qualsiasi.
func NewAgentManager(store *SettingsStore, agent Agent) *Manager {
	settings := store.Load()
	return &Manager{
		agent:         agent,
		store:         store,
		settings:      settings,
		status:        Status{State: StateDisabled},
		sessions:      map[string]string{},
		rootBySession: map[string]string{},
		turns:         map[string]string{},
		pending:       map[string]*permission{},
	}
}

func (m *Manager) SetEmitter(emit Emitter) {
	m.mu.Lock()
	m.emit = emit
	m.mu.Unlock()
}

func (m *Manager) Settings() Settings {
	m.mu.Lock()
	defer m.mu.Unlock()
	return m.settings
}

func (m *Manager) Status() Status {
	m.mu.Lock()
	defer m.mu.Unlock()
	return m.status
}

func (m *Manager) Log() []string {
	m.mu.Lock()
	defer m.mu.Unlock()
	return append([]string(nil), m.log...)
}

func (m *Manager) skipPermissions() bool {
	m.mu.Lock()
	defer m.mu.Unlock()
	return m.settings.SkipPermissions
}

// SaveSettings salva e applica: l'attivazione o il cambio di binario riavviano il processo.
func (m *Manager) SaveSettings(next Settings) (Settings, error) {
	saved, err := m.store.Save(next)
	if err != nil {
		return Settings{}, err
	}
	m.mu.Lock()
	previous := m.settings
	m.settings = saved
	m.mu.Unlock()
	needsRestart := previous.Enabled != saved.Enabled || previous.BinaryPath != saved.BinaryPath
	switch {
	case !saved.Enabled:
		m.Stop()
		m.setStatus(func(status *Status) { status.State = StateDisabled; status.Message = "" })
	case !previous.Enabled || needsRestart:
		m.Stop()
		go func() { _ = m.Start() }()
	default:
		m.publishStatus()
	}
	return saved, nil
}

// SetActiveWorkspace indica il progetto attivo in Go Studio.
func (m *Manager) SetActiveWorkspace(root string) {
	m.mu.Lock()
	m.root = root
	enabled := m.settings.Enabled
	running := m.current != nil || m.launching
	m.mu.Unlock()
	// Le sessioni del vecchio root restano valide; il nuovo ne apre una al primo prompt.
	if enabled && root != "" && !running {
		go func() { _ = m.Start() }()
		return
	}
	if enabled && running && m.needsRelaunch(root) {
		go func() { _ = m.Restart() }()
	}
}

// needsRelaunch dice se il progetto root richiede un processo avviato diversamente
// (es. Claude Code con un altro ANTHROPIC_MODEL nei settings del progetto).
func (m *Manager) needsRelaunch(root string) bool {
	m.mu.Lock()
	settings, key := m.settings, m.launchKey
	m.mu.Unlock()
	if !m.agent.ProjectScoped {
		return false
	}
	// ponytail: il riavvio interrompe un turno in corso in un altro progetto; capita solo se i progetti chiedono modelli diversi.
	command, err := m.agent.Resolve(settings, root)
	return err == nil && command.Key != key
}

// Start avvia il processo se milk è attivo e non già in esecuzione.
func (m *Manager) Start() error {
	m.mu.Lock()
	if !m.settings.Enabled {
		m.mu.Unlock()
		m.setStatus(func(status *Status) { status.State = StateDisabled })
		return nil
	}
	if m.current != nil || m.launching {
		m.mu.Unlock()
		return nil
	}
	m.launching = true
	m.stopping = false
	settings := m.settings
	root := m.root
	m.mu.Unlock()
	defer func() { m.mu.Lock(); m.launching = false; m.mu.Unlock() }()

	command, err := m.agent.Resolve(settings, root)
	if err != nil {
		state := StateError
		switch {
		case errors.Is(err, ErrNotInstalled):
			state = StateNotInstalled
		case errors.Is(err, ErrOutdated):
			state = StateOutdated
		}
		m.setStatus(func(status *Status) {
			status.State = state
			status.Message = err.Error()
			status.Binary = command.Binary
			status.Version = command.Version
		})
		return err
	}
	m.setStatus(func(status *Status) {
		status.State = StateStarting
		status.Message = ""
		status.Backend, status.Model = "", "" // li riannuncia il nuovo processo
		status.Binary = command.Binary
		status.Version = command.Version
	})
	if err := m.launch(command, root); err != nil {
		m.appendLog("start failed: " + err.Error())
		m.setStatus(func(status *Status) { status.State = StateError; status.Message = err.Error() })
		return err
	}
	return nil
}

func resolveBinary(settings Settings) (string, error) {
	if settings.BinaryPath != "" {
		if isExecutableFile(settings.BinaryPath) {
			return settings.BinaryPath, nil
		}
		return "", fmt.Errorf("milk binary not found at %s", settings.BinaryPath)
	}
	if path, err := exec.LookPath("milk"); err == nil {
		return path, nil
	}
	for _, candidate := range defaultBinaryCandidates() {
		if isExecutableFile(candidate) {
			return candidate, nil
		}
	}
	return "", ErrNotInstalled
}

// defaultBinaryCandidates elenca le posizioni note di installazione di milk:
// %LOCALAPPDATA%\milk\bin (install.ps1) e ~/.local/bin (install.sh).
func defaultBinaryCandidates() []string {
	var candidates []string
	if localAppData := strings.TrimSpace(os.Getenv("LOCALAPPDATA")); localAppData != "" {
		candidates = append(candidates, filepath.Join(localAppData, "milk", "bin", "milk"))
	}
	if home, err := os.UserHomeDir(); err == nil && home != "" {
		candidates = append(candidates, filepath.Join(home, ".local", "bin", "milk"))
	}
	if runtime.GOOS == "windows" {
		withExe := make([]string, 0, len(candidates)*2)
		for _, candidate := range candidates {
			withExe = append(withExe, candidate, candidate+".exe")
		}
		return withExe
	}
	return candidates
}

func isExecutableFile(path string) bool {
	info, err := os.Stat(path)
	return err == nil && !info.IsDir()
}

func (m *Manager) launch(command Launch, root string) error {
	m.mu.Lock()
	m.launchKey = command.Key
	m.mu.Unlock()
	cmd := exec.Command(command.Binary, command.Args...)
	cmd.Env = command.Env
	if cmd.Env == nil {
		cmd.Env = os.Environ()
	}
	if strings.TrimSpace(root) != "" {
		cmd.Dir = root
	}
	configureProcess(cmd)
	stdin, err := cmd.StdinPipe()
	if err != nil {
		return err
	}
	stdout, err := cmd.StdoutPipe()
	if err != nil {
		return err
	}
	stderr, err := cmd.StderrPipe()
	if err != nil {
		return err
	}
	if err := cmd.Start(); err != nil {
		return fmt.Errorf("cannot start %s: %w", m.agent.Name, err)
	}
	running := &process{cmd: cmd, stdin: stdin, exited: make(chan struct{})}
	running.conn = NewConn(stdout, stdin, &handler{manager: m})
	go running.conn.Run()
	go m.collectStderr(running, stderr)
	m.mu.Lock()
	m.current = running
	m.mu.Unlock()
	go m.watch(running)

	ctx, cancel := context.WithTimeout(context.Background(), initializeTimeout)
	defer cancel()
	var result struct {
		ProtocolVersion int `json:"protocolVersion"`
		Info            struct {
			Version string `json:"version"`
		} `json:"info"`
		AgentInfo struct {
			Version string `json:"version"`
		} `json:"agentInfo"`
	}
	if err := running.conn.Call(ctx, "initialize", m.initializeParams(), &result); err != nil {
		m.abandon(running)
		return fmt.Errorf("%s did not initialize: %w", m.agent.Name, err)
	}
	if result.Info.Version == "" {
		result.Info.Version = result.AgentInfo.Version
	}
	m.mu.Lock()
	m.crashes = 0 // un avvio riuscito azzera il backoff: contano solo i crash consecutivi
	m.mu.Unlock()
	m.setStatus(func(status *Status) {
		status.State = StateReady
		status.Message = ""
		if result.Info.Version != "" {
			status.Version = result.Info.Version
		}
	})
	return nil
}

func (m *Manager) collectStderr(running *process, stderr io.Reader) {
	scanner := bufio.NewScanner(stderr)
	scanner.Buffer(make([]byte, 64*1024), 1024*1024)
	for scanner.Scan() {
		if m.isCurrent(running) {
			m.appendLog("stderr: " + scanner.Text())
		}
	}
}

func (m *Manager) watch(running *process) {
	err := running.cmd.Wait()
	defer close(running.exited)
	m.mu.Lock()
	if m.current != running {
		m.mu.Unlock()
		return
	}
	m.current = nil
	m.forgetSessionsLocked()
	stopping := m.stopping
	m.mu.Unlock()
	if stopping {
		return
	}
	reason := m.agent.Name + " process exited"
	if err != nil {
		reason = fmt.Sprintf("%s: %v", reason, err)
	}
	m.appendLog(reason)
	m.handleCrash(reason)
}

func (m *Manager) handleCrash(reason string) {
	m.mu.Lock()
	attempt := m.crashes
	m.crashes++
	m.status.Restarts++
	m.mu.Unlock()
	if attempt >= len(restartBackoff) {
		m.setStatus(func(status *Status) {
			status.State = StateError
			status.Message = m.agent.Name + " temporarily disabled after repeated crashes. Restart it."
		})
		return
	}
	m.setStatus(func(status *Status) { status.State = StateStarting; status.Message = reason + "; restarting" })
	go func() {
		time.Sleep(restartBackoff[attempt])
		m.mu.Lock()
		cancelled := m.stopping || m.current != nil || !m.settings.Enabled
		m.mu.Unlock()
		if !cancelled {
			_ = m.Start()
		}
	}()
}

func (m *Manager) Restart() error {
	m.Stop()
	m.mu.Lock()
	m.crashes = 0
	m.mu.Unlock()
	return m.Start()
}

func (m *Manager) Stop() {
	m.mu.Lock()
	m.stopping = true
	running := m.current
	m.mu.Unlock()
	if running == nil {
		return
	}
	_ = running.stdin.Close()
	select {
	case <-running.exited:
	case <-time.After(stopTimeout):
		_ = terminateProcess(running.cmd)
		<-running.exited
	}
	m.mu.Lock()
	if m.current == running {
		m.current = nil
		m.forgetSessionsLocked()
	}
	m.mu.Unlock()
}

func (m *Manager) abandon(running *process) {
	m.mu.Lock()
	if m.current == running {
		m.current = nil
		m.forgetSessionsLocked()
	}
	m.mu.Unlock()
	_ = running.stdin.Close()
	_ = terminateProcess(running.cmd)
}

// forgetSessionsLocked scarta le sessioni: appartengono al processo milk che le
// ha create e un nuovo processo non le conosce. Il chiamante tiene m.mu.
func (m *Manager) forgetSessionsLocked() {
	m.sessions = map[string]string{}
	m.rootBySession = map[string]string{}
}

// ResetSession dimentica la sessione di una cartella: il prossimo prompt ne apre
// una nuova, senza la conversazione precedente (milk non espone session/close).
func (m *Manager) ResetSession(root string) {
	m.mu.Lock()
	defer m.mu.Unlock()
	if id, ok := m.sessions[root]; ok {
		delete(m.sessions, root)
		delete(m.rootBySession, id)
	}
}

func (m *Manager) isCurrent(running *process) bool {
	m.mu.Lock()
	defer m.mu.Unlock()
	return m.current == running
}

func (m *Manager) connection() (*Conn, error) {
	m.mu.Lock()
	defer m.mu.Unlock()
	if m.current == nil {
		return nil, ErrClosed
	}
	return m.current.conn, nil
}

// sessionFor restituisce (creandola al primo uso) la sessione milk per una cartella.
func (m *Manager) sessionFor(root string) (string, error) {
	m.mu.Lock()
	if id, ok := m.sessions[root]; ok && id != "" {
		m.mu.Unlock()
		return id, nil
	}
	m.mu.Unlock()
	conn, err := m.connection()
	if err != nil {
		return "", err
	}
	ctx, cancel := context.WithTimeout(context.Background(), sessionTimeout)
	defer cancel()
	var result struct {
		SessionID string `json:"sessionId"`
		Models    struct {
			CurrentModelID string `json:"currentModelId"`
		} `json:"models"`
	}
	params := map[string]any{"cwd": root}
	if m.agent.Protocol == 1 {
		params["mcpServers"] = []any{}
	}
	if err := conn.Call(ctx, "session/new", params, &result); err != nil {
		return "", fmt.Errorf("cannot open %s session for %s: %w", m.agent.Name, root, err)
	}
	m.mu.Lock()
	m.sessions[root] = result.SessionID
	m.rootBySession[result.SessionID] = root
	m.mu.Unlock()
	if model := result.Models.CurrentModelID; model != "" {
		m.setStatus(func(status *Status) { status.Model = model })
	}
	return result.SessionID, nil
}

// Prompt invia un turno. I delta arrivano come evento milk.chat; cancel interrompe.
func (m *Manager) Prompt(parent context.Context, request PromptRequest) (PromptResponse, error) {
	request.Token = strings.TrimSpace(request.Token)
	request.Message = strings.TrimSpace(request.Message)
	if request.Token == "" || request.Message == "" {
		return PromptResponse{}, errors.New("prompt token and message are required")
	}
	if len(request.Message) > maxPromptBytes {
		return PromptResponse{}, fmt.Errorf("prompt exceeds %d KiB", maxPromptBytes/1024)
	}
	root := strings.TrimSpace(request.Root)
	if root == "" {
		m.mu.Lock()
		root = m.root
		m.mu.Unlock()
	}
	if m.Status().State != StateReady {
		return PromptResponse{}, fmt.Errorf("%s is not ready; enable it in its settings", m.agent.Name)
	}
	sessionID, err := m.sessionFor(root)
	if err != nil {
		return PromptResponse{}, err
	}

	m.mu.Lock()
	if existing, ok := m.turns[sessionID]; ok && existing != "" {
		m.mu.Unlock()
		return PromptResponse{}, fmt.Errorf("a %s turn is already running for this project", m.agent.Name)
	}
	m.turns[sessionID] = request.Token
	m.mu.Unlock()
	defer func() {
		m.mu.Lock()
		delete(m.turns, sessionID)
		m.mu.Unlock()
	}()

	conn, err := m.connection()
	if err != nil {
		return PromptResponse{}, err
	}
	ctx, cancel := context.WithTimeout(parent, promptTimeout)
	defer cancel()
	var result struct {
		MessageID  string `json:"messageId"`
		StopReason string `json:"stopReason"`
	}
	standard := m.agent.Protocol == 1
	if standard {
		// ACP v1 non ha state_update: inizio e fine del turno sono la richiesta e la sua risposta.
		m.publishChat(ChatEvent{Token: request.Token, Root: root, SessionID: sessionID, Kind: "begin"})
	}
	if err := conn.Call(ctx, "session/prompt", map[string]any{
		"sessionId": sessionID,
		"prompt":    []map[string]string{{"type": "text", "text": request.Message}},
	}, &result); err != nil {
		if ctx.Err() != nil {
			// Il turno continuerebbe in milk anche se nessuno aspetta più la risposta.
			_ = conn.Notify("session/cancel", map[string]any{"sessionId": sessionID})
		}
		return PromptResponse{}, err
	}
	if standard {
		m.publishChat(ChatEvent{Token: request.Token, Root: root, SessionID: sessionID, Kind: "end", StopReason: result.StopReason})
	}
	return PromptResponse{Token: request.Token, MessageID: result.MessageID}, nil
}

// CancelSession interrompe il turno in corso su una sessione.
func (m *Manager) CancelSession(sessionID string) {
	conn, err := m.connection()
	if err != nil {
		return
	}
	_ = conn.Notify("session/cancel", map[string]any{"sessionId": sessionID})
}

// CancelPrompt interrompe il turno individuando la sessione dal token.
func (m *Manager) CancelPrompt(token string) {
	m.mu.Lock()
	sessionID := ""
	for sid, tok := range m.turns {
		if tok == token {
			sessionID = sid
			break
		}
	}
	m.mu.Unlock()
	if sessionID == "" {
		return
	}
	m.CancelSession(sessionID)
}

// RespondPermission risponde a una richiesta di autorizzazione in attesa.
func (m *Manager) RespondPermission(requestID string, allow bool) {
	m.mu.Lock()
	perm := m.pending[requestID]
	delete(m.pending, requestID)
	m.mu.Unlock()
	if perm != nil {
		select {
		case perm.ch <- allow:
		default:
		}
	}
}

// Install scarica l'ultima release di milk dal repo upstream (SHA-256 verificato)
// nella cartella degli installer ufficiali, attiva milk e lo avvia. Se un altro
// milk avrebbe la precedenza (es. uno vecchio nel PATH), salva il percorso nuovo.
func (m *Manager) Install(ctx context.Context) (Status, error) {
	m.mu.Lock()
	if m.status.State == StateInstalling {
		m.mu.Unlock()
		return m.Status(), errors.New("milk is already being installed")
	}
	m.mu.Unlock()
	destination, err := DefaultInstallPath()
	if err != nil {
		return m.Status(), err
	}
	m.Stop() // Windows non sostituisce un .exe in esecuzione
	report := func(message string) {
		m.setStatus(func(status *Status) { status.State = StateInstalling; status.Message = message })
	}
	report("Preparing…")
	client := netpolicy.Client("milk", installTimeout)
	tag, err := installRelease(ctx, client, destination, report)
	if err != nil {
		m.appendLog("install failed: " + err.Error())
		m.setStatus(func(status *Status) { status.State = StateError; status.Message = err.Error() })
		return m.Status(), err
	}
	m.appendLog("installed milk " + tag + " at " + destination)

	settings := m.Settings()
	settings.Enabled = true
	if resolved, err := resolveBinary(settings); err != nil || !samePath(resolved, destination) {
		settings.BinaryPath = destination
	}
	m.mu.Lock()
	m.crashes = 0
	m.mu.Unlock()
	if _, err := m.SaveSettings(settings); err != nil {
		return m.Status(), err
	}
	if err := m.Start(); err != nil {
		return m.Status(), err
	}
	return m.Status(), nil
}

func samePath(a, b string) bool {
	return strings.EqualFold(filepath.Clean(a), filepath.Clean(b))
}

// Shutdown arresta il processo alla chiusura dell'app.
func (m *Manager) Shutdown() {
	m.Stop()
}

func (m *Manager) setStatus(update func(*Status)) {
	m.mu.Lock()
	update(&m.status)
	m.status.Running = m.status.State == StateReady && m.current != nil
	m.mu.Unlock()
	m.publishStatus()
}

func (m *Manager) publishStatus() {
	m.publish("status", m.Status())
}

func (m *Manager) publishChat(event ChatEvent) {
	m.publish("chat", event)
}

// publish emette <agent.Event>.<event> (milk.chat, claude.chat, …).
func (m *Manager) publish(event string, payload any) {
	m.mu.Lock()
	emit := m.emit
	m.mu.Unlock()
	if emit != nil {
		emit(m.agent.Event+"."+event, payload)
	}
}

// initializeParams è l'handshake nel dialetto dell'agente.
func (m *Manager) initializeParams() map[string]any {
	if m.agent.Protocol == 1 {
		// Niente fs/terminal lato client: l'agente usa i suoi tool e chiede i permessi.
		return map[string]any{
			"protocolVersion":    1,
			"clientInfo":         map[string]string{"name": editorName},
			"clientCapabilities": map[string]any{"fs": map[string]bool{"readTextFile": false, "writeTextFile": false}, "terminal": false},
		}
	}
	return map[string]any{
		"protocolVersion": 2,
		"info":            map[string]string{"name": editorName},
		"capabilities":    map[string]any{},
	}
}

func (m *Manager) appendLog(line string) {
	stamped := time.Now().Format("15:04:05.000") + " " + strings.TrimRight(line, "\r\n")
	m.mu.Lock()
	m.log = append(m.log, stamped)
	if overflow := len(m.log) - maxLogLines; overflow > 0 {
		m.log = append([]string(nil), m.log[overflow:]...)
	}
	m.mu.Unlock()
}
