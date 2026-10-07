package plugins

import (
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"testing"
	"time"
)

func writePluginDir(t *testing.T, files map[string]string) string {
	t.Helper()
	dir := t.TempDir()
	for name, content := range files {
		path := filepath.Join(dir, filepath.FromSlash(name))
		if err := os.MkdirAll(filepath.Dir(path), 0o755); err != nil {
			t.Fatal(err)
		}
		if err := os.WriteFile(path, []byte(content), 0o644); err != nil {
			t.Fatal(err)
		}
	}
	return dir
}

// A real WASI module built from Go source: the contract is JSON on stdin, JSON on stdout, logs on stderr.
func TestWasmPluginExecutesAction(t *testing.T) {
	goTool, err := exec.LookPath("go")
	if err != nil {
		t.Skip("go toolchain not available")
	}
	src := writePluginDir(t, map[string]string{
		"go.mod": "module wasmplugin\n\ngo 1.21\n",
		"main.go": `package main

import (
	"encoding/json"
	"fmt"
	"os"
)

func main() {
	var in struct {
		Function string                 ` + "`json:\"function\"`" + `
		Args     map[string]interface{} ` + "`json:\"args\"`" + `
	}
	if err := json.NewDecoder(os.Stdin).Decode(&in); err != nil {
		fmt.Fprintln(os.Stderr, "bad input:", err)
		os.Exit(2)
	}
	fmt.Fprintln(os.Stderr, "called", in.Function)
	if in.Function == "fail" {
		fmt.Fprintln(os.Stderr, "boom")
		os.Exit(1)
	}
	if _, err := os.ReadFile("/etc/hostname"); err == nil {
		fmt.Fprintln(os.Stderr, "filesystem must not be visible")
		os.Exit(3)
	}
	json.NewEncoder(os.Stdout).Encode(map[string]interface{}{"upper": fmt.Sprint(in.Args["text"]) + "!", "function": in.Function})
}
`,
	})
	plugin := writePluginDir(t, map[string]string{
		"manifest.json": `{"id":"wasm-echo","name":"Wasm echo","runtime":"wasm","entryPoint":"plugin.wasm",
			"actions":[{"id":"shout","name":"Shout"},{"id":"fail","name":"Fail"}],
			"contributes":{"commands":[{"id":"echo.shout","title":"Shout","action":"shout"}]}}`,
	})
	build := exec.Command(goTool, "build", "-o", filepath.Join(plugin, "plugin.wasm"), ".")
	build.Dir = src
	build.Env = append(os.Environ(), "GOOS=wasip1", "GOARCH=wasm")
	if output, err := build.CombinedOutput(); err != nil {
		t.Skipf("cannot build wasip1 module: %v\n%s", err, output)
	}

	manager, _ := newTestPluginManager(t)
	if _, err := manager.InstallPluginDirectory(plugin); err != nil {
		t.Fatal(err)
	}
	if err := manager.EnablePlugin("wasm-echo"); err != nil {
		t.Fatal(err)
	}
	result := manager.ExecuteAction("wasm-echo", "shout", map[string]interface{}{"text": "hi"})
	if !result.Success {
		t.Fatalf("execution failed: %s", result.Error)
	}
	data := result.Data.(map[string]interface{})
	if data["upper"] != "hi!" || data["function"] != "shout" {
		t.Fatalf("result = %+v", data)
	}
	if failed := manager.ExecuteAction("wasm-echo", "fail", nil); failed.Success || !strings.Contains(failed.Error, "boom") {
		t.Fatalf("failure not reported: %+v", failed)
	}
	logs := manager.GetPluginLogs("wasm-echo")
	if len(logs) < 2 || logs[0].Message != "called shout" {
		t.Fatalf("stderr not logged: %+v", logs)
	}
	contributions := manager.GetContributions()
	if len(contributions) != 1 || contributions[0].Kind != "command" || contributions[0].Action != "shout" {
		t.Fatalf("contributions = %+v", contributions)
	}
}

