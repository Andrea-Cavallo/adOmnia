// plugins.go — Plugin system with JSON manifests, hook registration, event bus, and lifecycle management.
// Plugins are directories containing a manifest.json + optional scripts/assets.

package plugins

import (
	"adomnia/internal/storage"
	"encoding/base64"
	"encoding/json"
	"fmt"
	"io/fs"
	"log"
	"os"
	"path/filepath"
	"regexp"
	"strings"
	"sync"
	"time"

	bolt "go.etcd.io/bbolt"
)

var dataDirectory string

// Configure supplies the local application directory used for plugin assets.
func Configure(dataDir string) {
	dataDirectory = dataDir
}

// AvailableHookEvents lists all hookable events in the plugin system.
var AvailableHookEvents = []string{
	"onRequest",
	"onResponse",
	"onSend",
	"onSave",
	"onImport",
	"onExport",
	"onStartup",
	"onShutdown",
	"onThemeChange",
	"onEnvChange",
	"onTabOpen",
	"onTabClose",
}

// PluginManifest describes a plugin's metadata and capabilities.
type PluginManifest struct {
	ID            string          `json:"id"`
	Name          string          `json:"name"`
	Version       string          `json:"version"`
	Author        string          `json:"author"`
	Description   string          `json:"description"`
	Homepage      string          `json:"homepage"`
	License       string          `json:"license"`
	MinAppVersion string          `json:"minAppVersion"`
	Runtime       string          `json:"runtime"`
	Permissions   []string        `json:"permissions"`
	Hooks         []PluginHook    `json:"hooks"`
	Settings      []PluginSetting `json:"settings"`
	EntryPoint    string          `json:"entryPoint"`
	Icon          string          `json:"icon"`
	UISlots       []string        `json:"ui_slots,omitempty"`
	Actions       []PluginAction  `json:"actions,omitempty"`
}

// UnmarshalJSON accepts both entryPoint and entrypoint for compatibility with
// older local manifests that predate the camel-case manifest key.
func (m *PluginManifest) UnmarshalJSON(data []byte) error {
	type manifestAlias PluginManifest
	var value manifestAlias
	if err := json.Unmarshal(data, &value); err != nil {
		return err
	}
	*m = PluginManifest(value)
	var legacy struct {
		Entrypoint string `json:"entrypoint"`
	}
	if err := json.Unmarshal(data, &legacy); err != nil {
		return err
	}
	if m.EntryPoint == "" {
		m.EntryPoint = legacy.Entrypoint
	}
	return nil
}

// PluginAction defines an executable action exposed in a plugin panel.
type PluginAction struct {
	ID          string `json:"id"`
	Name        string `json:"name"`
	Description string `json:"description"`
	Streaming   bool   `json:"streaming"`
}

// PluginHook maps an event to a handler function name in the plugin entry point.
type PluginHook struct {
	Event   string `json:"event"`
	Handler string `json:"handler"`
}

// UnmarshalJSON accepts both the compact "onSend" form and the expanded
// {"event":"onSend","handler":"..."} form.
func (h *PluginHook) UnmarshalJSON(data []byte) error {
	var event string
	if err := json.Unmarshal(data, &event); err == nil {
		h.Event = event
		h.Handler = event
		return nil
	}
	type hookAlias PluginHook
	var value hookAlias
	if err := json.Unmarshal(data, &value); err != nil {
		return err
	}
	*h = PluginHook(value)
	if h.Handler == "" {
		h.Handler = h.Event
	}
	return nil
}

// PluginSetting defines a configurable setting for a plugin.
type PluginSetting struct {
	Key         string   `json:"key"`
	Label       string   `json:"label"`
	Type        string   `json:"type"`
	Default     string   `json:"default"`
	Options     []string `json:"options,omitempty"`
	Description string   `json:"description"`
}

// UnmarshalJSON normalizes string, boolean and numeric default values into
// the string settings storage used by the existing UI and persistence layer.
func (s *PluginSetting) UnmarshalJSON(data []byte) error {
	type rawSetting struct {
		Key         string          `json:"key"`
		Label       string          `json:"label"`
		Type        string          `json:"type"`
		Default     json.RawMessage `json:"default"`
		Options     []string        `json:"options,omitempty"`
		Description string          `json:"description"`
	}
	var raw rawSetting
	if err := json.Unmarshal(data, &raw); err != nil {
		return err
	}
	s.Key, s.Label, s.Type, s.Options, s.Description = raw.Key, raw.Label, raw.Type, raw.Options, raw.Description
	if len(raw.Default) == 0 || string(raw.Default) == "null" {
		return nil
	}
	var stringValue string
	if err := json.Unmarshal(raw.Default, &stringValue); err == nil {
		s.Default = stringValue
		return nil
	}
	var value interface{}
	if err := json.Unmarshal(raw.Default, &value); err != nil {
		return err
	}
	s.Default = fmt.Sprint(value)
	return nil
}

// PluginInstance represents an installed plugin with its runtime state.
type PluginInstance struct {
	Manifest    PluginManifest    `json:"manifest"`
	Enabled     bool              `json:"enabled"`
	Settings    map[string]string `json:"settings"`
	InstallDir  string            `json:"installDir"`
	InstalledAt string            `json:"installedAt"`
	Error       string            `json:"error,omitempty"`
}

