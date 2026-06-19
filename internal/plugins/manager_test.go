package plugins

import (
	"adomnia/internal/storage"
	"encoding/base64"
	"os"
	"path/filepath"
	"testing"
)

func pluginTestDataDir(tempDir string) string {
	return filepath.Join(tempDir, "adomnia")
}

func newTestPluginManager(t *testing.T) (*PluginManager, string) {
	t.Helper()
	tempDir := t.TempDir()
	t.Setenv("APPDATA", tempDir)
	if storage.DB() != nil {
		storage.Close()
	}
	dataDir := pluginTestDataDir(tempDir)
	if err := storage.Open(dataDir); err != nil {
		t.Fatalf("openStore() error = %v", err)
	}
	t.Cleanup(storage.Close)
	Configure(dataDir)
	manager := NewPluginManager()
	if err := manager.Init(); err != nil {
		t.Fatalf("Init() error = %v", err)
	}
	t.Cleanup(manager.Shutdown)
	return manager, dataDir
}

func TestPluginManagerInstallsAndReloadsManifest(t *testing.T) {
	manager, _ := newTestPluginManager(t)
	manifestJSON := `{
		"id": "advisor",
		"name": "Advisor",
		"version": "1.0.0",
		"author": "adOmnia",
		"runtime": "wasm",
		"entryPoint": "plugin.wasm",
		"hooks": ["onSend"],
		"settings": [
			{"key": "enabled", "label": "Enabled", "type": "boolean", "default": true, "description": ""},
			{"key": "level", "label": "Level", "type": "number", "default": 3, "description": ""}
		],
		"ui_slots": ["panel"],
		"actions": [
			{"id": "inspect", "name": "Inspect", "description": "", "streaming": false}
		]
	}`

	installed, err := manager.InstallPlugin(manifestJSON)
	if err != nil {
		t.Fatalf("InstallPlugin() error = %v", err)
	}
	if got := installed.Manifest.Hooks[0].Event; got != "onSend" {
		t.Fatalf("hook event = %q, want onSend", got)
	}
	if got := installed.Manifest.Settings[0].Default; got != "true" {
		t.Fatalf("boolean default = %q, want true", got)
	}
	if got := installed.Manifest.Settings[1].Default; got != "3" {
		t.Fatalf("numeric default = %q, want 3", got)
	}
	if len(installed.Manifest.UISlots) != 1 || installed.Manifest.UISlots[0] != "panel" {
		t.Fatalf("ui_slots = %#v, want panel", installed.Manifest.UISlots)
	}
	if len(installed.Manifest.Actions) != 1 {
		t.Fatalf("actions count = %d, want 1", len(installed.Manifest.Actions))
	}

	reloadedManager := NewPluginManager()
	if err := reloadedManager.Init(); err != nil {
		t.Fatalf("reload Init() error = %v", err)
	}
	defer reloadedManager.Shutdown()

	reloaded, err := reloadedManager.GetPlugin(installed.Manifest.ID)
	if err != nil {
		t.Fatalf("GetPlugin() after reload error = %v", err)
	}
	if len(reloaded.Manifest.Actions) != 1 || len(reloaded.Manifest.UISlots) != 1 {
		t.Fatalf("reloaded manifest lost UI declarations: %#v", reloaded.Manifest)
	}
}

func TestPluginManifestAcceptsLowercaseEntrypoint(t *testing.T) {
	manager, _ := newTestPluginManager(t)
	manifestJSON := `{
		"id": "echo",
		"name": "Echo",
		"version": "1.0.0",
		"author": "adOmnia",
		"runtime": "js",
		"entrypoint": "main.js",
		"actions": [
			{"id": "echo", "name": "Echo", "description": "", "streaming": false}
		]
	}`

	installed, err := manager.InstallPlugin(manifestJSON)
	if err != nil {
		t.Fatalf("InstallPlugin() error = %v", err)
	}
	if got := installed.Manifest.EntryPoint; got != "main.js" {
		t.Fatalf("entry point = %q, want main.js", got)
	}
	if len(installed.Manifest.Actions) != 1 {
		t.Fatalf("actions count = %d, want 1", len(installed.Manifest.Actions))
	}
}

func TestPluginManagerInstallsCompletePluginPackage(t *testing.T) {
	manager, _ := newTestPluginManager(t)
	manifestJSON := `{
		"id": "package-demo",
		"name": "Package Demo",
		"version": "1.0.0",
		"author": "adOmnia",
		"runtime": "js",
		"entryPoint": "main.js"
	}`
	mainFile := []byte(`export function run() { return "ok" }`)

	if _, err := manager.InstallPlugin(manifestJSON); err != nil {
		t.Fatalf("InstallPlugin(manifest-only) error = %v", err)
	}
	installed, err := manager.InstallPluginPackage(manifestJSON, map[string]string{
		"manifest.json": base64.StdEncoding.EncodeToString([]byte(manifestJSON)),
		"main.js":       base64.StdEncoding.EncodeToString(mainFile),
	})
	if err != nil {
		t.Fatalf("InstallPluginPackage() error = %v", err)
	}

	copied, err := os.ReadFile(filepath.Join(installed.InstallDir, "main.js"))
	if err != nil {
		t.Fatalf("installed main.js missing: %v", err)
	}
	if string(copied) != string(mainFile) {
		t.Fatal("installed main.js differs from package content")
	}
}

func TestPluginManagerRejectsPythonRuntime(t *testing.T) {
	manager, _ := newTestPluginManager(t)
	_, err := manager.InstallPlugin(`{
		"id": "py-plugin",
		"name": "Python Plugin",
		"version": "1.0.0",
		"author": "adOmnia",
		"runtime": "python",
		"entryPoint": "main.py"
	}`)
	if err == nil {
		t.Fatal("InstallPlugin() accepted python runtime")
	}
}
