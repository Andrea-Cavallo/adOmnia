package copilot

import (
	"encoding/json"
	"errors"
	"fmt"
	"net/url"
	"os"
	"path/filepath"
	"strings"
	"sync"
)

const settingsFileName = "copilot.json"

// ProxySettings è il proxy HTTP aziendale passato al Language Server; vuoto = proxy di sistema.
type ProxySettings struct {
	URL       string `json:"url"`
	StrictSSL bool   `json:"strictSSL"`
}

// Settings è la configurazione Copilot di adOmnia. Non contiene segreti: il token resta nell'archivio
// del Copilot Language Server.
type Settings struct {
	Enabled          bool            `json:"enabled"`
	InlineCompletion bool            `json:"inlineCompletion"`
	ActiveProfileID  string          `json:"activeProfileId"`
	Profiles         []GitHubProfile `json:"profiles"`
	// WorkspaceProfiles associa la radice di un progetto al profilo da usare, per non usare per
	// sbaglio l'account personale su codice aziendale.
	WorkspaceProfiles map[string]string `json:"workspaceProfiles"`
	Proxy             ProxySettings     `json:"proxy"`
	// CABundlePath aggiunge un bundle PEM di CA aziendali (TLS inspection) ai certificati di sistema.
	CABundlePath string `json:"caBundlePath"`
	// BinaryPath usa un Language Server installato a mano invece di quello gestito da adOmnia.
	BinaryPath string `json:"binaryPath"`
}

// DefaultSettings: Copilot spento finché l'utente non lo attiva, completamento pronto all'uso.
func DefaultSettings() Settings {
	personal := DefaultProfile()
	return Settings{
		InlineCompletion:  true,
		ActiveProfileID:   personal.ID,
		Profiles:          []GitHubProfile{personal},
		WorkspaceProfiles: map[string]string{},
		Proxy:             ProxySettings{StrictSSL: true},
	}
}

// Profile restituisce il profilo con l'ID indicato.
func (s Settings) Profile(id string) (GitHubProfile, bool) {
	for _, profile := range s.Profiles {
		if profile.ID == id {
			return profile, true
		}
	}
	return GitHubProfile{}, false
}

// ProfileForWorkspace sceglie il profilo legato al progetto, altrimenti quello attivo.
func (s Settings) ProfileForWorkspace(root string) GitHubProfile {
	if id, ok := s.WorkspaceProfiles[root]; ok {
		if profile, found := s.Profile(id); found {
			return profile
		}
	}
	if profile, found := s.Profile(s.ActiveProfileID); found {
		return profile
	}
	if len(s.Profiles) > 0 {
		return s.Profiles[0]
	}
	return DefaultProfile()
}

// Validate normalizza gli host e verifica coerenza di ID, profilo attivo, proxy e percorsi.
func (s Settings) Validate() (Settings, error) {
	if len(s.Profiles) == 0 {
		return Settings{}, errors.New("at least one GitHub profile is required")
	}
	seen := make(map[string]bool, len(s.Profiles))
	profiles := make([]GitHubProfile, 0, len(s.Profiles))
	for _, profile := range s.Profiles {
		normalized, err := NewProfile(profile.ID, profile.Name, profile.Host)
		if err != nil {
			return Settings{}, err
		}
		if seen[normalized.ID] {
			return Settings{}, fmt.Errorf("duplicate profile id %q", normalized.ID)
		}
		seen[normalized.ID] = true
		profiles = append(profiles, normalized)
	}
	s.Profiles = profiles
	if !seen[s.ActiveProfileID] {
		s.ActiveProfileID = profiles[0].ID
	}
	bindings := make(map[string]string, len(s.WorkspaceProfiles))
	for root, id := range s.WorkspaceProfiles {
		if seen[id] && root != "" {
			bindings[root] = id
		}
	}
	s.WorkspaceProfiles = bindings
	if err := validateProxy(s.Proxy.URL); err != nil {
		return Settings{}, err
	}
	for _, path := range []string{s.CABundlePath, s.BinaryPath} {
		if path != "" && !filepath.IsAbs(path) {
			return Settings{}, fmt.Errorf("%q must be an absolute path", path)
		}
	}
	return s, nil
}

func validateProxy(raw string) error {
	if strings.TrimSpace(raw) == "" {
		return nil
	}
	parsed, err := url.Parse(raw)
	if err != nil || (parsed.Scheme != "http" && parsed.Scheme != "https") || parsed.Host == "" {
		return fmt.Errorf("proxy must be an http(s) URL, for example http://proxy.company.local:8080")
	}
	return nil
}

// SettingsStore legge e scrive copilot.json nella cartella dati di adOmnia.
type SettingsStore struct {
	mu   sync.Mutex
	path string
}

// NewSettingsStore usa directory/copilot.json.
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

// Save valida e scrive in modo atomico (file temporaneo + rename), leggibile solo dall'utente.
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
		return Settings{}, fmt.Errorf("cannot write Copilot settings: %w", err)
	}
	if err := os.Rename(temporary, s.path); err != nil {
		_ = os.Remove(temporary)
		return Settings{}, fmt.Errorf("cannot save Copilot settings: %w", err)
	}
	return valid, nil
}