// PluginEvent carries event data through the hook system.
type PluginEvent struct {
	Type    string                 `json:"type"`
	Payload map[string]interface{} `json:"payload"`
}

// HookResult is the outcome of a hook invocation.
type HookResult struct {
	Modified bool                   `json:"modified"`
	Data     map[string]interface{} `json:"data,omitempty"`
	Error    string                 `json:"error,omitempty"`
}

func hookResultFromData(data interface{}) HookResult {
	value, ok := data.(map[string]interface{})
	if !ok || value == nil {
		return HookResult{}
	}
	modified, _ := value["modified"].(bool)
	result := HookResult{Modified: modified}
	if rawData, ok := value["data"].(map[string]interface{}); ok {
		result.Data = rawData
	}
	if rawError, ok := value["error"].(string); ok {
		result.Error = rawError
	}
	if result.Modified && result.Data == nil && result.Error == "" {
		result.Error = "hook returned modified=true without an object data field"
		result.Modified = false
	}
	return result
}

// pluginHookEntry maps a registered hook to a plugin and handler function.
type pluginHookEntry struct {
	PluginID string
	Handler  string
}

// PluginManager manages plugin lifecycle, hooks, and event dispatch.
type PluginManager struct {
	mu        sync.RWMutex
	plugins   map[string]*PluginInstance
	eventBus  chan PluginEvent
	hooks     map[string][]pluginHookEntry
	pluginDir string
	stopCh    chan struct{}
	runtime   *WasmRuntime
}

// pluginIDPattern intentionally excludes dots to prevent path traversal via ".." segments.
var pluginIDPattern = regexp.MustCompile(`^[a-zA-Z0-9][a-zA-Z0-9_-]{0,63}$`)

const (
	maxPluginPackageBytes = 64 << 20
	maxPluginPackageFiles = 4096
)

// isUnderDir returns true when target (after Abs resolution) is inside base.
// Used to guard against path-traversal attacks where a crafted ID escapes pluginDir.
func isUnderDir(base, target string) bool {
	absBase, err := filepath.Abs(base)
	if err != nil {
		return false
	}
	absTarget, err := filepath.Abs(target)
	if err != nil {
		return false
	}
	rel, err := filepath.Rel(absBase, absTarget)
	if err != nil {
		return false
	}
	return rel != ".." && !strings.HasPrefix(rel, ".."+string(filepath.Separator))
}

func rejectSymlinkPath(base, target string) error {
	rel, err := filepath.Rel(base, target)
	if err != nil || rel == ".." || strings.HasPrefix(rel, ".."+string(filepath.Separator)) {
		return fmt.Errorf("path escapes plugin directory")
	}
	current := base
	for _, part := range strings.Split(rel, string(filepath.Separator)) {
		if part == "" || part == "." {
			continue
		}
		current = filepath.Join(current, part)
		info, err := os.Lstat(current)
		if os.IsNotExist(err) {
			return nil
		}
		if err != nil {
			return err
		}
		if info.Mode()&os.ModeSymlink != 0 {
			return fmt.Errorf("plugin path contains a symbolic link: %s", rel)
		}
	}
	return nil
}

func ResolvePluginEntryPoint(pluginDir, entryPoint string) (string, error) {
	entryPoint = strings.TrimSpace(entryPoint)
	if entryPoint == "" {
		return "", fmt.Errorf("plugin entryPoint is required")
	}
	target := entryPoint
	if !filepath.IsAbs(target) {
		target = filepath.Join(pluginDir, entryPoint)
	}
	target = filepath.Clean(target)
	if !isUnderDir(pluginDir, target) {
		return "", fmt.Errorf("plugin entryPoint escapes plugin directory: %s", entryPoint)
	}
	if err := rejectSymlinkPath(pluginDir, target); err != nil {
		return "", fmt.Errorf("invalid plugin entryPoint %s: %w", entryPoint, err)
	}
	return target, nil
}

func normalizePluginManifest(manifest *PluginManifest) error {
	if manifest.ID == "" {
		return fmt.Errorf("manifest must have an id field")
	}
	if !pluginIDPattern.MatchString(manifest.ID) {
		return fmt.Errorf("plugin id must match ^[a-zA-Z0-9][a-zA-Z0-9_-]{0,63}$ (no dots or path separators)")
	}
	if manifest.Name == "" {
		manifest.Name = manifest.ID
	}
	if manifest.Version == "" {
		manifest.Version = "1.0.0"
	}
	if manifest.Author == "" {
		manifest.Author = "Local"
	}
	if manifest.MinAppVersion == "" {
		manifest.MinAppVersion = "0.1.0"
	}
	if manifest.Permissions == nil {
		manifest.Permissions = []string{}
	}
	if manifest.Hooks == nil {
		manifest.Hooks = []PluginHook{}
	}
	if manifest.Settings == nil {
		manifest.Settings = []PluginSetting{}
	}
	if manifest.UISlots == nil {
		manifest.UISlots = []string{}
	}
	if manifest.Actions == nil {
		manifest.Actions = []PluginAction{}
	}
	manifest.Runtime = strings.ToLower(strings.TrimSpace(manifest.Runtime))
	if manifest.Runtime == "python" {
		return fmt.Errorf("python plugin runtime is no longer supported")
	}
	if manifest.Runtime == "javascript" {
		manifest.Runtime = "js"
	}
	if manifest.Runtime == "" {
		switch strings.ToLower(filepath.Ext(manifest.EntryPoint)) {
		case ".js", ".mjs", ".cjs":
			manifest.Runtime = "js"
		case ".wasm":
			manifest.Runtime = "wasm"
		default:
			manifest.Runtime = "none"
		}
	}
	if manifest.Runtime != "js" && manifest.Runtime != "wasm" && manifest.Runtime != "none" {
		return fmt.Errorf("unsupported plugin runtime: %s", manifest.Runtime)
	}
	if manifest.EntryPoint == "" {
		if manifest.Runtime == "js" {
			manifest.EntryPoint = "main.js"
		} else if manifest.Runtime == "wasm" {
			manifest.EntryPoint = "plugin.wasm"
		}
	}
	if manifest.Runtime == "none" && (len(manifest.Hooks) > 0 || len(manifest.Actions) > 0) {
		return fmt.Errorf("runtime none cannot declare hooks or actions")
	}
	return nil
}

