package copilot

import (
	"bufio"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/url"
	"os"
	"os/exec"
	"strings"
	"sync"
	"time"

	"adomnia/internal/goide/lsp"
)

// State è lo stato dell'integrazione mostrato nella status bar.
type State string

const (
	StateDisabled     State = "disabled"
	StateNotInstalled State = "not-installed"
	StateInstalling   State = "installing"
	StateStarting     State = "starting"
	StateSignedOut    State = "signed-out"
	StateReady        State = "ready"
	StateWarning      State = "warning"
	StateUnauthorized State = "unauthorized"
	StateError        State = "error"
)

const (
	editorName          = "adOmnia"
	pluginName          = "gO Studio Copilot"
	pluginVersion       = "0.1.0"
	initializeTimeout   = 60 * time.Second
	requestTimeout      = 20 * time.Second
	signInTimeout       = 15 * time.Minute
	stopTimeout         = 2 * time.Second
	maxLogLines         = 400
	maxDocumentBytes    = 2 << 20
	checkStatusDebounce = 500 * time.Millisecond
)

// restartBackoff è l'attesa prima di ogni riavvio automatico; esauriti i tentativi Copilot si sospende.
var restartBackoff = []time.Duration{time.Second, 2 * time.Second, 5 * time.Second, 10 * time.Second}

// Status è lo stato pubblicato al frontend. Contiene sempre il profilo, così l'host è visibile.
type Status struct {
	State            State         `json:"state"`
	Message          string        `json:"message,omitempty"`
	Busy             bool          `json:"busy"`
	User             string        `json:"user,omitempty"`
	Profile          GitHubProfile `json:"profile"`
	Binary           ServerBinary  `json:"binary"`
	ServerVersion    string        `json:"serverVersion,omitempty"`
	InlineCompletion bool          `json:"inlineCompletion"`
	Restarts         int           `json:"restarts"`
}

// SignInPrompt è il codice del device flow da mostrare all'utente.
type SignInPrompt struct {
	Status          string `json:"status"`
	UserCode        string `json:"userCode,omitempty"`
	VerificationURI string `json:"verificationUri,omitempty"`
	User            string `json:"user,omitempty"`
	Host            string `json:"host"`
}

// Message è un avviso del Language Server (account, quota, licenza) da mostrare all'utente.
type Message struct {
	Type    int      `json:"type"`
	Message string   `json:"message"`
	Actions []string `json:"actions,omitempty"`
}

// Emitter pubblica gli eventi verso il frontend (copilot.status, copilot.install, copilot.message).
type Emitter func(event string, payload any)

type command struct {
	Title     string            `json:"title,omitempty"`
	Command   string            `json:"command"`
	Arguments []json.RawMessage `json:"arguments,omitempty"`
}

type process struct {
	cmd    *exec.Cmd
	stdin  io.WriteCloser
	conn   *lsp.Conn
	exited chan struct{}
}

type document struct {
	uri        string
	root       string
	languageID string
	version    int
	text       string
}

// Manager possiede il processo del Copilot Language Server: avvio, configurazione enterprise,
// login, sincronizzazione documenti, completamento e riavvio con backoff. gO Studio funziona
// normalmente anche se Copilot è spento o in errore.
type Manager struct {
	mu         sync.Mutex
	store      *SettingsStore
	installer  *Installer
	settings   Settings
	profile    GitHubProfile
	status     Status
	current    *process
	launching  bool
	stopping   bool
	crashes    int
	documents  map[string]*document
	byID       map[string]string
	folders    map[string]string
	root       string
	log        []string
	emit       Emitter
	openURL    func(string) error
	checkTimer *time.Timer
}

// NewManager legge le impostazioni; il processo parte solo con Start.
func NewManager(store *SettingsStore, installer *Installer) *Manager {
	settings := store.Load()
	manager := &Manager{
		store: store, installer: installer, settings: settings,
		documents: map[string]*document{}, byID: map[string]string{}, folders: map[string]string{},
	}
	manager.profile = settings.ProfileForWorkspace("")
	manager.status = Status{State: StateDisabled, Profile: manager.profile, InlineCompletion: settings.InlineCompletion}
	return manager
}

