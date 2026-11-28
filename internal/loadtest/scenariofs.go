package loadtest

import (
	"encoding/json/jsontext"
	"encoding/json/v2"
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"slices"
	"strings"
)

// ScenarioFileEntry is one scenario file of a workspace folder.
type ScenarioFileEntry struct {
	Name   string `json:"name"`
	Path   string `json:"path"`
	Target string `json:"target"`
	Error  string `json:"error,omitempty"` // the file is there but cannot be read
}

func workspaceDir(folder string) (string, error) {
	folder = strings.TrimSpace(folder)
	if folder == "" {
		return "", errors.New("choose the workspace folder first")
	}
	info, err := os.Stat(folder)
	if err != nil || !info.IsDir() {
		return "", fmt.Errorf("%s is not a folder", folder)
	}
	return filepath.Join(folder, filepath.FromSlash(ScenarioDir)), nil
}

// SaveScenarioFile writes f to <folder>/.adomnia/loadtests/<name>.loadtest.json.
func SaveScenarioFile(folder string, f ScenarioFile) (string, error) {
	dir, err := workspaceDir(folder)
	if err != nil {
		return "", err
	}
	name, err := ScenarioFileName(f.Name)
	if err != nil {
		return "", err
	}
	data, err := f.Encode()
	if err != nil {
		return "", err
	}
	if err := os.MkdirAll(dir, 0o755); err != nil {
		return "", fmt.Errorf("create %s: %w", ScenarioDir, err)
	}
	path := filepath.Join(dir, name)
	if err := os.WriteFile(path, data, 0o644); err != nil { //nolint:gosec // a workspace file meant for Git
		return "", fmt.Errorf("write scenario: %w", err)
	}
	return path, nil
}

// ListScenarioFiles lists the scenario files of a workspace folder by name.
func ListScenarioFiles(folder string) ([]ScenarioFileEntry, error) {
	dir, err := workspaceDir(folder)
	if err != nil {
		return nil, err
	}
	entries, err := os.ReadDir(dir)
	if errors.Is(err, os.ErrNotExist) {
		return []ScenarioFileEntry{}, nil
	}
	if err != nil {
		return nil, fmt.Errorf("read %s: %w", ScenarioDir, err)
	}
	out := []ScenarioFileEntry{}
	for _, e := range entries {
		if e.IsDir() || !strings.HasSuffix(e.Name(), ".loadtest.json") {
			continue
		}
		path := filepath.Join(dir, e.Name())
		entry := ScenarioFileEntry{Name: strings.TrimSuffix(e.Name(), ".loadtest.json"), Path: path}
		if f, err := ReadScenarioFile(path); err != nil {
			entry.Error = err.Error()
		} else {
			entry.Name, entry.Target = f.Name, f.Target.Kind
		}
		out = append(out, entry)
	}
	slices.SortFunc(out, func(a, b ScenarioFileEntry) int {
		return strings.Compare(strings.ToLower(a.Name), strings.ToLower(b.Name))
	})
	return out, nil
}

// ReadScenarioFile reads a scenario file.
func ReadScenarioFile(path string) (ScenarioFile, error) {
	if !strings.HasSuffix(path, ".loadtest.json") {
		return ScenarioFile{}, errors.New("a scenario file ends in .loadtest.json")
	}
	data, err := os.ReadFile(path) //nolint:gosec // a path the user picked or listed
	if err != nil {
		return ScenarioFile{}, fmt.Errorf("read scenario: %w", err)
	}
	return ParseScenarioFile(data)
}

// Legacy drawer scenarios (bbolt workspace/scenario/<name>): settings stored as sent.

const legacyScenarioPrefix = "scenario/"

// SavedScenarios lists the drawer's saved settings.
func (h *History) SavedScenarios() ([]string, error) {
	keys, err := h.List("workspace", legacyScenarioPrefix)
	if err != nil {
		return nil, fmt.Errorf("list scenarios: %w", err)
	}
	out := make([]string, 0, len(keys))
	for _, k := range keys {
		out = append(out, strings.TrimPrefix(k, legacyScenarioPrefix))
	}
	return out, nil
}

// SaveSettings stores the drawer's settings under name.
func (h *History) SaveSettings(name string, config jsontext.Value) error {
	name = strings.TrimSpace(name)
	if name == "" || len(config) == 0 || !config.IsValid() {
		return errors.New("a scenario needs a name and its settings")
	}
	return h.Put("workspace", legacyScenarioPrefix+name, config)
}

// LoadSettings returns the drawer's settings saved under name.
func (h *History) LoadSettings(name string) (jsontext.Value, error) {
	data, err := h.Get("workspace", legacyScenarioPrefix+name)
	if err != nil {
		return nil, fmt.Errorf("load scenario: %w", err)
	}
	if data == nil {
		return nil, errors.New("scenario not found")
	}
	return data, nil
}

// MigrateLegacyResults moves the results the drawer saved by name (workspace/ltresult/) into
// the history once. The old keys stay, as every migration in adOmnia does.
func (h *History) MigrateLegacyResults() {
	const marker = "migrated:ltresult"
	if done, _ := h.Get(historyBucket, marker); done != nil {
		return
	}
	keys, _ := h.List("workspace", "ltresult/")
	for _, k := range keys {
		data, err := h.Get("workspace", k)
		if err != nil || data == nil {
			continue
		}
		var saved struct {
			Name      string `json:"name"`
			Timestamp string `json:"timestamp"`
			URL       string `json:"url"`
			Method    string `json:"method"`
			Result    Result `json:"result"`
		}
		if json.Unmarshal(data, &saved) != nil {
			continue
		}
		r := saved.Result
		r.Name = saved.Name
		if r.StartedAt == "" {
			r.StartedAt = saved.Timestamp
		}
		if r.Manifest == nil {
			r.Manifest = &Manifest{Target: "request", TargetLabel: strings.TrimSpace(saved.Method + " " + saved.URL)}
		}
		_, _ = h.Import(r) // one unreadable entry must not stop the others
	}
	_ = h.Put(historyBucket, marker, []byte("1")) // retried next start if it fails
}