func validateExecutableRuntime(manifest PluginManifest) error {
	if manifest.Runtime == "wasm" {
		return fmt.Errorf("WASM plugins are not executable in this build; use runtime js")
	}
	if manifest.Runtime != "js" && manifest.Runtime != "none" {
		return fmt.Errorf("unsupported plugin runtime: %s", manifest.Runtime)
	}
	return nil
}

func validatePluginEntrypoint(inst *PluginInstance) error {
	if err := validateExecutableRuntime(inst.Manifest); err != nil {
		return err
	}
	if inst.Manifest.Runtime == "none" {
		return nil
	}
	entryPoint, err := ResolvePluginEntryPoint(inst.InstallDir, inst.Manifest.EntryPoint)
	if err != nil {
		return err
	}
	info, err := os.Lstat(entryPoint)
	if err != nil {
		return fmt.Errorf("plugin entrypoint is unavailable: %w", err)
	}
	if !info.Mode().IsRegular() {
		return fmt.Errorf("plugin entrypoint is not a regular file: %s", inst.Manifest.EntryPoint)
	}
	return nil
}

// AttachRuntime connects lifecycle management and execution. It is kept as a
// package function so it is not exposed as a Wails binding.
func AttachRuntime(pm *PluginManager, runtime *WasmRuntime) {
	pm.mu.Lock()
	pm.runtime = runtime
	pm.mu.Unlock()
	runtime.attachManager(pm)
}

// NewPluginManager creates a new PluginManager instance.
func NewPluginManager() *PluginManager {
	return &PluginManager{
		plugins:  make(map[string]*PluginInstance),
		eventBus: make(chan PluginEvent, 64),
		hooks:    make(map[string][]pluginHookEntry),
		stopCh:   make(chan struct{}),
	}
}

// Init scans the plugin directory, loads manifests, and registers hooks for enabled plugins.
func (pm *PluginManager) Init() error {
	pm.mu.Lock()
	defer pm.mu.Unlock()
	if pm.runtime != nil {
		if err := pm.runtime.Init(); err != nil {
			return fmt.Errorf("failed to initialize plugin runtime: %w", err)
		}
	}

	pm.pluginDir = filepath.Join(dataDirectory, "plugins")
	if err := os.MkdirAll(pm.pluginDir, 0755); err != nil {
		return fmt.Errorf("failed to create plugin directory: %w", err)
	}

	// Ensure bbolt bucket exists
	if storage.DB() != nil {
		err := storage.DB().Update(func(tx *bolt.Tx) error {
			_, err := tx.CreateBucketIfNotExists([]byte("plugins"))
			if err != nil {
				return err
			}
			_, err = tx.CreateBucketIfNotExists([]byte("plugin_storage"))
			return err
		})
		if err != nil {
			return fmt.Errorf("failed to create plugins bucket: %w", err)
		}
	}

	// Load persisted state first
	if err := pm.loadPluginStateInternal(); err != nil {
		log.Printf("[plugins] warning: failed to load persisted state: %v", err)
	}

	// Scan plugin directory for manifests
	entries, err := os.ReadDir(pm.pluginDir)
	if err != nil {
		return fmt.Errorf("failed to read plugin directory: %w", err)
	}

	for _, entry := range entries {
		if !entry.IsDir() {
			continue
		}
		manifestPath := filepath.Join(pm.pluginDir, entry.Name(), "manifest.json")
		data, err := os.ReadFile(manifestPath)
		if err != nil {
			log.Printf("[plugins] skipping %s: no manifest.json", entry.Name())
			continue
		}

		var manifest PluginManifest
		if err := json.Unmarshal(data, &manifest); err != nil {
			log.Printf("[plugins] skipping %s: invalid manifest: %v", entry.Name(), err)
			continue
		}

		if manifest.ID == "" {
			manifest.ID = entry.Name()
		}
		if err := normalizePluginManifest(&manifest); err != nil {
			log.Printf("[plugins] skipping %s: invalid manifest: %v", entry.Name(), err)
			continue
		}
		installDir := filepath.Join(pm.pluginDir, entry.Name())
		if manifest.Runtime != "none" {
			if _, err := ResolvePluginEntryPoint(installDir, manifest.EntryPoint); err != nil {
				log.Printf("[plugins] skipping %s: invalid entrypoint: %v", entry.Name(), err)
				continue
			}
		}

		// Merge with persisted state if it exists
		if existing, ok := pm.plugins[manifest.ID]; ok {
			existing.Manifest = manifest
			existing.InstallDir = installDir
			existing.Error = ""
			if existing.InstalledAt == "" {
				existing.InstalledAt = time.Now().UTC().Format(time.RFC3339)
			}
		} else {
			instance := &PluginInstance{
				Manifest:    manifest,
				Enabled:     false,
				Settings:    make(map[string]string),
				InstallDir:  installDir,
				InstalledAt: time.Now().UTC().Format(time.RFC3339),
			}
			// Apply default settings
			for _, s := range manifest.Settings {
				instance.Settings[s.Key] = s.Default
			}
			pm.plugins[manifest.ID] = instance
		}
		if inst := pm.plugins[manifest.ID]; inst != nil {
			if err := validatePluginEntrypoint(inst); err != nil {
				inst.Error = err.Error()
			}
		}
	}

	// Register hooks for enabled plugins
	for _, inst := range pm.plugins {
		if inst.Enabled {
			pm.registerHooksInternal(inst)
		}
	}

	log.Printf("[plugins] initialized: %d plugins loaded from %s", len(pm.plugins), pm.pluginDir)
	go pm.eventDispatchLoop()
	log.Printf("[plugins] event dispatch loop started")
	return nil
}

