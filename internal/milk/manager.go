package milk

import (
	"adomnia/internal/aipolicy"
	"adomnia/internal/netpolicy"
	"adomnia/internal/procutil"

	"bufio"
	"context"
	"errors"
	"fmt"
	"io"
	"net/url"
	"os"
	"os/exec"
	"path/filepath"
	"regexp"
	"runtime"
	"strings"
	"sync"
	"time"
)

const (
	editorName = "adOmnia"
	// Due minuti coprono adapter locali lenti; l'avvio non scarica mai pacchetti.
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
	cmd        *exec.Cmd
	stdin      io.WriteCloser
	conn       *Conn
	exited     chan struct{}
	stderrDone chan struct{}
	stderrMu   sync.Mutex
	stderr     []string
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
	sessionMu     sync.Mutex
	store         *SettingsStore
	settings      Settings
	status        Status
	current       *process
	launching     bool
	stopping      bool
	crashes       int
	root          string
	sessions      map[string]string // root -> sessionId
	controls      map[string][]SessionControl
	imagePrompts  bool
	rootBySession map[string]string
	turns         map[string]string // sessionId -> token
	launchKey     string            // Launch.Key del processo in esecuzione
	pending       map[string]*permission
	log           []string
	emit          Emitter
	mcpServers    func() []MCPServer // context server condivisi, letti a ogni session/new
	turnObserver  TurnObserver
	lastUsed      time.Time // ultimo Prompt, per lo spegnimento da inattività
	idleStopped   bool      // spento da reapWhenIdle: riparte al prossimo Prompt
}

// TurnObserver è avvisato prima di ogni turno di chat; la funzione restituita viene chiamata a turno finito
// (completato, fallito o annullato). La review delle modifiche dell'agente parte da qui.
type TurnObserver interface {
	BeginTurn(root, agent string) (end func())
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
		controls:      map[string][]SessionControl{},
		rootBySession: map[string]string{},
		turns:         map[string]string{},
		pending:       map[string]*permission{},
	}
}

// SetMCPServers collega la sorgente dei context server passati a ogni nuova sessione.
func (m *Manager) SetMCPServers(source func() []MCPServer) {
	m.mu.Lock()
	m.mcpServers = source
	m.mu.Unlock()
}

// SetTurnObserver collega chi osserva l'inizio e la fine dei turni.
func (m *Manager) SetTurnObserver(observer TurnObserver) {
	m.mu.Lock()
	m.turnObserver = observer
	m.mu.Unlock()
}

func (m *Manager) beginTurn(root string) func() {
	m.mu.Lock()
	observer := m.turnObserver
	m.mu.Unlock()
	if observer == nil {
		return func() {}
	}
	return observer.BeginTurn(root, m.agent.Name)
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
	needsRestart := previous.Enabled != saved.Enabled || previous.BinaryPath != saved.BinaryPath || !equalSettingsEnvironment(previous, saved)
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

func equalSettingsEnvironment(left, right Settings) bool {
	if len(left.Env) != len(right.Env) || len(left.ExtraArgs) != len(right.ExtraArgs) {
		return false
	}
	for key, value := range left.Env {
		if right.Env[key] != value {
			return false
		}
	}
	for index := range left.ExtraArgs {
		if left.ExtraArgs[index] != right.ExtraArgs[index] {
			return false
		}
	}
	return true
}

// SetActiveWorkspace indica il progetto attivo in Code Studio.
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
	cmd := procutil.Command(command.Binary, command.Args...)
	cmd.Env = command.Env
	if cmd.Env == nil {
		cmd.Env = netpolicy.Environ()
	}
	if strings.TrimSpace(root) != "" {
		cmd.Dir = root
	}
	cmd.Env = withNativeClaude(cmd.Env)
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
	running := &process{cmd: cmd, stdin: stdin, exited: make(chan struct{}), stderrDone: make(chan struct{})}
	running.conn = NewConn(stdout, stdin, &handler{manager: m})
	go running.conn.Run()
	go m.collectStderr(running, stderr)
	m.mu.Lock()
	m.current = running
	m.lastUsed = time.Now()
	m.mu.Unlock()
	go m.watch(running)
	go m.reapWhenIdle(running)

	ctx, cancel := context.WithTimeout(context.Background(), initializeTimeout)
	defer cancel()
	var result struct {
		ProtocolVersion   int `json:"protocolVersion"`
		AgentCapabilities struct {
			PromptCapabilities struct {
				Image bool `json:"image"`
			} `json:"promptCapabilities"`
		} `json:"agentCapabilities"`
		Info struct {
			Version string `json:"version"`
		} `json:"info"`
		AgentInfo struct {
			Version string `json:"version"`
		} `json:"agentInfo"`
	}
	if err := running.conn.Call(ctx, "initialize", m.initializeParams(), &result); err != nil {
		m.abandon(running)
		m.waitStartupDrain(running)
		return errors.New(startupFailureMessage(m.agent.Name, err, running.stderrSnapshot(), running.exitCode()))
	}
	if result.Info.Version == "" {
		result.Info.Version = result.AgentInfo.Version
	}
	m.mu.Lock()
	m.crashes = 0 // un avvio riuscito azzera il backoff: contano solo i crash consecutivi
	m.imagePrompts = result.AgentCapabilities.PromptCapabilities.Image
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
	defer close(running.stderrDone)
	scanner := bufio.NewScanner(stderr)
	scanner.Buffer(make([]byte, 64*1024), 1024*1024)
	for scanner.Scan() {
		line := redactAgentText(scanner.Text())
		running.stderrMu.Lock()
		running.stderr = append(running.stderr, line)
		if len(running.stderr) > 50 {
			running.stderr = append([]string(nil), running.stderr[len(running.stderr)-50:]...)
		}
		running.stderrMu.Unlock()
		if m.isCurrent(running) {
			m.appendLog("stderr: " + line)
		}
	}
}