// SetEmitter collega gli eventi al frontend.
func (m *Manager) SetEmitter(emit Emitter) {
	m.mu.Lock()
	m.emit = emit
	m.mu.Unlock()
}

// SetURLOpener apre nel browser di sistema le pagine richieste dal Language Server (login).
func (m *Manager) SetURLOpener(open func(string) error) {
	m.mu.Lock()
	m.openURL = open
	m.mu.Unlock()
}

// Settings restituisce la configurazione corrente.
func (m *Manager) Settings() Settings {
	m.mu.Lock()
	defer m.mu.Unlock()
	return m.settings
}

// Status restituisce lo stato corrente.
func (m *Manager) Status() Status {
	m.mu.Lock()
	defer m.mu.Unlock()
	return m.status
}

// Log restituisce le ultime righe di log del Language Server, senza segreti (il server non logga token).
func (m *Manager) Log() []string {
	m.mu.Lock()
	defer m.mu.Unlock()
	return append([]string(nil), m.log...)
}

// SaveSettings salva e applica: cambio di profilo, proxy, CA o binario riavviano il server.
func (m *Manager) SaveSettings(next Settings) (Settings, error) {
	saved, err := m.store.Save(next)
	if err != nil {
		return Settings{}, err
	}
	m.mu.Lock()
	previous := m.settings
	m.settings = saved
	root := m.root
	m.status.InlineCompletion = saved.InlineCompletion
	m.mu.Unlock()
	needsRestart := previous.Proxy != saved.Proxy || previous.CABundlePath != saved.CABundlePath || previous.BinaryPath != saved.BinaryPath ||
		previous.ProfileForWorkspace(root) != saved.ProfileForWorkspace(root)
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

// SetActiveWorkspace indica il progetto attivo in Go Studio: se è legato a un altro profilo GitHub il
// server riparte su quell'account, così il codice aziendale non usa l'account personale.
func (m *Manager) SetActiveWorkspace(root string) {
	m.mu.Lock()
	m.root = root
	next := m.settings.ProfileForWorkspace(root)
	changed := next != m.profile
	enabled := m.settings.Enabled
	m.mu.Unlock()
	if changed && enabled {
		m.Stop()
		go func() { _ = m.Start() }()
	}
}

// Start avvia il server se Copilot è attivo e non già in esecuzione.
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
	m.profile = m.settings.ProfileForWorkspace(m.root)
	settings := m.settings
	profile := m.profile
	m.mu.Unlock()
	defer func() { m.mu.Lock(); m.launching = false; m.mu.Unlock() }()

	binary, err := m.installer.Resolve(settings)
	if err != nil {
		state := StateError
		if errors.Is(err, ErrServerNotInstalled) {
			state = StateNotInstalled
		}
		m.setStatus(func(status *Status) { status.State = state; status.Message = err.Error(); status.Profile = profile })
		return err
	}
	m.setStatus(func(status *Status) {
		status.State = StateStarting
		status.Message = ""
		status.Binary = binary
		status.Profile = profile
		status.User = ""
	})
	if err := m.launch(binary, settings, profile); err != nil {
		m.appendLog("start failed: " + err.Error())
		m.setStatus(func(status *Status) { status.State = StateError; status.Message = err.Error() })
		return err
	}
	return nil
}