// GetPlugins returns all installed plugins.
func (pm *PluginManager) GetPlugins() []PluginInstance {
	pm.mu.RLock()
	defer pm.mu.RUnlock()

	result := make([]PluginInstance, 0, len(pm.plugins))
	for _, inst := range pm.plugins {
		result = append(result, *inst)
	}
	return result
}

// GetPlugin returns a single plugin by ID.
func (pm *PluginManager) GetPlugin(id string) (*PluginInstance, error) {
	pm.mu.RLock()
	defer pm.mu.RUnlock()

	inst, ok := pm.plugins[id]
	if !ok {
		return nil, fmt.Errorf("plugin not found: %s", id)
	}
	return inst, nil
}

func (pm *PluginManager) pluginForExecution(id string) (PluginInstance, error) {
	pm.mu.RLock()
	inst, ok := pm.plugins[id]
	if !ok {
		pm.mu.RUnlock()
		return PluginInstance{}, fmt.Errorf("plugin not found: %s", id)
	}
	copy := *inst
	copy.Settings = make(map[string]string, len(inst.Settings))
	for key, value := range inst.Settings {
		copy.Settings[key] = value
	}
	pm.mu.RUnlock()

	if !copy.Enabled {
		return PluginInstance{}, fmt.Errorf("plugin is disabled: %s", id)
	}
	if copy.Manifest.Runtime == "none" {
		return PluginInstance{}, fmt.Errorf("plugin has no executable runtime: %s", id)
	}
	if err := validatePluginEntrypoint(&copy); err != nil {
		return PluginInstance{}, err
	}
	return copy, nil
}

// ExecuteAction invokes an action declared by an enabled plugin.
func (pm *PluginManager) ExecuteAction(pluginID, actionID string, args map[string]interface{}) ExecResult {
	pm.mu.RLock()
	inst, ok := pm.plugins[pluginID]
	runtime := pm.runtime
	declared := false
	if ok {
		for _, action := range inst.Manifest.Actions {
			if action.ID == actionID {
				declared = true
				break
			}
		}
	}
	pm.mu.RUnlock()
	if !ok {
		return failedExecResult(fmt.Errorf("plugin not found: %s", pluginID))
	}
	if !declared {
		return failedExecResult(fmt.Errorf("plugin action is not declared: %s", actionID))
	}
	if runtime == nil {
		return failedExecResult(fmt.Errorf("plugin runtime is not initialized"))
	}
	if args == nil {
		args = map[string]interface{}{}
	}
	return runtime.Execute(ExecRequest{PluginID: pluginID, Function: actionID, Args: args})
}

// InstallPlugin installs a plugin from manifest JSON, creating its directory and saving manifest.json.
func (pm *PluginManager) InstallPlugin(manifestJSON string) (*PluginInstance, error) {
	var manifest PluginManifest
	if err := json.Unmarshal([]byte(manifestJSON), &manifest); err != nil {
		return nil, fmt.Errorf("invalid manifest JSON: %w", err)
	}

	if err := normalizePluginManifest(&manifest); err != nil {
		return nil, err
	}
	if err := validateExecutableRuntime(manifest); err != nil {
		return nil, err
	}

	pm.mu.Lock()
	defer pm.mu.Unlock()

	if _, exists := pm.plugins[manifest.ID]; exists {
		return nil, fmt.Errorf("plugin already installed: %s", manifest.ID)
	}

	// Create plugin directory — verify the resolved path stays inside pm.pluginDir.
	pluginPath := filepath.Join(pm.pluginDir, manifest.ID)
	if !isUnderDir(pm.pluginDir, pluginPath) {
		return nil, fmt.Errorf("plugin id escapes plugin directory: %s", manifest.ID)
	}
	if manifest.Runtime != "none" {
		if _, err := ResolvePluginEntryPoint(pluginPath, manifest.EntryPoint); err != nil {
			return nil, err
		}
	}
	if err := os.MkdirAll(pluginPath, 0755); err != nil {
		return nil, fmt.Errorf("failed to create plugin directory: %w", err)
	}

	// Write manifest.json
	manifestData, err := json.MarshalIndent(manifest, "", "  ")
	if err != nil {
		return nil, fmt.Errorf("failed to marshal manifest: %w", err)
	}
	if err := os.WriteFile(filepath.Join(pluginPath, "manifest.json"), manifestData, 0644); err != nil {
		os.RemoveAll(pluginPath)
		return nil, fmt.Errorf("failed to write manifest: %w", err)
	}

	instance := &PluginInstance{
		Manifest:    manifest,
		Enabled:     false,
		Settings:    make(map[string]string),
		InstallDir:  pluginPath,
		InstalledAt: time.Now().UTC().Format(time.RFC3339),
	}
	if err := validatePluginEntrypoint(instance); err != nil {
		instance.Error = err.Error()
	}

	// Apply default settings
	for _, s := range manifest.Settings {
		instance.Settings[s.Key] = s.Default
	}

	pm.plugins[manifest.ID] = instance

	if err := pm.savePluginStateInternal(); err != nil {
		log.Printf("[plugins] warning: failed to persist state after install: %v", err)
	}

	log.Printf("[plugins] installed: %s v%s", manifest.Name, manifest.Version)
	return instance, nil
}

