package goide

import (
	"adomnia/internal/netpolicy"

	"context"
	"fmt"
	goversion "go/version"
	"net/url"
	"os"
	"os/exec"
	"path/filepath"
	"regexp"
	"sort"
	"strings"
	"sync"
	"time"

	"golang.org/x/mod/modfile"
)

const toolchainTimeout = 8 * time.Second

var environmentNamePattern = regexp.MustCompile(`^[A-Za-z_][A-Za-z0-9_]*$`)

type ToolchainConfiguration struct {
	GoBinary    string            `json:"goBinary"`
	Environment map[string]string `json:"environment,omitempty"`
}

type ToolchainInfo struct {
	Available   bool   `json:"available"`
	GoBinary    string `json:"goBinary,omitempty"`
	Version     string `json:"version,omitempty"`
	GOROOT      string `json:"goroot,omitempty"`
	GOPATH      string `json:"gopath,omitempty"`
	GOPROXY     string `json:"goproxy,omitempty"`
	GOPRIVATE   string `json:"goprivate,omitempty"`
	GOMODCACHE  string `json:"gomodcache,omitempty"`
	GONOSUMDB   string `json:"gonosumdb,omitempty"`
	GONOPROXY   string `json:"gonoproxy,omitempty"`
	CGOEnabled  string `json:"cgoEnabled,omitempty"`
	GOOS        string `json:"goos,omitempty"`
	GOARCH      string `json:"goarch,omitempty"`
	GOFLAGS     string `json:"goflags,omitempty"`
	GOTOOLCHAIN string `json:"gotoolchain,omitempty"`
	// GoDirective e ToolchainDirective vengono dal go.mod alla radice del progetto.
	GoDirective        string `json:"goDirective,omitempty"`
	ToolchainDirective string `json:"toolchainDirective,omitempty"`
	// Scope vale "project" se la sessione ha una configurazione propria, altrimenti "global".
	Scope   string `json:"scope,omitempty"`
	Warning string `json:"warning,omitempty"`
	Error   string `json:"error,omitempty"`
	// EnvPending: le variabili di go env sono in lettura in background; EnvError non invalida l'SDK.
	EnvPending bool   `json:"envPending,omitempty"`
	EnvError   string `json:"envError,omitempty"`
	// Cached: valori di go env presi dall'ultimo rilevamento salvato (stesso binario, stessa data).
	Cached  bool              `json:"cached,omitempty"`
	Timings []ToolchainTiming `json:"timings,omitempty"`
	// BinaryStamp (dimensione e data del binario) valida la cache senza eseguire go.
	BinaryStamp string `json:"binaryStamp,omitempty"`
	// SDKVersion è la versione locale dell'SDK (es. go1.26.3), letta senza avviare go quando possibile.
	SDKVersion string `json:"sdkVersion,omitempty"`
}

// ToolchainTiming è la durata di una fase del rilevamento, per capire cosa rallenta.
type ToolchainTiming struct {
	Phase  string `json:"phase"`
	Millis int64  `json:"ms"`
	Note   string `json:"note,omitempty"`
}

// ToolchainSettings espone la configurazione del progetto (se presente) e quella globale.
type ToolchainSettings struct {
	Project *ToolchainConfiguration `json:"project,omitempty"`
	Global  ToolchainConfiguration  `json:"global"`
}

type ToolchainManager struct {
	mu       sync.RWMutex
	configs  map[SessionID]ToolchainConfiguration
	global   ToolchainConfiguration
	detected map[SessionID]ToolchainInfo
	// generation scarta i risultati di go env arrivati dopo un rilevamento più recente.
	generation map[SessionID]int
	// notify riceve i rilevamenti completati in background (go env); il Service li emette e li salva.
	notify func(SessionID, ToolchainInfo)
}

func NewToolchainManager() *ToolchainManager {
	return &ToolchainManager{configs: make(map[SessionID]ToolchainConfiguration), detected: make(map[SessionID]ToolchainInfo), generation: make(map[SessionID]int)}
}