func (m *Manager) launch(binary ServerBinary, settings Settings, profile GitHubProfile) error {
	cmd := exec.Command(binary.Path, "--stdio")
	cmd.Env = serverEnvironment(settings)
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
		return fmt.Errorf("cannot start the Copilot language server: %w", err)
	}
	running := &process{cmd: cmd, stdin: stdin, exited: make(chan struct{})}
	running.conn = lsp.NewConn(stdout, stdin, &handler{manager: m, process: running})
	go running.conn.Run()
	go m.collectStderr(running, stderr)
	m.mu.Lock()
	m.current = running
	folders := m.workspaceFoldersLocked()
	m.mu.Unlock()
	go m.watch(running)

	ctx, cancel := context.WithTimeout(context.Background(), initializeTimeout)
	defer cancel()
	var result struct {
		ServerInfo struct {
			Version string `json:"version"`
		} `json:"serverInfo"`
	}
	if err := running.conn.Call(ctx, "initialize", initializeParams(folders), &result); err != nil {
		m.abandon(running)
		return fmt.Errorf("Copilot language server did not initialize: %w", err)
	}
	if err := running.conn.Notify("initialized", map[string]any{}); err != nil {
		m.abandon(running)
		return err
	}
	_ = running.conn.Notify("workspace/didChangeConfiguration", map[string]any{"settings": serverConfiguration(settings, profile)})
	m.setStatus(func(status *Status) { status.ServerVersion = result.ServerInfo.Version })
	m.reopenDocuments(running)
	m.scheduleCheckStatus()
	return nil
}

// serverEnvironment eredita l'ambiente e aggiunge il CA aziendale ai certificati di sistema.
func serverEnvironment(settings Settings) []string {
	environment := os.Environ()
	if settings.CABundlePath != "" {
		environment = append(environment, "NODE_EXTRA_CA_CERTS="+settings.CABundlePath)
	}
	return environment
}

func initializeParams(folders []map[string]string) map[string]any {
	return map[string]any{
		"processId":        os.Getpid(),
		"clientInfo":       map[string]string{"name": editorName},
		"workspaceFolders": folders,
		"capabilities": map[string]any{
			"workspace": map[string]any{"workspaceFolders": true, "configuration": true},
			"window":    map[string]any{"showDocument": map[string]bool{"support": true}},
		},
		"initializationOptions": map[string]any{
			"editorInfo":       map[string]string{"name": editorName, "version": pluginVersion},
			"editorPluginInfo": map[string]string{"name": pluginName, "version": pluginVersion},
		},
	}
}

// serverConfiguration deriva sempre host e rete dal profilo: nessun github.com cablato.
func serverConfiguration(settings Settings, profile GitHubProfile) map[string]any {
	configuration := map[string]any{
		"http": map[string]any{"proxy": settings.Proxy.URL, "proxyStrictSSL": settings.Proxy.StrictSSL},
		// adOmnia non ha telemetria; chiediamo lo stesso al server. La comunicazione con GitHub per
		// il completamento resta attiva, come spiegato nella UI.
		"telemetry": map[string]any{"telemetryLevel": "off"},
	}
	if uri := profile.EnterpriseURI(); uri != "" {
		configuration["github-enterprise"] = map[string]any{"uri": uri}
	}
	return configuration
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
	stopping := m.stopping
	m.mu.Unlock()
	if stopping {
		return
	}
	reason := "Copilot language server exited"
	if err != nil {
		reason = fmt.Sprintf("%s: %v", reason, err)
	}
	m.appendLog(reason)
	m.handleCrash(reason)
}

