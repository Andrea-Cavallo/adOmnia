package milk

import (
	"adomnia/internal/jsonutil"
	"encoding/json/jsontext"
	"encoding/json/v2"
	"fmt"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"time"
)

const settingsFileName = "milk.json"

// Settings è la configurazione di adOmnia per l'integrazione milk. Non contiene
// segreti: le credenziali degli agenti restano nel config di milk (~/.milk).
type Settings struct {
	Enabled bool `json:"enabled"`
	// BinaryPath usa un binario milk installato a mano invece di cercarlo nel PATH.
	BinaryPath string `json:"binaryPath"`
	// SkipPermissions approva automaticamente ogni tool call senza chiedere
	// (milk: dangerously_skip_permissions). Off per default per sicurezza.
	SkipPermissions bool `json:"skipPermissions"`
	// IgnoreAPIKey (solo Claude Code) toglie ANTHROPIC_API_KEY dall'ambiente
	// dell'agente: vale il login di `claude` (abbonamento) invece della chiave API.
	IgnoreAPIKey bool `json:"ignoreApiKey,omitzero"`
	// DisableBuiltinMCP non passa all'agente il server MCP di adOmnia (collection e mock).
	DisableBuiltinMCP bool `json:"disableBuiltinMcp,omitzero"`
	// Env aggiunge variabili non segrete o riferimenti a credenziali già presenti
	// all'ambiente dell'agente. I valori restano nel file locale delle impostazioni.
	Env map[string]string `json:"env,omitempty"`
	// ExtraArgs sono argomenti espliciti aggiunti al comando dell'agente ACP.
	ExtraArgs []string `json:"extraArgs,omitempty"`
	// TurnTimeoutMinutes ferma un turno che non termina entro questo tempo.
	// 0 usa il default: un modello che "pensa" senza fine non deve tenere la chat occupata per sempre.
	TurnTimeoutMinutes int `json:"turnTimeoutMinutes,omitzero"`
}

// DefaultSettings: milk spento finché l'utente non lo attiva.
func DefaultSettings() Settings {
	return Settings{}
}

// DefaultTurnTimeout è il tempo massimo di un turno quando l'utente non sceglie.
const DefaultTurnTimeout = 10 * time.Minute

// turnTimeout normalizza la scelta dell'utente: 0 = default, minimo 1 minuto, massimo 2 ore.
func turnTimeout(minutes int) time.Duration {
	if minutes <= 0 {
		return DefaultTurnTimeout
	}
	if minutes > 120 {
		minutes = 120
	}
	return time.Duration(minutes) * time.Minute
}

// Validate normalizza i percorsi e verifica che l'eventuale binario sia un path assoluto.
func (s Settings) Validate() (Settings, error) {
	s.BinaryPath = strings.TrimSpace(s.BinaryPath)
	if s.TurnTimeoutMinutes < 0 {
		return Settings{}, fmt.Errorf("the turn timeout cannot be negative")
	}
	if s.TurnTimeoutMinutes > 120 {
		s.TurnTimeoutMinutes = 120
	}
	if s.BinaryPath != "" && !filepath.IsAbs(s.BinaryPath) {
		return Settings{}, fmt.Errorf("%q must be an absolute path", s.BinaryPath)
	}
	if len(s.Env) > 64 || len(s.ExtraArgs) > 32 {
		return Settings{}, fmt.Errorf("too many agent environment variables or arguments")
	}
	cleanEnv := make(map[string]string, len(s.Env))
	for name, value := range s.Env {
		name = strings.TrimSpace(name)
		if name == "" || strings.ContainsAny(name, "=\x00\r\n") || strings.ContainsAny(value, "\x00\r\n") {
			return Settings{}, fmt.Errorf("invalid agent environment variable %q", name)
		}
		cleanEnv[name] = value
	}
	s.Env = cleanEnv
	for index := range s.ExtraArgs {
		s.ExtraArgs[index] = strings.TrimSpace(s.ExtraArgs[index])
		if s.ExtraArgs[index] == "" || strings.ContainsRune(s.ExtraArgs[index], '\x00') {
			return Settings{}, fmt.Errorf("invalid empty agent argument")
		}
	}
	return s, nil
}

// SettingsStore legge e scrive milk.json nella cartella dati di adOmnia.
type SettingsStore struct {
	mu   sync.Mutex
	path string
}

// NewSettingsStore usa directory/milk.json.
func NewSettingsStore(directory string) *SettingsStore {
	return NewSettingsStoreFile(directory, settingsFileName)
}

// NewSettingsStoreFile usa directory/name: ogni agente ACP ha il suo file.
func NewSettingsStoreFile(directory, name string) *SettingsStore {
	return &SettingsStore{path: filepath.Join(directory, name)}
}

// Load restituisce le impostazioni salvate o i default se il file manca o è illeggibile.
func (s *SettingsStore) Load() Settings {
	s.mu.Lock()
	defer s.mu.Unlock()
	data, err := os.ReadFile(s.path)
	if err != nil {
		return DefaultSettings()
	}
	settings := DefaultSettings()
	if json.Unmarshal(data, &settings) != nil {
		return DefaultSettings()
	}
	valid, err := settings.Validate()
	if err != nil {
		return DefaultSettings()
	}
	return valid
}

// Save valida e scrive in modo atomico (file temporaneo + rename).
func (s *SettingsStore) Save(settings Settings) (Settings, error) {
	valid, err := settings.Validate()
	if err != nil {
		return Settings{}, err
	}
	data, err := jsonutil.Marshal(valid, jsontext.WithIndent("  "))
	if err != nil {
		return Settings{}, err
	}
	s.mu.Lock()
	defer s.mu.Unlock()
	if err := os.MkdirAll(filepath.Dir(s.path), 0o700); err != nil {
		return Settings{}, fmt.Errorf("cannot create settings folder: %w", err)
	}
	temporary := s.path + ".tmp"
	if err := os.WriteFile(temporary, data, 0o600); err != nil {
		return Settings{}, fmt.Errorf("cannot write milk settings: %w", err)
	}
	if err := os.Rename(temporary, s.path); err != nil {
		_ = os.Remove(temporary)
		return Settings{}, fmt.Errorf("cannot save milk settings: %w", err)
	}
	return valid, nil
}