// LastDetected restituisce l'ultimo rilevamento riuscito per la sessione.
func (m *ToolchainManager) LastDetected(sessionID SessionID) (ToolchainInfo, bool) {
	m.mu.RLock()
	defer m.mu.RUnlock()
	info, ok := m.detected[sessionID]
	return info, ok && info.Available
}

// Configure convalida il binario Go e le sole variabili esplicitamente definite per la sessione.
func (m *ToolchainManager) Configure(sessionID SessionID, config ToolchainConfiguration) error {
	config, err := validateToolchainConfiguration(config)
	if err != nil {
		return err
	}
	m.mu.Lock()
	m.configs[sessionID] = config
	m.mu.Unlock()
	return nil
}

// ConfigureGlobal imposta la toolchain predefinita dei progetti senza configurazione propria.
func (m *ToolchainManager) ConfigureGlobal(config ToolchainConfiguration) error {
	config, err := validateToolchainConfiguration(config)
	if err != nil {
		return err
	}
	m.mu.Lock()
	m.global = config
	m.mu.Unlock()
	return nil
}

// ResetSession riporta la sessione alla toolchain globale.
func (m *ToolchainManager) ResetSession(sessionID SessionID) {
	m.mu.Lock()
	delete(m.configs, sessionID)
	m.mu.Unlock()
}

// Settings restituisce copie della configurazione di progetto e di quella globale.
func (m *ToolchainManager) Settings(sessionID SessionID) ToolchainSettings {
	m.mu.RLock()
	defer m.mu.RUnlock()
	settings := ToolchainSettings{Global: m.global}
	settings.Global.Environment = copyEnvironment(m.global.Environment)
	if config, ok := m.configs[sessionID]; ok {
		config.Environment = copyEnvironment(config.Environment)
		settings.Project = &config
	}
	return settings
}

// Snapshot restituisce le configurazioni persistibili: i valori con credenziali negli URL restano solo in memoria.
func (m *ToolchainManager) Snapshot() (map[SessionID]ToolchainConfiguration, ToolchainConfiguration) {
	m.mu.RLock()
	defer m.mu.RUnlock()
	configs := make(map[SessionID]ToolchainConfiguration, len(m.configs))
	for id, config := range m.configs {
		configs[id] = persistableToolchain(config)
	}
	return configs, persistableToolchain(m.global)
}

// Replace ripristina le configurazioni salvate senza eseguire i binari: il rilevamento segnala quelli spariti.
func (m *ToolchainManager) Replace(configs map[SessionID]ToolchainConfiguration, global ToolchainConfiguration) {
	m.mu.Lock()
	defer m.mu.Unlock()
	m.configs = make(map[SessionID]ToolchainConfiguration, len(configs))
	for id, config := range configs {
		config.Environment = copyEnvironment(config.Environment)
		m.configs[id] = config
	}
	global.Environment = copyEnvironment(global.Environment)
	m.global = global
}

func persistableToolchain(config ToolchainConfiguration) ToolchainConfiguration {
	clean := ToolchainConfiguration{GoBinary: config.GoBinary}
	for key, value := range config.Environment {
		if hasURLCredentials(value) {
			continue
		}
		if clean.Environment == nil {
			clean.Environment = make(map[string]string)
		}
		clean.Environment[key] = value
	}
	return clean
}

func hasURLCredentials(value string) bool {
	for _, part := range strings.FieldsFunc(value, func(r rune) bool { return r == ',' || r == '|' || r == ' ' }) {
		if parsed, err := url.Parse(part); err == nil && parsed.User != nil {
			return true
		}
	}
	return false
}

func validateToolchainConfiguration(config ToolchainConfiguration) (ToolchainConfiguration, error) {
	config.GoBinary = strings.TrimSpace(config.GoBinary)
	if config.GoBinary != "" {
		resolved, err := resolveGoBinary(config.GoBinary)
		if err != nil {
			return config, err
		}
		config.GoBinary = resolved
	}
	if len(config.Environment) > 128 {
		return config, fmt.Errorf("troppe variabili ambiente: limite 128")
	}
	cleanEnvironment := make(map[string]string, len(config.Environment))
	for key, value := range config.Environment {
		key = strings.TrimSpace(key)
		if !environmentNamePattern.MatchString(key) {
			return config, fmt.Errorf("nome variabile ambiente non valido: %s", key)
		}
		if len(value) > 32*1024 {
			return config, fmt.Errorf("valore ambiente troppo grande per %s", key)
		}
		cleanEnvironment[key] = value
	}
	config.Environment = cleanEnvironment
	return config, nil
}

