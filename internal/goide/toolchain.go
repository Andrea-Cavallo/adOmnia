package goide

import (
	"context"
	"fmt"
	"net/url"
	"os"
	"os/exec"
	"path/filepath"
	"regexp"
	"sort"
	"strings"
	"sync"
	"time"
)

const toolchainTimeout = 8 * time.Second

var environmentNamePattern = regexp.MustCompile(`^[A-Za-z_][A-Za-z0-9_]*$`)

type ToolchainConfiguration struct {
	GoBinary    string            `json:"goBinary"`
	Environment map[string]string `json:"environment,omitempty"`
}

type ToolchainInfo struct {
	Available bool   `json:"available"`
	GoBinary  string `json:"goBinary,omitempty"`
	Version   string `json:"version,omitempty"`
	GOROOT    string `json:"goroot,omitempty"`
	GOPATH    string `json:"gopath,omitempty"`
	GOPROXY   string `json:"goproxy,omitempty"`
	GOPRIVATE string `json:"goprivate,omitempty"`
	Error     string `json:"error,omitempty"`
}

type ToolchainManager struct {
	mu      sync.RWMutex
	configs map[SessionID]ToolchainConfiguration
}

func NewToolchainManager() *ToolchainManager {
	return &ToolchainManager{configs: make(map[SessionID]ToolchainConfiguration)}
}

// Configure convalida il binario Go e le sole variabili esplicitamente definite per la sessione.
func (m *ToolchainManager) Configure(sessionID SessionID, config ToolchainConfiguration) error {
	config.GoBinary = strings.TrimSpace(config.GoBinary)
	if config.GoBinary != "" {
		resolved, err := resolveGoBinary(config.GoBinary)
		if err != nil {
			return err
		}
		config.GoBinary = resolved
	}
	if len(config.Environment) > 128 {
		return fmt.Errorf("troppe variabili ambiente: limite 128")
	}
	cleanEnvironment := make(map[string]string, len(config.Environment))
	for key, value := range config.Environment {
		key = strings.TrimSpace(key)
		if !environmentNamePattern.MatchString(key) {
			return fmt.Errorf("nome variabile ambiente non valido: %s", key)
		}
		if len(value) > 32*1024 {
			return fmt.Errorf("valore ambiente troppo grande per %s", key)
		}
		cleanEnvironment[key] = value
	}
	config.Environment = cleanEnvironment
	m.mu.Lock()
	m.configs[sessionID] = config
	m.mu.Unlock()
	return nil
}

// Detect esegue esclusivamente comandi informativi della toolchain con timeout e output limitato.
func (m *ToolchainManager) Detect(session Session) ToolchainInfo {
	config := m.Configuration(session.ID)
	binary, err := resolveGoBinary(config.GoBinary)
	if err != nil {
		return ToolchainInfo{Available: false, Error: "Go non trovato. Installa Go oppure configura il percorso del binario nelle impostazioni del progetto."}
	}
	ctx, cancel := context.WithTimeout(context.Background(), toolchainTimeout)
	defer cancel()
	version, err := runToolchainQuery(ctx, binary, session.Project.RealPath, config.Environment, "version")
	if err != nil {
		return ToolchainInfo{Available: false, GoBinary: binary, Error: err.Error()}
	}
	environment, err := runToolchainQuery(ctx, binary, session.Project.RealPath, config.Environment, "env", "GOROOT", "GOPATH", "GOPROXY", "GOPRIVATE")
	if err != nil {
		return ToolchainInfo{Available: false, GoBinary: binary, Version: strings.TrimSpace(version), Error: err.Error()}
	}
	lines := strings.Split(strings.ReplaceAll(environment, "\r\n", "\n"), "\n")
	for len(lines) < 4 {
		lines = append(lines, "")
	}
	return ToolchainInfo{
		Available: true,
		GoBinary:  binary,
		Version:   strings.TrimSpace(version),
		GOROOT:    strings.TrimSpace(lines[0]),
		GOPATH:    strings.TrimSpace(lines[1]),
		GOPROXY:   sanitizeToolchainValue(lines[2]),
		GOPRIVATE: sanitizeToolchainValue(lines[3]),
	}
}

// Configuration restituisce una copia della configurazione della sessione.
func (m *ToolchainManager) Configuration(sessionID SessionID) ToolchainConfiguration {
	m.mu.RLock()
	config := m.configs[sessionID]
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
	m.mu.Unlock()
}

// UsesBinary indica se il binario è selezionato da almeno una sessione corrente.
func (m *ToolchainManager) UsesBinary(binary string) bool {
	m.mu.RLock()
	defer m.mu.RUnlock()
	for _, config := range m.configs {
		if config.GoBinary != "" && samePath(config.GoBinary, binary) {
			return true
		}
	}
	return false
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
