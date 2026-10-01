package ai

import (
	"encoding/json"
	"net/http"
	"net/url"
	"os"
	"path/filepath"
	"sort"
	"strings"
	"sync"
	"time"

	"golang.org/x/net/http/httpproxy"
)

// Claude Code settings discovery.
//
// Corporate users already keep their Anthropic gateway, credentials, proxy and
// model defaults in Claude Code settings files. adOmnia reads them from disk on
// demand (never copies them into its own settings) with this precedence, per
// variable:
//
//	real process environment > <workspace>/.claude/settings.local.json >
//	<workspace>/.claude/settings.json > ~/.claude/settings.json
//
// The process environment wins because it is the most explicit, per-launch
// choice (and matches how adOmnia already resolves provider keys). Values are
// kept in the Go process only; the renderer receives file paths and variable
// NAMES through ClaudeCodeStatus, never values.

// ClaudeCodeScope identifies which settings layer a value came from.
type ClaudeCodeScope string

const (
	ClaudeScopeProcess ClaudeCodeScope = "process"
	ClaudeScopeLocal   ClaudeCodeScope = "local"
	ClaudeScopeProject ClaudeCodeScope = "project"
	ClaudeScopeUser    ClaudeCodeScope = "user"
)

// claudeCodeRelevantKeys are the env names adOmnia understands. Status output
// lists only these so unrelated corporate variables are not echoed back.
var claudeCodeRelevantKeys = map[string]struct{}{
	"ANTHROPIC_API_KEY": {}, "ANTHROPIC_AUTH_TOKEN": {}, "ANTHROPIC_BASE_URL": {},
	"ANTHROPIC_MODEL": {}, "ANTHROPIC_CUSTOM_HEADERS": {},
	"HTTPS_PROXY": {}, "HTTP_PROXY": {}, "NO_PROXY": {},
	"https_proxy": {}, "http_proxy": {}, "no_proxy": {},
	"CLAUDE_CODE_USE_BEDROCK": {}, "ANTHROPIC_BEDROCK_BASE_URL": {},
	"AWS_REGION": {}, "AWS_PROFILE": {},
}

// Claude Code model aliases are not API model IDs; they are ignored as defaults.
var claudeCodeModelAliases = map[string]struct{}{
	"default": {}, "sonnet": {}, "opus": {}, "haiku": {}, "opusplan": {},
	"sonnet[1m]": {}, "opus[1m]": {},
}

type claudeSettingsData struct {
	env   map[string]string
	model string
}

type claudeSettingsEntry struct {
	modTime time.Time
	size    int64
	data    claudeSettingsData
	invalid bool
}

type claudeSettingsFile struct {
	path  string
	scope ClaudeCodeScope
	entry claudeSettingsEntry
}

var (
	claudeCacheMu sync.Mutex
	claudeCache   = map[string]claudeSettingsEntry{}
	// claudeFileReads counts actual disk reads (tests assert cache hits).
	claudeFileReads int
	// claudeUserHomeDir is swappable in tests.
	claudeUserHomeDir = os.UserHomeDir
	// claudeLookupEnv is swappable in tests.
	claudeLookupEnv = os.LookupEnv
)

// loadClaudeSettingsFile returns the parsed file, re-reading only when its
// mtime or size changed. ok is false when the file does not exist.
func loadClaudeSettingsFile(path string) (claudeSettingsEntry, bool) {
	info, err := os.Stat(path)
	if err != nil || info.IsDir() {
		claudeCacheMu.Lock()
		delete(claudeCache, path)
		claudeCacheMu.Unlock()
		return claudeSettingsEntry{}, false
	}
	claudeCacheMu.Lock()
	cached, hit := claudeCache[path]
	claudeCacheMu.Unlock()
	if hit && cached.modTime.Equal(info.ModTime()) && cached.size == info.Size() {
		return cached, true
	}

	entry := claudeSettingsEntry{modTime: info.ModTime(), size: info.Size()}
	raw, err := os.ReadFile(path)
	claudeCacheMu.Lock()
	claudeFileReads++
	claudeCacheMu.Unlock()
	if err != nil {
		entry.invalid = true
	} else {
		entry.data, entry.invalid = parseClaudeSettings(raw)
	}
	claudeCacheMu.Lock()
	claudeCache[path] = entry
	claudeCacheMu.Unlock()
	return entry, true
}

