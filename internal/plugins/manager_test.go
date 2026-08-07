package plugins

import (
	"adomnia/internal/storage"
	"encoding/base64"
	"encoding/json"
	"os"
	"path/filepath"
	"strings"
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
	AttachRuntime(manager, NewWasmRuntime())
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
		"runtime": "js",
		"entryPoint": "main.js",
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
	AttachRuntime(reloadedManager, NewWasmRuntime())
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

func TestPluginManagerInstallsNativePluginDirectory(t *testing.T) {
	manager, _ := newTestPluginManager(t)
	sourceDir := t.TempDir()
	manifestJSON := `{
		"id": "native-folder-demo",
		"name": "Native Folder Demo",
		"version": "1.0.0",
		"author": "adOmnia",
		"runtime": "js",
		"entryPoint": "src/main.js"
	}`
	if err := os.MkdirAll(filepath.Join(sourceDir, "src"), 0755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(sourceDir, "manifest.json"), []byte(manifestJSON), 0644); err != nil {
		t.Fatal(err)
	}
	mainFile := []byte(`export function run() { return "native" }`)
	if err := os.WriteFile(filepath.Join(sourceDir, "src", "main.js"), mainFile, 0644); err != nil {
		t.Fatal(err)
	}

	installed, err := manager.InstallPluginDirectory(sourceDir)
	if err != nil {
		t.Fatalf("InstallPluginDirectory() error = %v", err)
	}
	copied, err := os.ReadFile(filepath.Join(installed.InstallDir, "src", "main.js"))
	if err != nil {
		t.Fatalf("installed entrypoint missing: %v", err)
	}
	if string(copied) != string(mainFile) {
		t.Fatal("installed entrypoint differs from source directory")
	}
}

func TestPluginManagerRejectsSymlinkInNativeDirectory(t *testing.T) {
	manager, _ := newTestPluginManager(t)
	sourceDir := t.TempDir()
	if err := os.WriteFile(filepath.Join(sourceDir, "manifest.json"), []byte(`{"id":"linked","name":"Linked","runtime":"js","entryPoint":"main.js"}`), 0644); err != nil {
		t.Fatal(err)
	}
	outside := filepath.Join(t.TempDir(), "outside.js")
	if err := os.WriteFile(outside, []byte(`export function run() {}`), 0644); err != nil {
		t.Fatal(err)
	}
	if err := os.Symlink(outside, filepath.Join(sourceDir, "main.js")); err != nil {
		t.Skipf("symlinks unavailable: %v", err)
	}

	_, err := manager.InstallPluginDirectory(sourceDir)
	if err == nil || !strings.Contains(err.Error(), "symbolic link") {
		t.Fatalf("InstallPluginDirectory() error = %v, want symbolic-link rejection", err)
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

func TestPluginPackageExecutesActionAndTransformsRequestHook(t *testing.T) {
	manager, _ := newTestPluginManager(t)
	manifestJSON := `{
		"id": "request-advisor",
		"name": "Request Advisor",
		"version": "1.0.0",
		"author": "adOmnia",
		"runtime": "js",
		"entryPoint": "main.js",
		"hooks": [{"event":"onRequest","handler":"prepareRequest"}],
		"settings": [{"key":"headerValue","label":"Header","type":"string","default":"active","description":""}],
		"ui_slots": ["panel"],
		"actions": [{"id":"inspect","name":"Inspect","description":"","streaming":false}]
	}`
	source := []byte(`
		export function prepareRequest(input) {
			input.payload.headers["X-Adomnia-Plugin"] = adomnia.settings.headerValue;
			return { modified: true, data: input.payload };
		}
		export function inspect() {
			adomnia.log.info("inspect action executed");
			return { ok: true, pluginId: adomnia.pluginId };
		}
	`)
	if _, err := manager.InstallPluginPackage(manifestJSON, map[string]string{
		"manifest.json": base64.StdEncoding.EncodeToString([]byte(manifestJSON)),
		"main.js":       base64.StdEncoding.EncodeToString(source),
	}); err != nil {
		t.Fatalf("InstallPluginPackage() error = %v", err)
	}
	if err := manager.EnablePlugin("request-advisor"); err != nil {
		t.Fatalf("EnablePlugin() error = %v", err)
	}

	transformed, err := manager.ApplyEventJSON("onRequest", `{"method":"GET","url":"https://example.test","headers":{},"body":""}`)
	if err != nil {
		t.Fatalf("ApplyEventJSON() error = %v", err)
	}
	var request map[string]interface{}
	if err := json.Unmarshal([]byte(transformed), &request); err != nil {
		t.Fatalf("decode transformed request: %v", err)
	}
	headers := request["headers"].(map[string]interface{})
	if got := headers["X-Adomnia-Plugin"]; got != "active" {
		t.Fatalf("plugin header = %#v, want active", got)
	}

	result := manager.ExecuteAction("request-advisor", "inspect", map[string]interface{}{})
	if !result.Success {
		t.Fatalf("ExecuteAction() failed: %s", result.Error)
	}
	data := result.Data.(map[string]interface{})
	if data["ok"] != true || data["pluginId"] != "request-advisor" {
		t.Fatalf("action result = %#v", data)
	}
}

func TestPluginRuntimeEnforcesPermissionAndTimeout(t *testing.T) {
	manager, _ := newTestPluginManager(t)
	manifestJSON := `{
		"id":"sandbox-check",
		"name":"Sandbox Check",
		"runtime":"js",
		"entryPoint":"main.js",
		"actions":[
			{"id":"readEnv","name":"Read env","description":"","streaming":false},
			{"id":"loop","name":"Loop","description":"","streaming":false}
		]
	}`
	source := []byte(`
		module.exports.readEnv = function () { return adomnia.env.get("PATH"); };
		module.exports.loop = function () { while (true) {} };
	`)
	if _, err := manager.InstallPluginPackage(manifestJSON, map[string]string{
		"manifest.json": base64.StdEncoding.EncodeToString([]byte(manifestJSON)),
		"main.js":       base64.StdEncoding.EncodeToString(source),
	}); err != nil {
		t.Fatalf("InstallPluginPackage() error = %v", err)
	}
	if err := manager.EnablePlugin("sandbox-check"); err != nil {
		t.Fatalf("EnablePlugin() error = %v", err)
	}

	permissionResult := manager.ExecuteAction("sandbox-check", "readEnv", nil)
	if permissionResult.Success || !strings.Contains(permissionResult.Error, "permission denied") {
		t.Fatalf("permission result = %#v", permissionResult)
	}
	if err := manager.runtime.SetMemoryLimit("sandbox-check", 16); err != nil {
		t.Fatalf("SetMemoryLimit() error = %v", err)
	}
	memoryResult := manager.ExecuteAction("sandbox-check", "loop", nil)
	if memoryResult.Success || !strings.Contains(memoryResult.Error, "memory limit") {
		t.Fatalf("memory result = %#v", memoryResult)
	}
	if err := manager.runtime.SetMemoryLimit("sandbox-check", 64*1024*1024); err != nil {
		t.Fatalf("restore SetMemoryLimit() error = %v", err)
	}
	if err := manager.runtime.SetTimeLimit("sandbox-check", 25); err != nil {
		t.Fatalf("SetTimeLimit() error = %v", err)
	}
	timeoutResult := manager.ExecuteAction("sandbox-check", "loop", nil)
	if timeoutResult.Success || !strings.Contains(timeoutResult.Error, "timed out") {
		t.Fatalf("timeout result = %#v", timeoutResult)
	}
}

func TestPluginManagerRejectsNewWASMPlugin(t *testing.T) {
	manager, _ := newTestPluginManager(t)
	_, err := manager.InstallPlugin(`{"id":"legacy-wasm","name":"Legacy WASM","runtime":"wasm","entryPoint":"plugin.wasm"}`)
	if err == nil || !strings.Contains(err.Error(), "WASM plugins are not executable") {
		t.Fatalf("InstallPlugin() error = %v", err)
	}
}

func TestPluginNotificationHostEmitsToDesktopBridge(t *testing.T) {
	manager, _ := newTestPluginManager(t)
	manifestJSON := `{
		"id":"notifier",
		"name":"Notifier",
		"runtime":"js",
		"entryPoint":"main.js",
		"permissions":["notifications"],
		"actions":[{"id":"notify","name":"Notify","description":"","streaming":false}]
	}`
	source := []byte(`module.exports.notify = function () {
		return adomnia.ui.notify({title:"Ready", message:"Plugin completed", type:"success"});
	};`)
	if _, err := manager.InstallPluginPackage(manifestJSON, map[string]string{
		"manifest.json": base64.StdEncoding.EncodeToString([]byte(manifestJSON)),
		"main.js":       base64.StdEncoding.EncodeToString(source),
	}); err != nil {
		t.Fatalf("InstallPluginPackage() error = %v", err)
	}
	if err := manager.EnablePlugin("notifier"); err != nil {
		t.Fatalf("EnablePlugin() error = %v", err)
	}

	notifications := make(chan PluginNotification, 1)
	ConfigureNotifier(func(notification PluginNotification) { notifications <- notification })
	t.Cleanup(func() { ConfigureNotifier(nil) })
	result := manager.ExecuteAction("notifier", "notify", nil)
	if !result.Success {
		t.Fatalf("ExecuteAction() failed: %s", result.Error)
	}
	select {
	case notification := <-notifications:
		if notification.PluginID != "notifier" || notification.Type != "success" || notification.Message != "Plugin completed" {
			t.Fatalf("notification = %#v", notification)
		}
	default:
		t.Fatal("notification was not emitted")
	}
}