// InstallPluginPackage installs a complete local plugin folder. File contents
// are provided as base64 so JavaScript files and assets survive the desktop
// bridge without browser filesystem assumptions.
func (pm *PluginManager) InstallPluginPackage(manifestJSON string, encodedFiles map[string]string) (*PluginInstance, error) {
	var manifest PluginManifest
	if err := json.Unmarshal([]byte(manifestJSON), &manifest); err != nil {
		return nil, fmt.Errorf("invalid manifest JSON: %w", err)
	}
	if err := normalizePluginManifest(&manifest); err != nil {
		return nil, err
	}
	if err := validateExecutableRuntime(manifest); err != nil {
		return nil, err
	}

	if len(encodedFiles) > maxPluginPackageFiles {
		return nil, fmt.Errorf("plugin package contains too many files (max %d)", maxPluginPackageFiles)
	}
	files := make(map[string][]byte, len(encodedFiles))
	var packageBytes int64
	for relativePath, encoded := range encodedFiles {
		relativePath = filepath.Clean(filepath.FromSlash(relativePath))
		if filepath.IsAbs(relativePath) || relativePath == "." || relativePath == ".." || strings.HasPrefix(relativePath, ".."+string(filepath.Separator)) {
			return nil, fmt.Errorf("invalid plugin package path: %s", relativePath)
		}
		data, err := base64.StdEncoding.DecodeString(encoded)
		if err != nil {
			return nil, fmt.Errorf("invalid plugin file encoding for %s: %w", relativePath, err)
		}
		packageBytes += int64(len(data))
		if packageBytes > maxPluginPackageBytes {
			return nil, fmt.Errorf("plugin package exceeds %d MiB", maxPluginPackageBytes>>20)
		}
		files[relativePath] = data
	}

	entryPoint := filepath.Clean(filepath.FromSlash(manifest.EntryPoint))
	if manifest.Runtime != "" && manifest.Runtime != "none" && manifest.EntryPoint != "" {
		if _, ok := files[entryPoint]; !ok {
			return nil, fmt.Errorf("plugin package must include entrypoint %s", manifest.EntryPoint)
		}
	}

	pm.mu.RLock()
	instance, repairing := pm.plugins[manifest.ID]
	pm.mu.RUnlock()

	created := false
	if !repairing {
		var err error
		instance, err = pm.InstallPlugin(manifestJSON)
		if err != nil {
			return nil, err
		}
		created = true
	} else if !isUnderDir(pm.pluginDir, instance.InstallDir) {
		return nil, fmt.Errorf("refusing to repair plugin outside plugin dir: %s", manifest.ID)
	}

	rollbackNewInstall := func() {
		if created {
			_ = pm.UninstallPlugin(manifest.ID)
		}
	}

	for relativePath, data := range files {
		if strings.EqualFold(relativePath, "manifest.json") {
			continue
		}
		target := filepath.Join(instance.InstallDir, relativePath)
		if !isUnderDir(instance.InstallDir, target) {
			rollbackNewInstall()
			return nil, fmt.Errorf("plugin file escapes install directory: %s", relativePath)
		}
		if err := rejectSymlinkPath(instance.InstallDir, target); err != nil {
			rollbackNewInstall()
			return nil, fmt.Errorf("unsafe plugin package path %s: %w", relativePath, err)
		}
		if err := os.MkdirAll(filepath.Dir(target), 0755); err != nil {
			rollbackNewInstall()
			return nil, fmt.Errorf("failed to create plugin file directory: %w", err)
		}
		if err := os.WriteFile(target, data, 0644); err != nil {
			rollbackNewInstall()
			return nil, fmt.Errorf("failed to install plugin file %s: %w", relativePath, err)
		}
	}

	if repairing {
		manifestData, err := json.MarshalIndent(manifest, "", "  ")
		if err != nil {
			return nil, fmt.Errorf("failed to marshal repaired manifest: %w", err)
		}
		manifestPath := filepath.Join(instance.InstallDir, "manifest.json")
		if err := rejectSymlinkPath(instance.InstallDir, manifestPath); err != nil {
			return nil, fmt.Errorf("unsafe repaired manifest path: %w", err)
		}
		if err := os.WriteFile(manifestPath, manifestData, 0644); err != nil {
			return nil, fmt.Errorf("failed to update repaired manifest: %w", err)
		}

		pm.mu.Lock()
		pm.unregisterHooksInternal(manifest.ID)
		instance.Manifest = manifest
		instance.Error = ""
		for _, setting := range manifest.Settings {
			if _, ok := instance.Settings[setting.Key]; !ok {
				instance.Settings[setting.Key] = setting.Default
			}
		}
		if instance.Enabled {
			pm.registerHooksInternal(instance)
		}
		if err := pm.savePluginStateInternal(); err != nil {
			log.Printf("[plugins] warning: failed to persist state after repair: %v", err)
		}
		pm.mu.Unlock()
		log.Printf("[plugins] repaired package files: %s v%s", manifest.Name, manifest.Version)
	}
	if created {
		pm.mu.Lock()
		instance.Error = ""
		if err := validatePluginEntrypoint(instance); err != nil {
			instance.Error = err.Error()
		}
		if err := pm.savePluginStateInternal(); err != nil {
			log.Printf("[plugins] warning: failed to persist state after package install: %v", err)
		}
		pm.mu.Unlock()
		log.Printf("[plugins] installed package files: %s v%s", manifest.Name, manifest.Version)
	}
	return instance, nil
}

