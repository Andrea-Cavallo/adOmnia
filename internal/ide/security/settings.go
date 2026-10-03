package security

import (
	"encoding/json"
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"sort"
	"strings"
	"time"
)

// SettingsFile è versionabile con il progetto: chi clona eredita soppressioni motivate e baseline.
const SettingsFile = ".adomnia/security.json"

const (
	settingsFormat  = "adomnia-security"
	settingsVersion = 1
	maxReasonRunes  = 500
)

// Suppression accetta un finding preciso con una motivazione scritta.
type Suppression struct {
	Rule        string `json:"rule"`
	File        string `json:"file"`
	Fingerprint string `json:"fingerprint"`
	Reason      string `json:"reason"`
	CreatedAt   string `json:"createdAt"`
}

// BaselineEntry è un finding già presente quando la baseline è stata salvata.
type BaselineEntry struct {
	Rule        string `json:"rule"`
	File        string `json:"file"`
	Fingerprint string `json:"fingerprint"`
}

// Settings è il contenuto di .adomnia/security.json.
type Settings struct {
	Format       string          `json:"format"`
	Version      int             `json:"version"`
	Suppressions []Suppression   `json:"suppressions"`
	Baseline     []BaselineEntry `json:"baseline"`
	BaselineAt   string          `json:"baselineAt,omitempty"`
}

func emptySettings() Settings {
	return Settings{Format: settingsFormat, Version: settingsVersion, Suppressions: []Suppression{}, Baseline: []BaselineEntry{}}
}

// LoadSettings legge .adomnia/security.json; un file assente equivale a impostazioni vuote.
func LoadSettings(root string) (Settings, error) {
	data, err := os.ReadFile(filepath.Join(root, filepath.FromSlash(SettingsFile)))
	if errors.Is(err, os.ErrNotExist) {
		return emptySettings(), nil
	}
	if err != nil {
		return emptySettings(), err
	}
	settings := emptySettings()
	if err := json.Unmarshal(data, &settings); err != nil {
		return emptySettings(), fmt.Errorf("%s non valido: %w", SettingsFile, err)
	}
	if settings.Suppressions == nil {
		settings.Suppressions = []Suppression{}
	}
	if settings.Baseline == nil {
		settings.Baseline = []BaselineEntry{}
	}
	return settings, nil
}

// ApplySettings marca i finding soppressi dal pannello o già presenti nella baseline.
func ApplySettings(findings []Finding, settings Settings) {
	suppressed := map[string]Suppression{}
	for _, suppression := range settings.Suppressions {
		suppressed[suppression.Fingerprint] = suppression
	}
	baselined := map[string]bool{}
	for _, entry := range settings.Baseline {
		baselined[entry.Fingerprint] = true
	}
	for index := range findings {
		if suppression, ok := suppressed[findings[index].Fingerprint]; ok && !findings[index].Suppressed {
			findings[index].Suppressed = true
			findings[index].SuppressionReason = suppression.Reason
		}
		findings[index].Baselined = baselined[findings[index].Fingerprint]
	}
}

// Suppress registra la soppressione motivata di un finding.
func Suppress(root string, finding Finding, reason string) error {
	reason = strings.TrimSpace(reason)
	if reason == "" {
		return errors.New("scrivi perché questo finding è accettabile: la motivazione è obbligatoria")
	}
	if len([]rune(reason)) > maxReasonRunes {
		return fmt.Errorf("motivazione troppo lunga (massimo %d caratteri)", maxReasonRunes)
	}
	if finding.Fingerprint == "" || finding.Rule == "" {
		return errors.New("finding non valido")
	}
	settings, err := LoadSettings(root)
	if err != nil {
		return err
	}
	kept := settings.Suppressions[:0]
	for _, suppression := range settings.Suppressions {
		if suppression.Fingerprint != finding.Fingerprint {
			kept = append(kept, suppression)
		}
	}
	settings.Suppressions = append(kept, Suppression{
		Rule: finding.Rule, File: finding.File, Fingerprint: finding.Fingerprint, Reason: reason,
		CreatedAt: time.Now().UTC().Format(time.RFC3339),
	})
	return saveSettings(root, settings)
}

// Unsuppress toglie la soppressione dal pannello (quelle nel codice si tolgono cancellando il commento).
func Unsuppress(root, fingerprint string) error {
	settings, err := LoadSettings(root)
	if err != nil {
		return err
	}
	kept := settings.Suppressions[:0]
	for _, suppression := range settings.Suppressions {
		if suppression.Fingerprint != fingerprint {
			kept = append(kept, suppression)
		}
	}
	settings.Suppressions = kept
	return saveSettings(root, settings)
}

// SaveBaseline accetta i finding attuali non soppressi: le scansioni successive mostrano solo i nuovi.
func SaveBaseline(root string, findings []Finding) (int, error) {
	settings, err := LoadSettings(root)
	if err != nil {
		return 0, err
	}
	seen := map[string]bool{}
	settings.Baseline = []BaselineEntry{}
	for _, finding := range findings {
		if finding.Suppressed || seen[finding.Fingerprint] {
			continue
		}
		seen[finding.Fingerprint] = true
		settings.Baseline = append(settings.Baseline, BaselineEntry{Rule: finding.Rule, File: finding.File, Fingerprint: finding.Fingerprint})
	}
	sort.Slice(settings.Baseline, func(left, right int) bool {
		a, b := settings.Baseline[left], settings.Baseline[right]
		if a.File != b.File {
			return a.File < b.File
		}
		if a.Rule != b.Rule {
			return a.Rule < b.Rule
		}
		return a.Fingerprint < b.Fingerprint
	})
	settings.BaselineAt = time.Now().UTC().Format(time.RFC3339)
	return len(settings.Baseline), saveSettings(root, settings)
}

// ClearBaseline rimuove la baseline: tornano visibili tutti i finding non soppressi.
func ClearBaseline(root string) error {
	settings, err := LoadSettings(root)
	if err != nil {
		return err
	}
	settings.Baseline = []BaselineEntry{}
	settings.BaselineAt = ""
	return saveSettings(root, settings)
}

func saveSettings(root string, settings Settings) error {
	settings.Format = settingsFormat
	settings.Version = settingsVersion
	sort.SliceStable(settings.Suppressions, func(left, right int) bool {
		a, b := settings.Suppressions[left], settings.Suppressions[right]
		if a.File != b.File {
			return a.File < b.File
		}
		return a.Rule < b.Rule
	})
	data, err := json.MarshalIndent(settings, "", "  ")
	if err != nil {
		return err
	}
	path := filepath.Join(root, filepath.FromSlash(SettingsFile))
	if err := os.MkdirAll(filepath.Dir(path), 0o755); err != nil {
		return fmt.Errorf("cartella .adomnia non scrivibile: %w", err)
	}
	temporary, err := os.CreateTemp(filepath.Dir(path), ".security-*.json")
	if err != nil {
		return err
	}
	name := temporary.Name()
	_, writeErr := temporary.Write(append(data, '\n'))
	closeErr := temporary.Close()
	if writeErr != nil || closeErr != nil {
		_ = os.Remove(name)
		return errors.Join(writeErr, closeErr)
	}
	if err := os.Chmod(name, 0o644); err != nil {
		_ = os.Remove(name)
		return err
	}
	if err := os.Rename(name, path); err != nil {
		_ = os.Remove(name)
		return err
	}
	return nil
}
