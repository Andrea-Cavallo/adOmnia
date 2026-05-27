package plugins

import (
	adpython "adomnia/internal/python"
	"adomnia/internal/storage"
	"encoding/base64"
	"encoding/json"
	"os"
	"path/filepath"
	"testing"
)

func pluginTestDataDir(tempDir string) string {
	return filepath.Join(tempDir, "adomnia")
}

func TestPluginManagerInstallsAndReloadsPythonManifest(t *testing.T) {
	tempDir := t.TempDir()
	t.Setenv("APPDATA", tempDir)

	if storage.DB() != nil {
		storage.Close()
	}
	dataDir := pluginTestDataDir(tempDir)
	if err := storage.Open(dataDir); err != nil {
		t.Fatalf("openStore() error = %v", err)
	}
	defer func() {
		storage.Close()
	}()

	Configure(dataDir)
	data, err := os.ReadFile(filepath.Join("..", "..", "plugins", "overengineering-advisor", "manifest.json"))
	if err != nil {
		t.Fatalf("ReadFile(manifest) error = %v", err)
	}

	manager := NewPluginManager()
	if err := manager.Init(); err != nil {
		t.Fatalf("Init() error = %v", err)
	}
	defer manager.Shutdown()

	installed, err := manager.InstallPlugin(string(data))
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
	if len(installed.Manifest.Actions) != 4 {
		t.Fatalf("actions count = %d, want 4", len(installed.Manifest.Actions))
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
	if len(reloaded.Manifest.Actions) != 4 || len(reloaded.Manifest.UISlots) != 1 {
		t.Fatalf("reloaded manifest lost UI declarations: %#v", reloaded.Manifest)
	}
}

func TestPluginManifestAcceptsLowercaseEntrypoint(t *testing.T) {
	tempDir := t.TempDir()
	t.Setenv("APPDATA", tempDir)
	if storage.DB() != nil {
		storage.Close()
	}
	dataDir := pluginTestDataDir(tempDir)
	if err := storage.Open(dataDir); err != nil {
		t.Fatalf("openStore() error = %v", err)
	}
	defer func() {
		storage.Close()
	}()

	Configure(dataDir)
	data, err := os.ReadFile(filepath.Join("..", "..", "workspaces", "plugins", "echo-plugin", "manifest.json"))
	if err != nil {
		t.Fatalf("ReadFile(manifest) error = %v", err)
	}

	manager := NewPluginManager()
	if err := manager.Init(); err != nil {
		t.Fatalf("Init() error = %v", err)
	}
	defer manager.Shutdown()
	installed, err := manager.InstallPlugin(string(data))
	if err != nil {
		t.Fatalf("InstallPlugin() error = %v", err)
	}
	if got := installed.Manifest.EntryPoint; got != "main.py" {
		t.Fatalf("entry point = %q, want main.py", got)
	}
	if len(installed.Manifest.Actions) != 3 {
		t.Fatalf("actions count = %d, want 3", len(installed.Manifest.Actions))
	}
}

func TestPluginManagerInstallsCompletePythonPackage(t *testing.T) {
	tempDir := t.TempDir()
	t.Setenv("APPDATA", tempDir)

	if storage.DB() != nil {
		storage.Close()
	}
	dataDir := pluginTestDataDir(tempDir)
	if err := storage.Open(dataDir); err != nil {
		t.Fatalf("openStore() error = %v", err)
	}
	defer func() {
		storage.Close()
	}()

	Configure(dataDir)
	manifest, err := os.ReadFile(filepath.Join("..", "..", "plugins", "overengineering-advisor", "manifest.json"))
	if err != nil {
		t.Fatalf("ReadFile(manifest) error = %v", err)
	}
	mainFile, err := os.ReadFile(filepath.Join("..", "..", "plugins", "overengineering-advisor", "main.py"))
	if err != nil {
		t.Fatalf("ReadFile(main.py) error = %v", err)
	}

	manager := NewPluginManager()
	if err := manager.Init(); err != nil {
		t.Fatalf("Init() error = %v", err)
	}
	defer manager.Shutdown()

	if _, err := manager.InstallPlugin(string(manifest)); err != nil {
		t.Fatalf("InstallPlugin(manifest-only) error = %v", err)
	}
	installed, err := manager.InstallPluginPackage(string(manifest), map[string]string{
		"manifest.json": base64.StdEncoding.EncodeToString(manifest),
		"main.py":       base64.StdEncoding.EncodeToString(mainFile),
	})
	if err != nil {
		t.Fatalf("InstallPluginPackage() error = %v", err)
	}

	copied, err := os.ReadFile(filepath.Join(installed.InstallDir, "main.py"))
	if err != nil {
		t.Fatalf("installed main.py missing: %v", err)
	}
	if string(copied) != string(mainFile) {
		t.Fatal("installed main.py differs from package content")
	}
}

func TestPythonPluginExecutesInstalledActionEndToEnd(t *testing.T) {
	tempDir := t.TempDir()
	t.Setenv("APPDATA", tempDir)

	if storage.DB() != nil {
		storage.Close()
	}
	dataDir := pluginTestDataDir(tempDir)
	if err := storage.Open(dataDir); err != nil {
		t.Fatalf("openStore() error = %v", err)
	}
	defer func() {
		storage.Close()
	}()

	Configure(dataDir)
	manifest, err := os.ReadFile(filepath.Join("..", "..", "plugins", "pm-stress-simulator", "manifest.json"))
	if err != nil {
		t.Fatalf("ReadFile(manifest) error = %v", err)
	}
	mainFile, err := os.ReadFile(filepath.Join("..", "..", "plugins", "pm-stress-simulator", "main.py"))
	if err != nil {
		t.Fatalf("ReadFile(main.py) error = %v", err)
	}

	pluginManager := NewPluginManager()
	if err := pluginManager.Init(); err != nil {
		t.Fatalf("Init() error = %v", err)
	}
	defer pluginManager.Shutdown()
	if _, err := pluginManager.InstallPluginPackage(string(manifest), map[string]string{
		"manifest.json": base64.StdEncoding.EncodeToString(manifest),
		"main.py":       base64.StdEncoding.EncodeToString(mainFile),
	}); err != nil {
		t.Fatalf("InstallPluginPackage() error = %v", err)
	}

	adpython.Configure(dataDir)
	sdkDir, err := filepath.Abs(filepath.Join("..", "..", "python-sdk"))
	if err != nil {
		t.Fatalf("resolve Python SDK path: %v", err)
	}
	adpython.ConfigureSDKDir(sdkDir)
	sdkServer := adpython.NewSDKServer()
	sdkPort, err := sdkServer.Start()
	if err != nil {
		t.Fatalf("SDKServer.Start() error = %v", err)
	}
	defer sdkServer.Stop()

	workers := adpython.NewPythonWorkerManager()
	workers.SetSDKPort(sdkPort)
	defer workers.StopAll()
	if err := workers.SpawnWorker("pm-stress-simulator", map[string]string{}); err != nil {
		t.Fatalf("SpawnWorker() error = %v", err)
	}

	result, err := workers.Execute("pm-stress-simulator", "ask_update", []byte(`{"task":"test plugin"}`))
	if err != nil {
		t.Fatalf("Execute() error = %v", err)
	}
	var decoded map[string]interface{}
	if err := json.Unmarshal(result, &decoded); err != nil {
		t.Fatalf("Execute() result is not JSON: %v (%s)", err, result)
	}
	if got := decoded["task"]; got != "test plugin" {
		t.Fatalf("task = %#v, want test plugin", got)
	}
}
