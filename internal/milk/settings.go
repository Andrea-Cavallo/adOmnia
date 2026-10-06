package milk

import (
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"strings"
	"sync"
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
}

// DefaultSettings: milk spento finché l'utente non lo attiva.
func DefaultSettings() Settings {
	return Settings{}
}

// Validate normalizza i percorsi e verifica che l'eventuale binario sia un path assoluto.
func (s Settings) Validate() (Settings, error) {
	s.BinaryPath = strings.TrimSpace(s.BinaryPath)
	if s.BinaryPath != "" && !filepath.IsAbs(s.BinaryPath) {
		return Settings{}, fmt.Errorf("%q must be an absolute path", s.BinaryPath)
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
	return &SettingsStore{path: filepath.Join(directory, settingsFileName)}
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
	data, err := json.MarshalIndent(valid, "", "  ")
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