// InstallPluginDirectory reads a directory selected through the native Wails
// picker and installs it as a complete package. Links and special files are
// rejected so the selected tree cannot escape its root or block the reader.
func (pm *PluginManager) InstallPluginDirectory(sourceDir string) (*PluginInstance, error) {
	sourceDir = strings.TrimSpace(sourceDir)
	if sourceDir == "" {
		return nil, fmt.Errorf("plugin directory is required")
	}
	root, err := filepath.Abs(sourceDir)
	if err != nil {
		return nil, fmt.Errorf("invalid plugin directory: %w", err)
	}
	rootInfo, err := os.Lstat(root)
	if err != nil {
		return nil, fmt.Errorf("could not inspect plugin directory: %w", err)
	}
	if rootInfo.Mode()&os.ModeSymlink != 0 || !rootInfo.IsDir() {
		return nil, fmt.Errorf("plugin source must be a real directory")
	}

	encodedFiles := make(map[string]string)
	var totalBytes int64
	err = filepath.WalkDir(root, func(path string, entry fs.DirEntry, walkErr error) error {
		if walkErr != nil {
			return walkErr
		}
		if entry.Type()&os.ModeSymlink != 0 {
			return fmt.Errorf("plugin directory contains a symbolic link: %s", entry.Name())
		}
		if entry.IsDir() {
			return nil
		}
		info, err := entry.Info()
		if err != nil {
			return err
		}
		if !info.Mode().IsRegular() {
			return fmt.Errorf("plugin directory contains a non-regular file: %s", entry.Name())
		}
		if len(encodedFiles) >= maxPluginPackageFiles {
			return fmt.Errorf("plugin package contains too many files (max %d)", maxPluginPackageFiles)
		}
		totalBytes += info.Size()
		if totalBytes > maxPluginPackageBytes {
			return fmt.Errorf("plugin package exceeds %d MiB", maxPluginPackageBytes>>20)
		}
		relativePath, err := filepath.Rel(root, path)
		if err != nil || relativePath == "." || relativePath == ".." || strings.HasPrefix(relativePath, ".."+string(filepath.Separator)) {
			return fmt.Errorf("plugin file escapes selected directory: %s", path)
		}
		data, err := os.ReadFile(path)
		if err != nil {
			return fmt.Errorf("could not read plugin file %s: %w", relativePath, err)
		}
		encodedFiles[filepath.ToSlash(relativePath)] = base64.StdEncoding.EncodeToString(data)
		return nil
	})
	if err != nil {
		return nil, fmt.Errorf("could not read plugin directory: %w", err)
	}

	encodedManifest, ok := encodedFiles["manifest.json"]
	if !ok {
		return nil, fmt.Errorf("plugin directory must contain manifest.json at its root")
	}
	manifestData, err := base64.StdEncoding.DecodeString(encodedManifest)
	if err != nil {
		return nil, fmt.Errorf("could not decode plugin manifest: %w", err)
	}
	return pm.InstallPluginPackage(string(manifestData), encodedFiles)
}

// UninstallPlugin removes a plugin directory and unregisters its hooks.
func (pm *PluginManager) UninstallPlugin(id string) error {
	pm.mu.Lock()
	defer pm.mu.Unlock()

	inst, ok := pm.plugins[id]
	if !ok {
		return fmt.Errorf("plugin not found: %s", id)
	}

	// Unregister hooks
	pm.unregisterHooksInternal(id)

	// Remove plugin directory — guard against a tampered InstallDir escaping pluginDir.
	if inst.InstallDir != "" {
		if !isUnderDir(pm.pluginDir, inst.InstallDir) {
			return fmt.Errorf("refusing to remove directory outside plugin dir: %s", inst.InstallDir)
		}
		if err := os.RemoveAll(inst.InstallDir); err != nil {
			log.Printf("[plugins] warning: failed to remove plugin directory: %v", err)
		}
	}

	delete(pm.plugins, id)

	if err := pm.savePluginStateInternal(); err != nil {
		log.Printf("[plugins] warning: failed to persist state after uninstall: %v", err)
	}

	log.Printf("[plugins] uninstalled: %s", id)
	return nil
}