// parseClaudeSettings tolerates bad JSON (returns invalid=true, no data) and
// ignores non-string env values, as Claude Code does.
func parseClaudeSettings(raw []byte) (claudeSettingsData, bool) {
	var doc struct {
		Env   map[string]any `json:"env"`
		Model any            `json:"model"`
	}
	if err := json.Unmarshal(raw, &doc); err != nil {
		return claudeSettingsData{}, true
	}
	data := claudeSettingsData{env: map[string]string{}}
	for key, value := range doc.Env {
		switch v := value.(type) {
		case string:
			data.env[key] = v
		case float64, bool:
			raw, _ := json.Marshal(v)
			data.env[key] = string(raw)
		}
	}
	if model, ok := doc.Model.(string); ok {
		data.model = strings.TrimSpace(model)
	}
	return data, false
}

// claudeSettingsPaths lists candidate files, highest precedence first.
func claudeSettingsPaths(workspaceDir string) []claudeSettingsFile {
	files := make([]claudeSettingsFile, 0, 3)
	if dir := strings.TrimSpace(workspaceDir); dir != "" {
		if abs, err := filepath.Abs(dir); err == nil {
			files = append(files,
				claudeSettingsFile{path: filepath.Join(abs, ".claude", "settings.local.json"), scope: ClaudeScopeLocal},
				claudeSettingsFile{path: filepath.Join(abs, ".claude", "settings.json"), scope: ClaudeScopeProject},
			)
		}
	}
	if userDir := claudeUserConfigDir(); userDir != "" {
		userPath := filepath.Join(userDir, "settings.json")
		// A workspace inside the home directory may resolve to the user file.
		duplicate := false
		for _, f := range files {
			if strings.EqualFold(f.path, userPath) {
				duplicate = true
			}
		}
		if !duplicate {
			files = append(files, claudeSettingsFile{path: userPath, scope: ClaudeScopeUser})
		}
	}
	return files
}

// claudeUserConfigDir honours CLAUDE_CONFIG_DIR like Claude Code does.
func claudeUserConfigDir() string {
	if dir, ok := claudeLookupEnv("CLAUDE_CONFIG_DIR"); ok && strings.TrimSpace(dir) != "" {
		return strings.TrimSpace(dir)
	}
	home, err := claudeUserHomeDir()
	if err != nil || home == "" {
		return ""
	}
	return filepath.Join(home, ".claude")
}

// ClaudeCodeSettings is an immutable, layered snapshot of the detected files.
type ClaudeCodeSettings struct {
	files []claudeSettingsFile
}

// LoadClaudeCodeSettings discovers and (cache-)loads the settings layers for
// an optional workspace directory. An empty workspaceDir means user level only.
func LoadClaudeCodeSettings(workspaceDir string) ClaudeCodeSettings {
	candidates := claudeSettingsPaths(workspaceDir)
	found := make([]claudeSettingsFile, 0, len(candidates))
	for _, c := range candidates {
		if entry, ok := loadClaudeSettingsFile(c.path); ok {
			c.entry = entry
			found = append(found, c)
		}
	}
	return ClaudeCodeSettings{files: found}
}

// Lookup returns the first non-empty value for key: process env, then files.
func (s ClaudeCodeSettings) Lookup(key string) (string, ClaudeCodeScope) {
	if value, ok := claudeLookupEnv(key); ok && strings.TrimSpace(value) != "" {
		return strings.TrimSpace(value), ClaudeScopeProcess
	}
	return s.fileLookup(key)
}

func (s ClaudeCodeSettings) fileLookup(key string) (string, ClaudeCodeScope) {
	for _, f := range s.files {
		if value := strings.TrimSpace(f.entry.data.env[key]); value != "" {
			return value, f.scope
		}
	}
	return "", ""
}

// Model returns the default model: ANTHROPIC_MODEL (env layers) first, then the
// top-level "model" key. Claude Code aliases ("opus", "sonnet"…) are skipped.
func (s ClaudeCodeSettings) Model() string {
	if value, _ := s.Lookup("ANTHROPIC_MODEL"); value != "" && !isClaudeModelAlias(value) {
		return value
	}
	for _, f := range s.files {
		if value := f.entry.data.model; value != "" && !isClaudeModelAlias(value) {
			return value
		}
	}
	return ""
}

func isClaudeModelAlias(model string) bool {
	_, ok := claudeCodeModelAliases[strings.ToLower(strings.TrimSpace(model))]
	return ok
}

// UsesBedrock reports CLAUDE_CODE_USE_BEDROCK as a truthy flag.
func (s ClaudeCodeSettings) UsesBedrock() bool {
	value, _ := s.Lookup("CLAUDE_CODE_USE_BEDROCK")
	switch strings.ToLower(value) {
	case "1", "true", "yes", "on":
		return true
	}
	return false
}