func (m *Manager) waitStartupDrain(running *process) {
	select {
	case <-running.exited:
	case <-time.After(stopTimeout):
		_ = terminateProcess(running.cmd)
		select {
		case <-running.exited:
		case <-time.After(stopTimeout):
		}
	}
	select {
	case <-running.stderrDone:
	case <-time.After(500 * time.Millisecond):
	}
}

func (p *process) stderrSnapshot() []string {
	p.stderrMu.Lock()
	defer p.stderrMu.Unlock()
	lines := p.stderr
	if len(lines) > 20 {
		lines = lines[len(lines)-20:]
	}
	return append([]string(nil), lines...)
}

func (p *process) exitCode() *int {
	if p.cmd.ProcessState == nil {
		return nil
	}
	code := p.cmd.ProcessState.ExitCode()
	return &code
}

var (
	secretAssignment = regexp.MustCompile(`(?i)\b(AWS_[A-Z0-9_]*|CLAUDE_CODE_USE_[A-Z0-9_]*|ANTHROPIC_[A-Z0-9_]*)\s*[:=]\s*(?:"[^"]*"|'[^']*'|[^\s,}]+)`)
	urlInMessage     = regexp.MustCompile(`https?://[^\s"']+`)
)

func redactAgentText(text string) string {
	text = secretAssignment.ReplaceAllStringFunc(text, func(match string) string {
		separator := strings.IndexAny(match, ":=")
		if separator < 0 {
			return "<redacted>"
		}
		return match[:separator+1] + "<redacted>"
	})
	return urlInMessage.ReplaceAllStringFunc(text, func(raw string) string {
		trimmed := strings.TrimRight(raw, ".,;:)")
		parsed, err := url.Parse(trimmed)
		if err != nil || parsed.Hostname() == "" {
			return "<redacted-url>"
		}
		return parsed.Scheme + "://" + parsed.Host + parsed.EscapedPath()
	})
}

// RedactAgentText removes credential-like values before diagnostics cross the Wails boundary.
func RedactAgentText(text string) string { return redactAgentText(text) }

func startupFailureMessage(agent string, cause error, stderr []string, exitCode *int) string {
	detail := strings.TrimSpace(strings.Join(stderr, "\n"))
	combined := strings.ToUpper(detail + "\n" + cause.Error())
	host := ""
	if raw := urlInMessage.FindString(detail); raw != "" {
		if parsed, err := url.Parse(strings.TrimRight(raw, ".,;:)")); err == nil {
			host = parsed.Hostname()
		}
	}
	switch {
	case strings.Contains(combined, "EMAXREDIRECT"), strings.Contains(combined, "USERCHECK"):
		where := ""
		if host != "" {
			where = " (host " + host + ")"
		}
		return "npm was redirected to a corporate proxy or captive portal" + where + ". Configure proxy and CA in Settings → Network, configure npm proxy/cafile, or install @agentclientprotocol/claude-agent-acp manually and choose its path"
	case strings.Contains(combined, "ENOTFOUND"):
		return "the agent could not resolve a network host. Check DNS and proxy settings in Settings → Network"
	case strings.Contains(combined, "ECONNREFUSED"):
		return "the agent connection was refused. Check the configured proxy and endpoint"
	case strings.Contains(combined, "SELF_SIGNED"), strings.Contains(combined, "CERT_"):
		return "the agent rejected the TLS certificate. Configure the corporate CA bundle in Settings → Network"
	}
	code := ""
	if exitCode != nil {
		code = fmt.Sprintf(" (exit code %d)", *exitCode)
	}
	if detail == "" {
		detail = "agent process is not available"
	}
	return fmt.Sprintf("%s exited during startup%s: %s", agent, code, detail)
}

