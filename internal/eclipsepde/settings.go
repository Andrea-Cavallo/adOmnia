package eclipsepde

import (
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
)

// TargetSettingsFile is versionable with the project: adOmnia settings live in
// `.adomnia/` and never inside the Eclipse metadata (spec sections 6 and 12).
const TargetSettingsFile = ".adomnia/eclipse-target.json"

const (
	targetSettingsFormat  = "adomnia-eclipse-target"
	targetSettingsVersion = 1
)

// TargetSettings is the persisted content of `.adomnia/eclipse-target.json`:
// the registered target profiles and which one is active. Paths are stored as
// given; prefer relative paths so the file can be shared via Git.
type TargetSettings struct {
	Format   string          `json:"format"`
	Version  int             `json:"version"`
	Active   string          `json:"active,omitempty"`
	Profiles []TargetProfile `json:"profiles"`
}

// TargetProfileJSON keeps the stable on-disk shape of a profile.
type targetProfileJSON struct {
	Name                 string `json:"name"`
	Kind                 string `json:"kind"`
	Path                 string `json:"path"`
	ExecutionEnvironment string `json:"executionEnvironment,omitempty"`
	Offline              bool   `json:"offline,omitempty"`
}

// LoadTargetSettings reads `.adomnia/eclipse-target.json` from root; a missing
// file equals empty settings. The original Eclipse workspace is never touched.
func LoadTargetSettings(root string) (TargetSettings, error) {
	empty := TargetSettings{Format: targetSettingsFormat, Version: targetSettingsVersion, Profiles: []TargetProfile{}}
	data, err := os.ReadFile(filepath.Join(root, filepath.FromSlash(TargetSettingsFile)))
	if os.IsNotExist(err) {
		return empty, nil
	}
	if err != nil {
		return empty, err
	}
	var raw struct {
		Format   string              `json:"format"`
		Version  int                 `json:"version"`
		Active   string              `json:"active"`
		Profiles []targetProfileJSON `json:"profiles"`
	}
	if err := json.Unmarshal(data, &raw); err != nil {
		return empty, fmt.Errorf("invalid %s: %w", TargetSettingsFile, err)
	}
	settings := empty
	settings.Active = raw.Active
	for _, p := range raw.Profiles {
		settings.Profiles = append(settings.Profiles, TargetProfile{
			Name:                 p.Name,
			Kind:                 TargetSourceKind(p.Kind),
			Path:                 p.Path,
			ExecutionEnvironment: p.ExecutionEnvironment,
			Offline:              p.Offline,
		})
	}
	return settings, nil
}

// SaveTargetSettings writes `.adomnia/eclipse-target.json` atomically (temp file
// plus rename), mirroring the other adOmnia settings files.
func SaveTargetSettings(root string, settings TargetSettings) error {
	raw := struct {
		Format   string              `json:"format"`
		Version  int                 `json:"version"`
		Active   string              `json:"active,omitempty"`
		Profiles []targetProfileJSON `json:"profiles"`
	}{
		Format:   targetSettingsFormat,
		Version:  targetSettingsVersion,
		Active:   settings.Active,
		Profiles: []targetProfileJSON{},
	}
	for _, p := range settings.Profiles {
		raw.Profiles = append(raw.Profiles, targetProfileJSON{
			Name:                 p.Name,
			Kind:                 string(p.Kind),
			Path:                 p.Path,
			ExecutionEnvironment: p.ExecutionEnvironment,
			Offline:              p.Offline,
		})
	}
	data, err := json.MarshalIndent(raw, "", "  ")
	if err != nil {
		return err
	}
	path := filepath.Join(root, filepath.FromSlash(TargetSettingsFile))
	if err := os.MkdirAll(filepath.Dir(path), 0o755); err != nil {
		return fmt.Errorf(".adomnia folder is not writable: %w", err)
	}
	temporary, err := os.CreateTemp(filepath.Dir(path), ".eclipse-target-*.json")
	if err != nil {
		return err
	}
	name := temporary.Name()
	_, writeErr := temporary.Write(append(data, '\n'))
	closeErr := temporary.Close()
	if writeErr != nil || closeErr != nil {
		_ = os.Remove(name)
		return fmt.Errorf("cannot write %s: %v %v", TargetSettingsFile, writeErr, closeErr)
	}
	if err := os.Rename(name, path); err != nil {
		_ = os.Remove(name)
		return err
	}
	return nil
}

// ToSettings snapshots the manager state for persistence.
func (tp *TargetPlatform) ToSettings() TargetSettings {
	return TargetSettings{
		Format:   targetSettingsFormat,
		Version:  targetSettingsVersion,
		Active:   tp.Active,
		Profiles: append([]TargetProfile{}, tp.Profiles...),
	}
}

// LoadFromSettings restores the manager state from persisted settings and
// invalidates the bundle index cache.
func (tp *TargetPlatform) LoadFromSettings(settings TargetSettings) {
	tp.Profiles = append([]TargetProfile{}, settings.Profiles...)
	tp.Active = settings.Active
	tp.index = nil
}