// EnablePlugin enables a plugin and registers its hooks.
func (pm *PluginManager) EnablePlugin(id string) error {
	pm.mu.Lock()
	defer pm.mu.Unlock()

	inst, ok := pm.plugins[id]
	if !ok {
		return fmt.Errorf("plugin not found: %s", id)
	}

	if inst.Enabled {
		return nil
	}
	if err := validatePluginEntrypoint(inst); err != nil {
		inst.Error = err.Error()
		return err
	}

	inst.Enabled = true
	inst.Error = ""
	pm.registerHooksInternal(inst)

	if err := pm.savePluginStateInternal(); err != nil {
		log.Printf("[plugins] warning: failed to persist state after enable: %v", err)
	}

	log.Printf("[plugins] enabled: %s", id)
	return nil
}

// DisablePlugin disables a plugin and unregisters its hooks.
func (pm *PluginManager) DisablePlugin(id string) error {
	pm.mu.Lock()
	defer pm.mu.Unlock()

	inst, ok := pm.plugins[id]
	if !ok {
		return fmt.Errorf("plugin not found: %s", id)
	}

	if !inst.Enabled {
		return nil
	}

	inst.Enabled = false
	pm.unregisterHooksInternal(id)

	if err := pm.savePluginStateInternal(); err != nil {
		log.Printf("[plugins] warning: failed to persist state after disable: %v", err)
	}

	log.Printf("[plugins] disabled: %s", id)
	return nil
}

// GetPluginSettings returns the settings map for a plugin.
func (pm *PluginManager) GetPluginSettings(id string) (map[string]string, error) {
	pm.mu.RLock()
	defer pm.mu.RUnlock()

	inst, ok := pm.plugins[id]
	if !ok {
		return nil, fmt.Errorf("plugin not found: %s", id)
	}

	// Return a copy
	result := make(map[string]string, len(inst.Settings))
	for k, v := range inst.Settings {
		result[k] = v
	}
	return result, nil
}

// SetPluginSetting updates a single setting value for a plugin.
func (pm *PluginManager) SetPluginSetting(id string, key string, value string) error {
	pm.mu.Lock()
	defer pm.mu.Unlock()

	inst, ok := pm.plugins[id]
	if !ok {
		return fmt.Errorf("plugin not found: %s", id)
	}

	// Validate that the setting key exists in the manifest
	valid := false
	for _, s := range inst.Manifest.Settings {
		if s.Key == key {
			valid = true
			break
		}
	}
	if !valid {
		return fmt.Errorf("unknown setting key: %s", key)
	}

	inst.Settings[key] = value

	if err := pm.savePluginStateInternal(); err != nil {
		log.Printf("[plugins] warning: failed to persist state after setting change: %v", err)
	}

	return nil
}

func (pm *PluginManager) emitEvent(event PluginEvent) ([]HookResult, map[string]interface{}) {
	pm.mu.RLock()
	entries := append([]pluginHookEntry(nil), pm.hooks[event.Type]...)
	runtime := pm.runtime
	pm.mu.RUnlock()

	current := event.Payload
	if current == nil {
		current = map[string]interface{}{}
	}
	if len(entries) == 0 {
		return nil, current
	}

	results := make([]HookResult, 0, len(entries))
	for _, entry := range entries {
		log.Printf("[plugins] hook triggered: event=%s plugin=%s handler=%s", event.Type, entry.PluginID, entry.Handler)
		if runtime == nil {
			results = append(results, HookResult{Error: "plugin runtime is not initialized"})
			continue
		}
		execResult := runtime.Execute(ExecRequest{
			PluginID: entry.PluginID,
			Function: entry.Handler,
			Args: map[string]interface{}{
				"event":   event.Type,
				"payload": current,
			},
		})
		if !execResult.Success {
			results = append(results, HookResult{Error: execResult.Error})
			continue
		}
		hookResult := hookResultFromData(execResult.Data)
		if hookResult.Modified && hookResult.Data != nil {
			current = hookResult.Data
		}
		results = append(results, hookResult)
	}

	return results, current
}

// EmitEvent fires an event through the hook system and collects results from all registered handlers.
func (pm *PluginManager) EmitEvent(event PluginEvent) []HookResult {
	results, _ := pm.emitEvent(event)
	return results
}

// ApplyEventJSON runs all hooks sequentially and returns the final payload.
// A hook error aborts the operation so callers never silently send a request
// that an enabled plugin failed to prepare.
func (pm *PluginManager) ApplyEventJSON(eventType, payloadJSON string) (string, error) {
	var payload map[string]interface{}
	if err := json.Unmarshal([]byte(payloadJSON), &payload); err != nil {
		return "", fmt.Errorf("invalid %s payload: %w", eventType, err)
	}
	results, finalPayload := pm.emitEvent(PluginEvent{Type: eventType, Payload: payload})
	for _, result := range results {
		if result.Error != "" {
			return "", fmt.Errorf("plugin hook %s failed: %s", eventType, result.Error)
		}
	}
	encoded, err := json.Marshal(finalPayload)
	if err != nil {
		return "", fmt.Errorf("failed to encode %s payload: %w", eventType, err)
	}
	return string(encoded), nil
}

// FireEvent queues a plugin event for async delivery.
// Returns false if the bus is full and the event was dropped.
func (pm *PluginManager) FireEvent(event PluginEvent) bool {
	select {
	case pm.eventBus <- event:
		return true
	default:
		log.Printf("[plugins] event bus full, dropping event: %s", event.Type)
		return false
	}
}

