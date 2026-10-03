package golang

import (
	"fmt"
	goversion "go/version"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"time"

	"golang.org/x/mod/modfile"

	"adomnia/internal/ide/project"
	"adomnia/internal/ide/sdk"
)

const toolchainTimeout = 8 * time.Second

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

// ToolchainManager gestisce l'SDK Go per sessione (K è il tipo di ID di sessione dell'host) e
// globalmente. Le primitive comuni (ambiente, eseguibili, query) vengono da internal/ide/sdk.
type ToolchainManager[K ~string] struct {
	mu       sync.RWMutex
	configs  map[K]ToolchainConfiguration
	global   ToolchainConfiguration
	detected map[K]ToolchainInfo
	// generation scarta i risultati di go env arrivati dopo un rilevamento più recente.
	generation map[K]int
	// notify riceve i rilevamenti completati in background (go env); il Service li emette e li salva.
	notify func(K, ToolchainInfo)
}

func NewToolchainManager[K ~string]() *ToolchainManager[K] {
	return &ToolchainManager[K]{configs: make(map[K]ToolchainConfiguration), detected: make(map[K]ToolchainInfo), generation: make(map[K]int)}
}

// LastDetected restituisce l'ultimo rilevamento riuscito per la sessione.
func (m *ToolchainManager[K]) LastDetected(sessionID K) (ToolchainInfo, bool) {
	m.mu.RLock()
	defer m.mu.RUnlock()
	info, ok := m.detected[sessionID]
	return info, ok && info.Available
}

// Configure convalida il binario Go e le sole variabili esplicitamente definite per la sessione.
func (m *ToolchainManager[K]) Configure(sessionID K, config ToolchainConfiguration) error {
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
func (m *ToolchainManager[K]) ConfigureGlobal(config ToolchainConfiguration) error {
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
func (m *ToolchainManager[K]) ResetSession(sessionID K) {
	m.mu.Lock()
	delete(m.configs, sessionID)
	m.mu.Unlock()
}

// Settings restituisce copie della configurazione di progetto e di quella globale.
func (m *ToolchainManager[K]) Settings(sessionID K) ToolchainSettings {
	m.mu.RLock()
	defer m.mu.RUnlock()
	settings := ToolchainSettings{Global: m.global}
	settings.Global.Environment = sdk.CopyEnvironment(m.global.Environment)
	if config, ok := m.configs[sessionID]; ok {
		config.Environment = sdk.CopyEnvironment(config.Environment)
		settings.Project = &config
	}
	return settings
}

// Snapshot restituisce le configurazioni persistibili: i valori con credenziali negli URL restano solo in memoria.
func (m *ToolchainManager[K]) Snapshot() (map[K]ToolchainConfiguration, ToolchainConfiguration) {
	m.mu.RLock()
	defer m.mu.RUnlock()
	configs := make(map[K]ToolchainConfiguration, len(m.configs))
	for id, config := range m.configs {
		configs[id] = persistableToolchain(config)
	}
	return configs, persistableToolchain(m.global)
}

// Replace ripristina le configurazioni salvate senza eseguire i binari: il rilevamento segnala quelli spariti.
func (m *ToolchainManager[K]) Replace(configs map[K]ToolchainConfiguration, global ToolchainConfiguration) {
	m.mu.Lock()
	defer m.mu.Unlock()
	m.configs = make(map[K]ToolchainConfiguration, len(configs))
	for id, config := range configs {
		config.Environment = sdk.CopyEnvironment(config.Environment)
		m.configs[id] = config
	}
	global.Environment = sdk.CopyEnvironment(global.Environment)
	m.global = global
}

func persistableToolchain(config ToolchainConfiguration) ToolchainConfiguration {
	return ToolchainConfiguration{GoBinary: config.GoBinary, Environment: sdk.PersistableEnvironment(config.Environment)}
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
	clean, err := sdk.ValidateEnvironment(config.Environment)
	if err != nil {
		return config, err
	}
	config.Environment = clean
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
func (m *ToolchainManager[K]) Configuration(sessionID K) ToolchainConfiguration {
	m.mu.RLock()
	config, ok := m.configs[sessionID]
	if !ok {
		config = m.global
	}
	m.mu.RUnlock()
	config.Environment = sdk.CopyEnvironment(config.Environment)
	return config
}

// GoBinary risolve il binario configurato o quello disponibile nel PATH.
func (m *ToolchainManager[K]) GoBinary(sessionID K) (string, error) {
	return resolveGoBinary(m.Configuration(sessionID).GoBinary)
}

// Environment restituisce un ambiente di processo completo senza modificarne o registrarne i valori.
func (m *ToolchainManager[K]) Environment(sessionID K, overrides map[string]string) ([]string, error) {
	base, err := sdk.ProcessEnvironment(m.Configuration(sessionID).Environment, overrides)
	if err != nil {
		return nil, err
	}
	// gO Studio non scarica toolchain Go da solo: senza una scelta esplicita (variabile d'ambiente,
	// configurazione del progetto o go env -w) i processi avviati usano l'SDK selezionato.
	if _, explicit := base["GOTOOLCHAIN"]; !explicit && !m.userChoseToolchain(sessionID) {
		base["GOTOOLCHAIN"] = "local"
	}
	return sdk.EnvironmentList(base), nil
}

// CloseSession elimina le impostazioni runtime della sessione senza toccare il progetto.
func (m *ToolchainManager[K]) CloseSession(sessionID K) {
	m.mu.Lock()
	delete(m.configs, sessionID)
	delete(m.detected, sessionID)
	m.mu.Unlock()
}

// UsesBinary indica se il binario è selezionato da una sessione corrente o come toolchain globale.
func (m *ToolchainManager[K]) UsesBinary(binary string) bool {
	m.mu.RLock()
	defer m.mu.RUnlock()
	for _, config := range m.configs {
		if config.GoBinary != "" && project.SamePath(config.GoBinary, binary) {
			return true
		}
	}
	return m.global.GoBinary != "" && project.SamePath(m.global.GoBinary, binary)
}

func resolveGoBinary(configured string) (string, error) {
	candidate := strings.TrimSpace(configured)
	if candidate == "" {
		candidate = "go"
	}
	return sdk.ResolveExecutable(candidate, "Go")
}
