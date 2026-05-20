// plugins.go — Plugin system with JSON manifests, hook registration, event bus, and lifecycle management.
// Plugins are directories containing a manifest.json + optional scripts/assets.

package main

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"log"
	"os"
	"os/exec"
	"path/filepath"
	"regexp"
	"runtime"
	"strings"
	"sync"
	"time"

	bolt "go.etcd.io/bbolt"
)

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
}

// RuntimeStatus describes the state of the Python runtime for plugin execution.
type RuntimeStatus struct {
	Available bool   `json:"available"`
	Path      string `json:"path"`
	Version   string `json:"version"`
	Embedded  bool   `json:"embedded"`
	VenvReady bool   `json:"venvReady"`
}

// PluginHook maps an event to a handler function name in the plugin entry point.
type PluginHook struct {
	Event   string `json:"event"`
	Handler string `json:"handler"`
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
}

var pluginIDPattern = regexp.MustCompile(`^[a-zA-Z0-9._-]+$`)

func normalizePluginManifest(manifest *PluginManifest) error {
	if manifest.ID == "" {
		return fmt.Errorf("manifest must have an id field")
	}
	if !pluginIDPattern.MatchString(manifest.ID) {
		return fmt.Errorf("plugin id may only contain letters, numbers, dot, underscore and dash")
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
	if manifest.EntryPoint == "" {
		manifest.EntryPoint = "plugin.wasm"
	}
	return nil
}

// NewPluginManager creates a new PluginManager instance.
func NewPluginManager() *PluginManager {
	return &PluginManager{
		plugins:  make(map[string]*PluginInstance),
		eventBus: make(chan PluginEvent, 64),
		hooks:    make(map[string][]pluginHookEntry),
	}
}

// Init scans the plugin directory, loads manifests, and registers hooks for enabled plugins.
func (pm *PluginManager) Init() error {
	pm.mu.Lock()
	defer pm.mu.Unlock()

	pm.pluginDir = filepath.Join(dataDir(), "plugins")
	if err := os.MkdirAll(pm.pluginDir, 0755); err != nil {
		return fmt.Errorf("failed to create plugin directory: %w", err)
	}

	// Ensure bbolt bucket exists
	if storeDB != nil {
		err := storeDB.Update(func(tx *bolt.Tx) error {
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

		// Merge with persisted state if it exists
		if existing, ok := pm.plugins[manifest.ID]; ok {
			existing.Manifest = manifest
			existing.InstallDir = filepath.Join(pm.pluginDir, entry.Name())
		} else {
			instance := &PluginInstance{
				Manifest:    manifest,
				Enabled:     false,
				Settings:    make(map[string]string),
				InstallDir:  filepath.Join(pm.pluginDir, entry.Name()),
				InstalledAt: time.Now().UTC().Format(time.RFC3339),
			}
			// Apply default settings
			for _, s := range manifest.Settings {
				instance.Settings[s.Key] = s.Default
			}
			pm.plugins[manifest.ID] = instance
		}
	}

	// Register hooks for enabled plugins
	for _, inst := range pm.plugins {
		if inst.Enabled {
			pm.registerHooksInternal(inst)
		}
	}

	log.Printf("[plugins] initialized: %d plugins loaded from %s", len(pm.plugins), pm.pluginDir)
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

// InstallPlugin installs a plugin from manifest JSON, creating its directory and saving manifest.json.
func (pm *PluginManager) InstallPlugin(manifestJSON string) (*PluginInstance, error) {
	var manifest PluginManifest
	if err := json.Unmarshal([]byte(manifestJSON), &manifest); err != nil {
		return nil, fmt.Errorf("invalid manifest JSON: %w", err)
	}

	if err := normalizePluginManifest(&manifest); err != nil {
		return nil, err
	}

	pm.mu.Lock()
	defer pm.mu.Unlock()

	if _, exists := pm.plugins[manifest.ID]; exists {
		return nil, fmt.Errorf("plugin already installed: %s", manifest.ID)
	}

	// Create plugin directory
	pluginPath := filepath.Join(pm.pluginDir, manifest.ID)
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

	// Remove plugin directory
	if inst.InstallDir != "" {
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

// EmitEvent fires an event through the hook system and collects results from all registered handlers.
func (pm *PluginManager) EmitEvent(event PluginEvent) []HookResult {
	pm.mu.RLock()
	entries, ok := pm.hooks[event.Type]
	pm.mu.RUnlock()

	if !ok || len(entries) == 0 {
		return nil
	}

	results := make([]HookResult, 0, len(entries))
	for _, entry := range entries {
		log.Printf("[plugins] hook triggered: event=%s plugin=%s handler=%s", event.Type, entry.PluginID, entry.Handler)
		// For now, without a WASM runtime, hooks just log and return unmodified.
		// The real implementation in plugins_wasm.go will execute plugin code.
		results = append(results, HookResult{Modified: false})
	}

	return results
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

// InstallPythonPlugin performs the full install flow for a Python plugin:
// parse manifest, create plugin directory, write manifest, create virtualenv,
// install requirements.txt dependencies, and verify the entrypoint is importable.
func (pm *PluginManager) InstallPythonPlugin(manifestJSON string) error {
	var manifest PluginManifest
	if err := json.Unmarshal([]byte(manifestJSON), &manifest); err != nil {
		return fmt.Errorf("invalid manifest JSON: %w", err)
	}

	if err := normalizePluginManifest(&manifest); err != nil {
		return err
	}

	// Force runtime to python
	manifest.Runtime = "python"

	// Default entrypoint for Python plugins
	if manifest.EntryPoint == "" || manifest.EntryPoint == "plugin.wasm" {
		manifest.EntryPoint = "main.py"
	}

	// Step 1: Use existing InstallPlugin to handle directory creation and manifest
	inst, err := pm.InstallPlugin(manifestJSON)
	if err != nil {
		return fmt.Errorf("failed to install plugin files: %w", err)
	}

	// Update the manifest with the forced runtime/entrypoint
	pm.mu.Lock()
	if p, ok := pm.plugins[manifest.ID]; ok {
		p.Manifest.Runtime = "python"
		if p.Manifest.EntryPoint == "plugin.wasm" {
			p.Manifest.EntryPoint = "main.py"
		}
	}
	pm.mu.Unlock()

	// Re-write manifest.json with runtime field
	manifestData, err := json.MarshalIndent(manifest, "", "  ")
	if err != nil {
		return fmt.Errorf("failed to marshal manifest: %w", err)
	}
	if err := os.WriteFile(filepath.Join(inst.InstallDir, "manifest.json"), manifestData, 0644); err != nil {
		return fmt.Errorf("failed to update manifest.json: %w", err)
	}

	// Step 2: Create virtualenv
	pythonPath := pm.discoverPython()
	if pythonPath == "" {
		pm.setPluginError(manifest.ID, "python runtime not found")
		return fmt.Errorf("python runtime not found; cannot create virtualenv")
	}

	venvDir := filepath.Join(inst.InstallDir, "venv")
	if err := pm.createVirtualenv(pythonPath, venvDir); err != nil {
		pm.setPluginError(manifest.ID, fmt.Sprintf("virtualenv creation failed: %v", err))
		return fmt.Errorf("failed to create virtualenv: %w", err)
	}

	log.Printf("[plugins] virtualenv created at %s", venvDir)

	// Step 3: Install dependencies from requirements.txt if present
	requirementsPath := filepath.Join(inst.InstallDir, "requirements.txt")
	if _, err := os.Stat(requirementsPath); err == nil {
		if err := pm.installRequirements(venvDir, requirementsPath); err != nil {
			pm.setPluginError(manifest.ID, fmt.Sprintf("pip install failed: %v", err))
			return fmt.Errorf("failed to install requirements: %w", err)
		}
		log.Printf("[plugins] requirements installed for %s", manifest.ID)
	}

	// Step 4: Verify entrypoint is importable
	entrypointPath := filepath.Join(inst.InstallDir, manifest.EntryPoint)
	if _, err := os.Stat(entrypointPath); os.IsNotExist(err) {
		pm.setPluginError(manifest.ID, fmt.Sprintf("entrypoint not found: %s", manifest.EntryPoint))
		return fmt.Errorf("entrypoint file not found: %s", entrypointPath)
	}

	if err := pm.verifyPythonImport(venvDir, inst.InstallDir, manifest.EntryPoint); err != nil {
		pm.setPluginError(manifest.ID, fmt.Sprintf("entrypoint verification failed: %v", err))
		return fmt.Errorf("entrypoint verification failed: %w", err)
	}

	log.Printf("[plugins] python plugin %s installed and verified successfully", manifest.ID)
	return nil
}

// GetPythonRuntimeStatus returns information about the discovered Python runtime.
func (pm *PluginManager) GetPythonRuntimeStatus() RuntimeStatus {
	pythonPath := pm.discoverPython()
	status := RuntimeStatus{
		Available: pythonPath != "",
		Path:      pythonPath,
	}

	if pythonPath == "" {
		return status
	}

	// Determine if this is the embedded runtime
	embeddedDir := filepath.Join(dataDir(), "python-runtime")
	if strings.HasPrefix(pythonPath, embeddedDir) {
		status.Embedded = true
		if ver, err := os.ReadFile(filepath.Join(embeddedDir, ".version")); err == nil {
			status.Version = strings.TrimSpace(string(ver))
		}
	} else {
		out, err := exec.Command(pythonPath, "--version").Output()
		if err == nil {
			status.Version = strings.TrimSpace(string(out))
		}
	}

	// Check if any venv exists for any installed python plugin
	pm.mu.RLock()
	for _, inst := range pm.plugins {
		if inst.Manifest.Runtime == "python" {
			venvDir := filepath.Join(inst.InstallDir, "venv")
			if _, err := os.Stat(venvDir); err == nil {
				status.VenvReady = true
				break
			}
		}
	}
	pm.mu.RUnlock()

	return status
}

// discoverPython finds the Python interpreter: embedded first, then system PATH.
func (pm *PluginManager) discoverPython() string {
	// Check embedded runtime (Windows)
	embedded := filepath.Join(dataDir(), "python-runtime", "python.exe")
	if _, err := os.Stat(embedded); err == nil {
		return embedded
	}

	// Check embedded runtime (Unix)
	embedded = filepath.Join(dataDir(), "python-runtime", "python3")
	if _, err := os.Stat(embedded); err == nil {
		return embedded
	}

	// System PATH
	if path, err := exec.LookPath("python3"); err == nil {
		return path
	}
	if path, err := exec.LookPath("python"); err == nil {
		return path
	}

	return ""
}

// createVirtualenv creates a Python virtualenv at the given directory.
func (pm *PluginManager) createVirtualenv(pythonPath string, venvDir string) error {
	ctx, cancel := context.WithTimeout(context.Background(), 60*time.Second)
	defer cancel()

	cmd := exec.CommandContext(ctx, pythonPath, "-m", "venv", venvDir)
	var stderr bytes.Buffer
	cmd.Stderr = &stderr

	if err := cmd.Run(); err != nil {
		return fmt.Errorf("venv creation failed: %w (stderr: %s)", err, stderr.String())
	}

	return nil
}

// installRequirements runs pip install -r requirements.txt inside the virtualenv.
func (pm *PluginManager) installRequirements(venvDir string, requirementsPath string) error {
	pipPath := pm.venvPipPath(venvDir)
	if _, err := os.Stat(pipPath); os.IsNotExist(err) {
		return fmt.Errorf("pip not found in virtualenv: %s", pipPath)
	}

	ctx, cancel := context.WithTimeout(context.Background(), 120*time.Second)
	defer cancel()

	cmd := exec.CommandContext(ctx, pipPath, "install", "-r", requirementsPath, "--no-input")
	var stderr bytes.Buffer
	cmd.Stderr = &stderr
	cmd.Env = append(os.Environ(), fmt.Sprintf("VIRTUAL_ENV=%s", venvDir))

	if err := cmd.Run(); err != nil {
		return fmt.Errorf("pip install failed: %w (stderr: %s)", err, stderr.String())
	}

	return nil
}

// verifyPythonImport checks that the plugin entrypoint can be imported without errors.
func (pm *PluginManager) verifyPythonImport(venvDir string, pluginDir string, entrypoint string) error {
	pythonPath := pm.venvPythonPath(venvDir)
	if _, err := os.Stat(pythonPath); os.IsNotExist(err) {
		return fmt.Errorf("python not found in virtualenv: %s", pythonPath)
	}

	// Strip .py extension for import check
	moduleName := strings.TrimSuffix(entrypoint, ".py")

	ctx, cancel := context.WithTimeout(context.Background(), 15*time.Second)
	defer cancel()

	cmd := exec.CommandContext(ctx, pythonPath, "-c", fmt.Sprintf("import %s", moduleName))
	cmd.Dir = pluginDir
	var stderr bytes.Buffer
	cmd.Stderr = &stderr

	if err := cmd.Run(); err != nil {
		return fmt.Errorf("import check failed for %s: %w (stderr: %s)", moduleName, err, stderr.String())
	}

	return nil
}

// venvPythonPath returns the platform-appropriate path to python inside a virtualenv.
func (pm *PluginManager) venvPythonPath(venvDir string) string {
	if runtime.GOOS == "windows" {
		return filepath.Join(venvDir, "Scripts", "python.exe")
	}
	return filepath.Join(venvDir, "bin", "python3")
}

// venvPipPath returns the platform-appropriate path to pip inside a virtualenv.
func (pm *PluginManager) venvPipPath(venvDir string) string {
	if runtime.GOOS == "windows" {
		return filepath.Join(venvDir, "Scripts", "pip.exe")
	}
	return filepath.Join(venvDir, "bin", "pip")
}

// setPluginError records an error on a plugin instance.
func (pm *PluginManager) setPluginError(pluginID string, errMsg string) {
	pm.mu.Lock()
	defer pm.mu.Unlock()

	if inst, ok := pm.plugins[pluginID]; ok {
		inst.Error = errMsg
	}
}

// --- internal helpers (must be called with lock held) ---

func (pm *PluginManager) registerHooksInternal(inst *PluginInstance) {
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
	if storeDB == nil {
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

	return storeDB.Update(func(tx *bolt.Tx) error {
		b := tx.Bucket([]byte("plugins"))
		if b == nil {
			return fmt.Errorf("plugins bucket not found")
		}
		return b.Put([]byte("state"), data)
	})
}

func (pm *PluginManager) loadPluginStateInternal() error {
	if storeDB == nil {
		return fmt.Errorf("storage not available")
	}

	var data []byte
	err := storeDB.View(func(tx *bolt.Tx) error {
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