// Shutdown signals the event dispatch loop to exit.
func (pm *PluginManager) Shutdown() {
	select {
	case <-pm.stopCh:
	default:
		close(pm.stopCh)
	}
}

// eventDispatchLoop drains eventBus and dispatches each event to registered hooks.
func (pm *PluginManager) eventDispatchLoop() {
	for {
		select {
		case event, ok := <-pm.eventBus:
			if !ok {
				return
			}
			pm.dispatchToHooks(event)
		case <-pm.stopCh:
			return
		}
	}
}

// dispatchToHooks delivers an event to all registered handlers for its type.
func (pm *PluginManager) dispatchToHooks(event PluginEvent) {
	results := pm.EmitEvent(event)
	for _, result := range results {
		if result.Error != "" {
			log.Printf("[plugins] hook dispatch failed: event=%s error=%s", event.Type, result.Error)
		}
	}
}

// GetRegisteredHooks returns a map of event names to the list of plugin IDs with registered handlers.
func (pm *PluginManager) GetRegisteredHooks() map[string][]string {
	pm.mu.RLock()
	defer pm.mu.RUnlock()

	result := make(map[string][]string)
	for event, entries := range pm.hooks {
		ids := make([]string, 0, len(entries))
		for _, e := range entries {
			ids = append(ids, e.PluginID)
		}
		result[event] = ids
	}
	return result
}

// GetAvailableEvents returns the list of all hookable event names.
func (pm *PluginManager) GetAvailableEvents() []string {
	result := make([]string, len(AvailableHookEvents))
	copy(result, AvailableHookEvents)
	return result
}

// SavePluginState persists enabled/disabled state and settings to bbolt.
func (pm *PluginManager) SavePluginState() error {
	pm.mu.RLock()
	defer pm.mu.RUnlock()
	return pm.savePluginStateInternal()
}

// LoadPluginState restores plugin state from bbolt.
func (pm *PluginManager) LoadPluginState() error {
	pm.mu.Lock()
	defer pm.mu.Unlock()
	return pm.loadPluginStateInternal()
}

// --- internal helpers (must be called with lock held) ---

func (pm *PluginManager) registerHooksInternal(inst *PluginInstance) {
	if err := validatePluginEntrypoint(inst); err != nil {
		inst.Error = err.Error()
		log.Printf("[plugins] refusing to register hooks for %s: %v", inst.Manifest.ID, err)
		return
	}
	if inst.Manifest.Runtime == "none" {
		return
	}
	for _, hook := range inst.Manifest.Hooks {
		entry := pluginHookEntry{
			PluginID: inst.Manifest.ID,
			Handler:  hook.Handler,
		}
		pm.hooks[hook.Event] = append(pm.hooks[hook.Event], entry)
	}
}

func (pm *PluginManager) unregisterHooksInternal(pluginID string) {
	for event, entries := range pm.hooks {
		filtered := make([]pluginHookEntry, 0, len(entries))
		for _, e := range entries {
			if e.PluginID != pluginID {
				filtered = append(filtered, e)
			}
		}
		if len(filtered) == 0 {
			delete(pm.hooks, event)
		} else {
			pm.hooks[event] = filtered
		}
	}
}

// pluginState is the serialized form for persistence.
type pluginState struct {
	Enabled  bool              `json:"enabled"`
	Settings map[string]string `json:"settings"`
}

func (pm *PluginManager) savePluginStateInternal() error {
	if storage.DB() == nil {
		return fmt.Errorf("storage not available")
	}

	states := make(map[string]pluginState)
	for id, inst := range pm.plugins {
		states[id] = pluginState{
			Enabled:  inst.Enabled,
			Settings: inst.Settings,
		}
	}

	data, err := json.Marshal(states)
	if err != nil {
		return fmt.Errorf("failed to marshal plugin state: %w", err)
	}

	return storage.DB().Update(func(tx *bolt.Tx) error {
		b := tx.Bucket([]byte("plugins"))
		if b == nil {
			return fmt.Errorf("plugins bucket not found")
		}
		return b.Put([]byte("state"), data)
	})
}

func (pm *PluginManager) loadPluginStateInternal() error {
	if storage.DB() == nil {
		return fmt.Errorf("storage not available")
	}

	var data []byte
	err := storage.DB().View(func(tx *bolt.Tx) error {
		b := tx.Bucket([]byte("plugins"))
		if b == nil {
			return nil
		}
		v := b.Get([]byte("state"))
		if v != nil {
			data = make([]byte, len(v))
			copy(data, v)
		}
		return nil
	})
	if err != nil {
		return err
	}
	if data == nil {
		return nil
	}

	var states map[string]pluginState
	if err := json.Unmarshal(data, &states); err != nil {
		return fmt.Errorf("failed to unmarshal plugin state: %w", err)
	}

	for id, state := range states {
		if inst, ok := pm.plugins[id]; ok {
			inst.Enabled = state.Enabled
			if state.Settings != nil {
				inst.Settings = state.Settings
			}
		} else {
			// Plugin dir may have been removed; create a placeholder
			pm.plugins[id] = &PluginInstance{
				Manifest: PluginManifest{ID: id},
				Enabled:  state.Enabled,
				Settings: state.Settings,
				Error:    "plugin directory not found",
			}
		}
	}

	return nil
}