// handleCrash riavvia con backoff 1s, 2s, 5s, 10s; poi sospende Copilot finché l'utente non lo riavvia.
func (m *Manager) handleCrash(reason string) {
	m.mu.Lock()
	attempt := m.crashes
	m.crashes++
	m.status.Restarts++
	m.mu.Unlock()
	if attempt >= len(restartBackoff) {
		m.setStatus(func(status *Status) {
			status.State = StateError
			status.Message = "Copilot temporarily disabled after repeated crashes. Restart it or show the logs."
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

// Restart riparte da zero azzerando il contatore dei crash.
func (m *Manager) Restart() error {
	m.Stop()
	m.mu.Lock()
	m.crashes = 0
	m.mu.Unlock()
	return m.Start()
}

// Stop chiude il server con shutdown/exit e termina il processo se non risponde: niente zombie.
func (m *Manager) Stop() {
	m.mu.Lock()
	m.stopping = true
	running := m.current
	if m.checkTimer != nil {
		m.checkTimer.Stop()
	}
	m.mu.Unlock()
	if running == nil {
		return
	}
	ctx, cancel := context.WithTimeout(context.Background(), stopTimeout)
	_ = running.conn.Call(ctx, "shutdown", nil, nil)
	cancel()
	_ = running.conn.Notify("exit", nil)
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
	}
	m.mu.Unlock()
}

func (m *Manager) abandon(running *process) {
	m.mu.Lock()
	if m.current == running {
		m.current = nil
	}
	m.mu.Unlock()
	_ = running.stdin.Close()
	_ = terminateProcess(running.cmd)
}

func (m *Manager) isCurrent(running *process) bool {
	m.mu.Lock()
	defer m.mu.Unlock()
	return m.current == running
}

// connection restituisce la connessione attiva o un errore leggibile.
func (m *Manager) connection() (*lsp.Conn, error) {
	m.mu.Lock()
	defer m.mu.Unlock()
	if m.current == nil {
		return nil, errors.New("GitHub Copilot is not running")
	}
	return m.current.conn, nil
}

// Install scarica il Language Server ufficiale e lo avvia se Copilot è attivo.
func (m *Manager) Install(ctx context.Context) (ServerBinary, error) {
	settings := m.Settings()
	m.setStatus(func(status *Status) { status.State = StateInstalling; status.Message = "" })
	binary, err := m.installer.Install(ctx, settings, func(progress InstallProgress) { m.publish("copilot.install", progress) })
	if err != nil {
		m.setStatus(func(status *Status) { status.State = StateNotInstalled; status.Message = err.Error() })
		return ServerBinary{}, err
	}
	m.setStatus(func(status *Status) { status.Binary = binary; status.State = StateDisabled; status.Message = "" })
	if settings.Enabled {
		go func() { _ = m.Restart() }()
	}
	return binary, nil
}

// SignIn avvia il device flow sull'host del profilo attivo.
func (m *Manager) SignIn(ctx context.Context) (SignInPrompt, error) {
	conn, err := m.connection()
	if err != nil {
		return SignInPrompt{}, err
	}
	var result struct {
		Status          string   `json:"status"`
		UserCode        string   `json:"userCode"`
		VerificationURI string   `json:"verificationUri"`
		User            string   `json:"user"`
		Command         *command `json:"command"`
	}
	callCtx, cancel := context.WithTimeout(ctx, requestTimeout)
	defer cancel()
	if err := conn.Call(callCtx, "signIn", map[string]any{}, &result); err != nil {
		return SignInPrompt{}, friendlyError(err, m.Status().Profile)
	}
	prompt := SignInPrompt{Status: result.Status, UserCode: result.UserCode, VerificationURI: result.VerificationURI, User: result.User, Host: m.Status().Profile.Host}
	if result.Command != nil && result.UserCode != "" {
		go m.finishDeviceFlow(conn, *result.Command)
	} else {
		m.scheduleCheckStatus()
	}
	return prompt, nil
}

// finishDeviceFlow esegue il comando del server che apre il browser e attende l'autorizzazione.
func (m *Manager) finishDeviceFlow(conn *lsp.Conn, flow command) {
	ctx, cancel := context.WithTimeout(context.Background(), signInTimeout)
	defer cancel()
	err := conn.Call(ctx, "workspace/executeCommand", map[string]any{"command": flow.Command, "arguments": flow.Arguments}, nil)
	if err != nil && !lsp.IsCancelled(err) {
		m.appendLog("sign-in did not complete: " + err.Error())
		m.publish("copilot.message", Message{Type: 1, Message: "GitHub sign-in did not complete: " + friendlyError(err, m.Status().Profile).Error()})
	}
	m.scheduleCheckStatus()
}

// SignOut disconnette l'account dal Language Server.
func (m *Manager) SignOut(ctx context.Context) error {
	conn, err := m.connection()
	if err != nil {
		return err
	}
	callCtx, cancel := context.WithTimeout(ctx, requestTimeout)
	defer cancel()
	if err := conn.Call(callCtx, "signOut", map[string]any{}, nil); err != nil {
		return friendlyError(err, m.Status().Profile)
	}
	m.setStatus(func(status *Status) { status.State = StateSignedOut; status.User = "" })
	m.scheduleCheckStatus()
	return nil
}

// scheduleCheckStatus raggruppa le notifiche di stato in una sola richiesta checkStatus.
func (m *Manager) scheduleCheckStatus() {
	m.mu.Lock()
	defer m.mu.Unlock()
	if m.checkTimer != nil {
		m.checkTimer.Stop()
	}
	m.checkTimer = time.AfterFunc(checkStatusDebounce, m.checkStatus)
}

func (m *Manager) checkStatus() {
	conn, err := m.connection()
	if err != nil {
		return
	}
	ctx, cancel := context.WithTimeout(context.Background(), requestTimeout)
	defer cancel()
	var result struct {
		Status string `json:"status"`
		User   string `json:"user"`
	}
	if err := conn.Call(ctx, "checkStatus", map[string]any{}, &result); err != nil {
		return
	}
	m.setStatus(func(status *Status) { applyAuthStatus(status, result.Status, result.User) })
}

// applyAuthStatus traduce lo stato di autenticazione del server nello stato adOmnia.
func applyAuthStatus(status *Status, auth, user string) {
	switch auth {
	case "OK", "AlreadySignedIn", "MaybeOk":
		status.State = StateReady
		status.User = user
		status.Message = ""
	case "NotAuthorized":
		status.State = StateUnauthorized
		status.User = user
		status.Message = "This account has no GitHub Copilot access on " + status.Profile.Host
	case "NotSignedIn":
		status.State = StateSignedOut
		status.User = ""
	default:
		if auth != "" {
			status.State = StateError
			status.Message = auth
		}
	}
}

// friendlyError distingue proxy e host enterprise irraggiungibili dagli altri errori.
func friendlyError(err error, profile GitHubProfile) error {
	text := err.Error()
	lower := strings.ToLower(text)
	switch {
	case strings.Contains(lower, "proxy") || strings.Contains(lower, "407"):
		return fmt.Errorf("proxy error while contacting %s: %s", profile.Host, text)
	case strings.Contains(lower, "certificate") || strings.Contains(lower, "self signed") || strings.Contains(lower, "unable to verify"):
		return fmt.Errorf("TLS error with %s: add your company CA bundle in Copilot settings (%s)", profile.Host, text)
	case profile.Enterprise() && (strings.Contains(lower, "enotfound") || strings.Contains(lower, "econnrefused") || strings.Contains(lower, "fetch failed")):
		return fmt.Errorf("cannot reach %s: check the enterprise host and your network (%s)", profile.Host, text)
	}
	return err
}

func (m *Manager) setStatus(update func(*Status)) {
	m.mu.Lock()
	update(&m.status)
	m.status.InlineCompletion = m.settings.InlineCompletion
	m.mu.Unlock()
	m.publishStatus()
}

func (m *Manager) publishStatus() {
	m.publish("copilot.status", m.Status())
}

func (m *Manager) publish(event string, payload any) {
	m.mu.Lock()
	emit := m.emit
	m.mu.Unlock()
	if emit != nil {
		emit(event, payload)
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

// openExternal apre solo URL https: il server lo usa per la pagina di login del device flow.
func (m *Manager) openExternal(raw string) bool {
	parsed, err := url.Parse(raw)
	if err != nil || parsed.Scheme != "https" || parsed.Host == "" {
		return false
	}
	m.mu.Lock()
	open := m.openURL
	m.mu.Unlock()
	return open != nil && open(parsed.String()) == nil
}

// Shutdown arresta il server alla chiusura dell'app.
func (m *Manager) Shutdown() {
	m.Stop()
}