// CustomHeaders parses ANTHROPIC_CUSTOM_HEADERS ("Name: value" per line).
func (s ClaudeCodeSettings) CustomHeaders() http.Header {
	raw, _ := s.Lookup("ANTHROPIC_CUSTOM_HEADERS")
	headers := http.Header{}
	for _, line := range strings.FieldsFunc(raw, func(r rune) bool { return r == '\n' || r == '\r' }) {
		name, value, ok := strings.Cut(line, ":")
		name = strings.TrimSpace(name)
		if !ok || name == "" || strings.ContainsAny(name, " \t") {
			continue
		}
		headers.Add(name, strings.TrimSpace(value))
	}
	return headers
}

// ProxyFunc builds a proxy selector from HTTPS_PROXY/HTTP_PROXY/NO_PROXY
// (upper or lower case), process env first then files. os env is not mutated.
func (s ClaudeCodeSettings) ProxyFunc() func(*http.Request) (*url.URL, error) {
	pick := func(upper, lower string) string {
		if value, ok := claudeLookupEnv(upper); ok && strings.TrimSpace(value) != "" {
			return strings.TrimSpace(value)
		}
		if value, ok := claudeLookupEnv(lower); ok && strings.TrimSpace(value) != "" {
			return strings.TrimSpace(value)
		}
		if value, _ := s.fileLookup(upper); value != "" {
			return value
		}
		value, _ := s.fileLookup(lower)
		return value
	}
	cfg := httpproxy.Config{
		HTTPProxy:  pick("HTTP_PROXY", "http_proxy"),
		HTTPSProxy: pick("HTTPS_PROXY", "https_proxy"),
		NoProxy:    pick("NO_PROXY", "no_proxy"),
	}
	fn := cfg.ProxyFunc()
	return func(req *http.Request) (*url.URL, error) { return fn(req.URL) }
}

// HTTPClient returns a client whose transport honours the layered proxy.
func (s ClaudeCodeSettings) HTTPClient(timeout time.Duration) *http.Client {
	transport := http.DefaultTransport.(*http.Transport).Clone()
	transport.Proxy = s.ProxyFunc()
	return &http.Client{Transport: transport, Timeout: timeout}
}

// ClaudeCodeFileStatus is the renderer-safe description of one detected file.
type ClaudeCodeFileStatus struct {
	Path        string   `json:"path"`
	DisplayPath string   `json:"displayPath"`
	Scope       string   `json:"scope"`
	EnvKeys     []string `json:"envKeys"`
	HasModel    bool     `json:"hasModel"`
	Invalid     bool     `json:"invalid,omitempty"`
}

// ClaudeCodeStatus is safe to send to the renderer: names only, never values.
type ClaudeCodeStatus struct {
	Files []ClaudeCodeFileStatus `json:"files"`
}

// Status lists detected files with the relevant variable names they define.
func (s ClaudeCodeSettings) Status() ClaudeCodeStatus {
	status := ClaudeCodeStatus{Files: make([]ClaudeCodeFileStatus, 0, len(s.files))}
	home, _ := claudeUserHomeDir()
	for _, f := range s.files {
		keys := make([]string, 0, len(f.entry.data.env))
		for key := range f.entry.data.env {
			if _, ok := claudeCodeRelevantKeys[key]; ok {
				keys = append(keys, key)
			}
		}
		sort.Strings(keys)
		status.Files = append(status.Files, ClaudeCodeFileStatus{
			Path: f.path, DisplayPath: displayClaudePath(f.path, home), Scope: string(f.scope),
			EnvKeys: keys, HasModel: f.entry.data.model != "", Invalid: f.entry.invalid,
		})
	}
	return status
}

func displayClaudePath(path, home string) string {
	if home == "" {
		return path
	}
	if rel, err := filepath.Rel(home, path); err == nil && !strings.HasPrefix(rel, "..") && !filepath.IsAbs(rel) {
		return "~/" + filepath.ToSlash(rel)
	}
	return path
}

// DefaultClaudeWorkspaceDir is the project directory used when none is given.
func DefaultClaudeWorkspaceDir() string { return claudeWorkspaceDir("") }

// claudeWorkspaceDir resolves the project directory for project-level files:
// the explicit config value, else the process working directory (the same
// root adOmnia already uses for .env discovery).
func claudeWorkspaceDir(explicit string) string {
	if dir := strings.TrimSpace(explicit); dir != "" {
		return dir
	}
	if cwd, err := os.Getwd(); err == nil {
		return cwd
	}
	return ""
}