// readModuleDirectives legge le direttive go e toolchain del go.mod alla radice; se assenti restano vuote.
func readModuleDirectives(root string) (string, string) {
	data, err := os.ReadFile(filepath.Join(root, "go.mod"))
	if err != nil || len(data) > 4<<20 {
		return "", ""
	}
	// ParseLax ignora la direttiva toolchain: serve Parse, con ParseLax come ripiego per go.mod non validi.
	file, err := modfile.Parse("go.mod", data, nil)
	if err != nil {
		if file, err = modfile.ParseLax("go.mod", data, nil); err != nil {
			return "", ""
		}
	}
	goDirective, toolchainDirective := "", ""
	if file.Go != nil {
		goDirective = file.Go.Version
	}
	if file.Toolchain != nil {
		toolchainDirective = file.Toolchain.Name
	}
	return goDirective, toolchainDirective
}

// localGoVersion estrae "go1.26.5" da "go version go1.26.5 windows/amd64".
func localGoVersion(output string) string {
	for _, field := range strings.Fields(output) {
		if goversion.IsValid(field) {
			return field
		}
	}
	return ""
}

// toolchainWarning spiega cosa succede quando l'SDK scelto è più vecchio di quanto richiede il go.mod.
func toolchainWarning(local, goDirective, toolchainDirective, gotoolchain string) string {
	if local == "" {
		return ""
	}
	required := ""
	if goDirective != "" {
		required = "go" + goDirective
	}
	if goversion.IsValid(toolchainDirective) && (!goversion.IsValid(required) || goversion.Compare(toolchainDirective, required) > 0) {
		required = toolchainDirective
	}
	if !goversion.IsValid(required) || goversion.Compare(local, required) >= 0 {
		return ""
	}
	if gotoolchain == "" || gotoolchain == "auto" || strings.HasPrefix(gotoolchain, "local") {
		return fmt.Sprintf("go.mod richiede %s ma l'SDK selezionato è %s: gO Studio usa GOTOOLCHAIN=local e non scarica toolchain da solo, quindi build e test falliranno. Seleziona o installa %s o successivo (Go → Toolchains), oppure imposta GOTOOLCHAIN=auto nelle variabili del progetto per lasciarla scaricare a go.", required, local, required)
	}
	return fmt.Sprintf("go.mod richiede %s ma l'SDK selezionato è %s: con GOTOOLCHAIN=%s il comando go scaricherà %s in automatico. Selezionalo qui per lavorare offline.", required, local, gotoolchain, required)
}

// Configuration restituisce una copia della configurazione della sessione, o quella globale se non ne ha una.
func (m *ToolchainManager) Configuration(sessionID SessionID) ToolchainConfiguration {
	m.mu.RLock()
	config, ok := m.configs[sessionID]
	if !ok {
		config = m.global
	}
	m.mu.RUnlock()
	config.Environment = copyEnvironment(config.Environment)
	return config
}

// GoBinary risolve il binario configurato o quello disponibile nel PATH.
func (m *ToolchainManager) GoBinary(sessionID SessionID) (string, error) {
	return resolveGoBinary(m.Configuration(sessionID).GoBinary)
}