func TestContributesValidation(t *testing.T) {
	cases := map[string]string{
		"undeclared action": `{"id":"p","runtime":"js","actions":[],"contributes":{"commands":[{"id":"c","action":"missing"}]}}`,
		"go is reserved":    `{"id":"p","runtime":"none","contributes":{"languages":[{"id":"go","name":"Go","extensions":[".go"]}]}}`,
		"server is a path":  `{"id":"p","runtime":"none","contributes":{"languages":[{"id":"zig","name":"Zig","extensions":[".zig"],"server":{"command":"C:\\evil.exe"}}]}}`,
		"template escapes":  `{"id":"p","runtime":"none","contributes":{"templates":[{"id":"t","name":"T","directory":"../x"}]}}`,
		"adapter kind":      `{"id":"p","runtime":"none","contributes":{"adapters":[{"kind":"cache","id":"a","name":"A","modules":["x.io/y"]}]}}`,
	}
	manager, _ := newTestPluginManager(t)
	for name, manifest := range cases {
		if _, err := manager.InstallPlugin(manifest); err == nil {
			t.Errorf("%s: manifest accepted", name)
		}
	}
	ok := `{"id":"zig-support","name":"Zig","runtime":"none","contributes":{
		"languages":[{"id":"zig","name":"Zig","extensions":[".zig"],"server":{"command":"zls"}}],
		"templates":[{"id":"zig-app","name":"Zig app","directory":"templates/app"}],
		"adapters":[{"kind":"framework","id":"echo","name":"Echo","modules":["github.com/labstack/echo"]}]}}`
	if _, err := manager.InstallPlugin(ok); err != nil {
		t.Fatal(err)
	}
	if err := manager.EnablePlugin("zig-support"); err != nil {
		t.Fatal(err)
	}
	kinds := map[string]bool{}
	for _, item := range manager.GetContributions() {
		kinds[item.Kind] = true
		if item.Kind == "template" && !strings.HasSuffix(filepath.ToSlash(item.Directory), "zig-support/templates/app") {
			t.Errorf("template directory = %s", item.Directory)
		}
	}
	if !kinds["language"] || !kinds["template"] || !kinds["adapter"] {
		t.Fatalf("missing contributions: %v", kinds)
	}
}

func TestSignedPluginLifecycle(t *testing.T) {
	manager, _ := newTestPluginManager(t)
	source := writePluginDir(t, map[string]string{
		"manifest.json": `{"id":"signed","name":"Signed","runtime":"js","entryPoint":"main.js","actions":[{"id":"run","name":"Run"}]}`,
		"main.js":       "export function run() { return { ok: true } }\n",
	})
	key, err := manager.GeneratePluginSigningKey()
	if err != nil {
		t.Fatal(err)
	}
	signature, err := manager.SignPluginDirectory(source, key.PrivateKey)
	if err != nil || signature.Status != "valid" || signature.Trusted {
		t.Fatalf("sign = %+v %v", signature, err)
	}
	installed, err := manager.InstallPluginDirectory(source)
	if err != nil {
		t.Fatal(err)
	}
	if got, _ := manager.GetPlugin("signed"); got.Signature == nil || got.Signature.Status != "valid" || got.Signature.KeyID != key.KeyID {
		t.Fatalf("installed signature = %+v", got.Signature)
	}
	if err := manager.TrustPluginKey(key.PublicKey); err != nil {
		t.Fatal(err)
	}
	if got, _ := manager.GetPlugin("signed"); !got.Signature.Trusted {
		t.Fatal("trusted key not applied")
	}
	if err := manager.EnablePlugin("signed"); err != nil {
		t.Fatal(err)
	}
	// Tampering after signing: the plugin is disabled and cannot be enabled again.
	if err := os.WriteFile(filepath.Join(installed.InstallDir, "main.js"), []byte("export function run() { return { evil: true } }\n"), 0o644); err != nil {
		t.Fatal(err)
	}
	manager.refreshSignatures()
	got, _ := manager.GetPlugin("signed")
	if got.Signature.Status != "invalid" || got.Enabled {
		t.Fatalf("tampered plugin still enabled: %+v", got.Signature)
	}
	if err := manager.EnablePlugin("signed"); err == nil {
		t.Fatal("tampered plugin enabled")
	}
}

func TestDevPluginHotReload(t *testing.T) {
	manager, _ := newTestPluginManager(t)
	source := writePluginDir(t, map[string]string{
		"manifest.json": `{"id":"dev","name":"Dev","runtime":"js","entryPoint":"main.js","actions":[{"id":"run","name":"Run"}]}`,
		"main.js":       "export function run() { adomnia.log.info('v1'); return { version: 1 } }\n",
	})
	if _, err := manager.LinkDevPlugin(source); err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = manager.UnlinkDevPlugin("dev") })
	if err := manager.EnablePlugin("dev"); err != nil {
		t.Fatal(err)
	}
	if result := manager.ExecuteAction("dev", "run", nil); !result.Success || result.Data.(map[string]interface{})["version"] != float64(1) {
		t.Fatalf("v1 = %+v", result)
	}
	if err := os.WriteFile(filepath.Join(source, "main.js"), []byte("export function run() { return { version: 2 } }\n"), 0o644); err != nil {
		t.Fatal(err)
	}
	deadline := time.Now().Add(5 * time.Second)
	for time.Now().Before(deadline) {
		if result := manager.ExecuteAction("dev", "run", nil); result.Success && result.Data.(map[string]interface{})["version"] == float64(2) {
			logs := manager.GetPluginLogs("dev")
			var reloaded, logged bool
			for _, entry := range logs {
				reloaded = reloaded || (entry.Level == "reload" && strings.HasPrefix(entry.Message, "reloaded"))
				logged = logged || entry.Message == "v1"
			}
			if reloaded && logged {
				return
			}
		}
		time.Sleep(100 * time.Millisecond)
	}
	t.Fatal("the plugin was not reloaded after the source changed")
}