// StartupFailureMessage classifies a failed child-process bootstrap for explicit installers.
func StartupFailureMessage(agent string, cause error, stderr []string, exitCode *int) string {
	return startupFailureMessage(agent, cause, stderr, exitCode)
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
	m.controls = map[string][]SessionControl{}
}

// ResetSession dimentica la sessione di una cartella: il prossimo prompt ne apre
// una nuova, senza la conversazione precedente (milk non espone session/close).
func (m *Manager) ResetSession(root string) {
	m.sessionMu.Lock()
	defer m.sessionMu.Unlock()
	m.mu.Lock()
	defer m.mu.Unlock()
	if id, ok := m.sessions[root]; ok {
		delete(m.sessions, root)
		delete(m.rootBySession, id)
		delete(m.controls, root)
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
	m.sessionMu.Lock()
	defer m.sessionMu.Unlock()
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
		SessionID     string           `json:"sessionId"`
		ConfigOptions []SessionControl `json:"configOptions"`
		Models        struct {
			CurrentModelID  string `json:"currentModelId"`
			AvailableModels []struct {
				ModelID string `json:"modelId"`
				Name    string `json:"name"`
			} `json:"availableModels"`
		} `json:"models"`
	}
	params := m.sessionParams(root)
	if err := conn.Call(ctx, "session/new", params, &result); err != nil {
		return "", fmt.Errorf("cannot open %s session for %s: %w", m.agent.Name, root, err)
	}
	if result.SessionID == "" {
		return "", errors.New("agent returned no session ID")
	}
	m.mu.Lock()
	if m.current == nil || m.current.conn != conn {
		m.mu.Unlock()
		return "", ErrClosed
	}
	m.sessions[root] = result.SessionID
	m.rootBySession[result.SessionID] = root
	options := result.ConfigOptions
	hasModel := false
	for index := range options {
		if options[index].ID == "model" && options[index].Category == "" {
			options[index].Category = "model"
		}
		if options[index].Category == "model" {
			hasModel = true
		}
	}
	if !hasModel && len(result.Models.AvailableModels) > 0 {
		model := SessionControl{ID: "_legacy_model", Name: "Model", Category: "model", Type: "select", CurrentValue: result.Models.CurrentModelID}
		for _, item := range result.Models.AvailableModels {
			model.Options = append(model.Options, ControlValue{Value: item.ModelID, Name: item.Name})
		}
		options = append(options, model)
	}
	m.controls[root] = options
	m.mu.Unlock()
	if model := result.Models.CurrentModelID; model != "" {
		m.setStatus(func(status *Status) { status.Model = model })
	}
	return result.SessionID, nil
}

// sessionParams è il payload di session/new. milk v0.7+ accepts mcpServers too
// (probe 2026-10-21); the project AI policy still filters the list.
func (m *Manager) sessionParams(root string) map[string]any {
	params := map[string]any{"cwd": root}
	if m.agent.Event == "milk" {
		params["_meta"] = map[string]any{"milk": map[string]bool{"fresh": true}}
	}
	params["mcpServers"] = m.sessionMCPServers(root)
	return params
}

func (m *Manager) sessionMCPServers(root string) []any {
	m.mu.Lock()
	source := m.mcpServers
	m.mu.Unlock()
	var servers []MCPServer
	if source != nil {
		servers = source()
	}
	servers = withBuiltinMCPServer(servers, root, m.Settings().DisableBuiltinMCP)
	// The project AI policy wins over the configured servers: "off" sends none and
	// "local-only" keeps only stdio servers, so no project data reaches the network.
	return acpMCPServers(filterMCPServersByPolicy(servers, aipolicy.Load(root)))
}

// Prompt invia un turno. I delta arrivano come evento milk.chat; cancel interrompe.
func (m *Manager) Prompt(parent context.Context, request PromptRequest) (PromptResponse, error) {
	blocks, err := m.promptBlocks(request)
	if err != nil {
		return PromptResponse{}, err
	}
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
	if !aipolicy.Allows(aipolicy.Load(root), m.agent.Event == "opencode") {
		return PromptResponse{}, errors.New("project AI policy blocks this agent")
	}
	if err := m.wakeIfIdle(); err != nil {
		return PromptResponse{}, err
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
	endTurn := m.beginTurn(root)
	defer endTurn()
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
		"prompt":    blocks,
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