// Environment restituisce un ambiente di processo completo senza modificarne o registrarne i valori.
func (m *ToolchainManager) Environment(sessionID SessionID, overrides map[string]string) ([]string, error) {
	if len(overrides) > 128 {
		return nil, fmt.Errorf("troppe variabili ambiente: limite 128")
	}
	config := m.Configuration(sessionID)
	merged := copyEnvironment(config.Environment)
	for key, value := range overrides {
		if !environmentNamePattern.MatchString(key) {
			return nil, fmt.Errorf("nome variabile ambiente non valido: %s", key)
		}
		if len(value) > 32*1024 {
			return nil, fmt.Errorf("valore ambiente troppo grande per %s", key)
		}
		merged[key] = value
	}
	base := make(map[string]string)
	for _, item := range os.Environ() {
		if index := strings.IndexByte(item, '='); index > 0 {
			base[item[:index]] = item[index+1:]
		}
	}
	for key, value := range merged {
		base[key] = value
	}
	// Proxy e CA di adOmnia riempiono i vuoti; il modo offline di adOmnia vince sul progetto.
	netpolicy.ProcessEnvironment(base)
	// gO Studio non scarica toolchain Go da solo: senza una scelta esplicita (variabile d'ambiente,
	// configurazione del progetto o go env -w) i processi avviati usano l'SDK selezionato.
	if _, explicit := base["GOTOOLCHAIN"]; !explicit && !m.userChoseToolchain(sessionID) {
		base["GOTOOLCHAIN"] = "local"
	}
	keys := make([]string, 0, len(base))
	for key := range base {
		keys = append(keys, key)
	}
	sort.Strings(keys)
	result := make([]string, 0, len(keys))
	for _, key := range keys {
		result = append(result, key+"="+base[key])
	}
	return result, nil
}

// CloseSession elimina le impostazioni runtime della sessione senza toccare il progetto.
func (m *ToolchainManager) CloseSession(sessionID SessionID) {
	m.mu.Lock()
	delete(m.configs, sessionID)
	delete(m.detected, sessionID)
	m.mu.Unlock()
}

// UsesBinary indica se il binario è selezionato da una sessione corrente o come toolchain globale.
func (m *ToolchainManager) UsesBinary(binary string) bool {
	m.mu.RLock()
	defer m.mu.RUnlock()
	for _, config := range m.configs {
		if config.GoBinary != "" && samePath(config.GoBinary, binary) {
			return true
		}
	}
	return m.global.GoBinary != "" && samePath(m.global.GoBinary, binary)
}

func resolveGoBinary(configured string) (string, error) {
	candidate := strings.TrimSpace(configured)
	if candidate == "" {
		candidate = "go"
	}
	resolved, err := exec.LookPath(candidate)
	if err != nil {
		return "", fmt.Errorf("binario Go non trovato: %w", err)
	}
	abs, err := filepath.Abs(resolved)
	if err != nil {
		return "", fmt.Errorf("percorso del binario Go non valido: %w", err)
	}
	info, err := os.Stat(abs)
	if err != nil || info.IsDir() {
		return "", fmt.Errorf("il percorso Go configurato non è un eseguibile valido")
	}
	return abs, nil
}

func runToolchainQuery(ctx context.Context, binary, workingDirectory string, environment map[string]string, arguments ...string) (string, error) {
	command := exec.CommandContext(ctx, binary, arguments...)
	command.Dir = workingDirectory
	command.Env = os.Environ()
	for key, value := range environment {
		command.Env = append(command.Env, key+"="+value)
	}
	configureProcess(command, false)
	output, err := command.CombinedOutput()
	if len(output) > 64*1024 {
		output = output[:64*1024]
	}
	if ctx.Err() != nil {
		return "", fmt.Errorf("rilevamento Go scaduto")
	}
	if err != nil {
		return "", fmt.Errorf("rilevamento Go fallito: %s", strings.TrimSpace(string(output)))
	}
	return string(output), nil
}

func sanitizeToolchainValue(value string) string {
	parts := strings.Split(value, ",")
	for index, part := range parts {
		parsed, err := url.Parse(strings.TrimSpace(part))
		if err == nil && parsed.Scheme != "" && parsed.Host != "" {
			if parsed.User != nil {
				parsed.User = url.User("••••")
			}
			parsed.RawQuery = ""
			parsed.Fragment = ""
			parts[index] = parsed.String()
		}
	}
	return strings.Join(parts, ",")
}

func copyEnvironment(source map[string]string) map[string]string {
	copy := make(map[string]string, len(source))
	for key, value := range source {
		copy[key] = value
	}
	return copy
}
