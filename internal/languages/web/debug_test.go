package web

import (
	"errors"
	"path/filepath"
	"strings"
	"testing"

	"github.com/Andrea-Cavallo/adOmnia/internal/ide/dap"
	"github.com/Andrea-Cavallo/adOmnia/internal/ide/language"
	"github.com/Andrea-Cavallo/adOmnia/internal/jsonutil"
)

// quoteJSON serializza un valore per le opzioni di LanguageOptions nei test.
func quoteJSON(t *testing.T, value string) string {
	t.Helper()
	encoded, err := jsonutil.Marshal(value)
	if err != nil {
		t.Fatal(err)
	}
	return string(encoded)
}

// debugFixture scrive un progetto con un file da debuggare, un finto Node e il server DAP.
func debugFixture(t *testing.T) (root, node, adapter string) {
	t.Helper()
	root = t.TempDir()
	node = filepath.Join(root, "node")
	adapter = filepath.Join(root, "dapDebugServer.js")
	writeFile(t, node, "")
	writeFile(t, adapter, "// js-debug\n")
	writeFile(t, filepath.Join(root, "src", "app.js"), "const value = 21\nconsole.log(value * 2)\n")
	return root, node, adapter
}

func TestDebugAdapterNeedsTheInstalledServer(t *testing.T) {
	root, node, _ := debugFixture(t)
	_, err := ScriptLanguage().(dap.DebugAdapterProvider).DebugAdapter(dap.LaunchRequest{
		Root: root, WorkingDirectory: root, LanguageOptions: []byte(`{"kind":"script","program":"src/app.js","node":"` + strings.ReplaceAll(node, `\`, `\\`) + `"}`),
	})
	if err == nil || !strings.Contains(err.Error(), "not installed") || !strings.Contains(err.Error(), "install") {
		t.Fatalf("a missing js-debug must explain the install action, got %v", err)
	}
}

func TestDebugAdapterScriptRunsOnLoopbackWithTheKnownAddress(t *testing.T) {
	root, node, adapter := debugFixture(t)
	spec, err := ScriptLanguage().(dap.DebugAdapterProvider).DebugAdapter(dap.LaunchRequest{
		Root: root, WorkingDirectory: root, Environment: []string{"A=1"},
		LanguageOptions: []byte(`{"kind":"script","program":"src/app.js","programArguments":["--flag"],"node":` + quoteJSON(t, node) + `,"adapter":` + quoteJSON(t, adapter) + `}`),
	})
	if err != nil {
		t.Fatal(err)
	}
	if spec.Executable != node || len(spec.Arguments) != 3 || spec.Arguments[0] != adapter || spec.Arguments[2] != "127.0.0.1" {
		t.Fatalf("spec = %+v", spec)
	}
	if !strings.HasPrefix(spec.Address, "127.0.0.1:") || spec.ReadyPattern != "" || spec.Detach {
		t.Fatalf("the adapter must listen on loopback with a known address: %+v", spec)
	}
	if !strings.HasSuffix(spec.Address, ":"+spec.Arguments[1]) {
		t.Fatalf("the reserved port must be the one given to the server: %q %v", spec.Address, spec.Arguments)
	}
	command, configuration := spec.Launch("")
	if command != "launch" || configuration["type"] != "pwa-node" || configuration["request"] != "launch" {
		t.Fatalf("launch = %s %+v", command, configuration)
	}
	if configuration["program"] != filepath.Join(root, "src", "app.js") || configuration["console"] != "internalConsole" {
		t.Fatalf("configuration = %+v", configuration)
	}
	if arguments, _ := configuration["args"].([]string); len(arguments) != 1 || arguments[0] != "--flag" {
		t.Fatalf("program arguments = %+v", configuration["args"])
	}
}

func TestDebugAdapterCommandAttachesChildProcesses(t *testing.T) {
	root, node, adapter := debugFixture(t)
	spec, err := ScriptLanguage().(dap.DebugAdapterProvider).DebugAdapter(dap.LaunchRequest{
		Root: root, WorkingDirectory: root,
		LanguageOptions: []byte(`{"kind":"command","runtimeExecutable":"npm","runtimeArgs":["run","dev"],"node":` + quoteJSON(t, node) + `,"adapter":` + quoteJSON(t, adapter) + `}`),
	})
	if err != nil {
		t.Fatal(err)
	}
	_, configuration := spec.Launch("")
	if configuration["runtimeExecutable"] != "npm" || configuration["autoAttachChildProcesses"] != true {
		t.Fatalf("configuration = %+v", configuration)
	}
	if arguments, _ := configuration["runtimeArgs"].([]string); len(arguments) != 2 || arguments[1] != "dev" {
		t.Fatalf("runtime arguments = %+v", configuration["runtimeArgs"])
	}
	if spec.Title != "Debug npm run dev" {
		t.Fatalf("title = %q", spec.Title)
	}
}

func TestDebugAdapterRejectsProgramsOutsideTheProject(t *testing.T) {
	root, node, adapter := debugFixture(t)
	_, err := ScriptLanguage().(dap.DebugAdapterProvider).DebugAdapter(dap.LaunchRequest{
		Root: root, WorkingDirectory: root,
		LanguageOptions: []byte(`{"kind":"script","program":"../outside.js","node":` + quoteJSON(t, node) + `,"adapter":` + quoteJSON(t, adapter) + `}`),
	})
	if err == nil || !strings.Contains(err.Error(), "outside the project") {
		t.Fatalf("a program outside the project must be refused, got %v", err)
	}
	_, err = ScriptLanguage().(dap.DebugAdapterProvider).DebugAdapter(dap.LaunchRequest{
		Root: root, WorkingDirectory: root,
		LanguageOptions: []byte(`{"kind":"script","program":"src/missing.js","node":` + quoteJSON(t, node) + `,"adapter":` + quoteJSON(t, adapter) + `}`),
	})
	if err == nil || !strings.Contains(err.Error(), "does not exist") {
		t.Fatalf("a missing program must be reported, got %v", err)
	}
}

func TestDebugAdapterRejectsAnUnknownKind(t *testing.T) {
	root, node, adapter := debugFixture(t)
	_, err := ScriptLanguage().(dap.DebugAdapterProvider).DebugAdapter(dap.LaunchRequest{
		Root: root, WorkingDirectory: root,
		LanguageOptions: []byte(`{"kind":"chrome","node":` + quoteJSON(t, node) + `,"adapter":` + quoteJSON(t, adapter) + `}`),
	})
	if err == nil || !strings.Contains(err.Error(), "unsupported") {
		t.Fatalf("an unknown kind must be refused, got %v", err)
	}
}

func TestDebugAdapterExplainsAMissingNode(t *testing.T) {
	root, _, adapter := debugFixture(t)
	original := lookPath
	lookPath = func(string) (string, error) { return "", errors.New("not found") }
	defer func() { lookPath = original }()

	_, err := ScriptLanguage().(dap.DebugAdapterProvider).DebugAdapter(dap.LaunchRequest{
		Root: root, WorkingDirectory: root,
		LanguageOptions: []byte(`{"kind":"script","program":"src/app.js","adapter":` + quoteJSON(t, adapter) + `}`),
	})
	if err == nil || !strings.Contains(err.Error(), "Node.js was not found") {
		t.Fatalf("a missing Node must be explained, got %v", err)
	}
}

func TestScriptLanguageDeclaresDebugAndTests(t *testing.T) {
	capabilities := language.CapabilitiesOf(ScriptLanguage())
	if !capabilities.Debug || !capabilities.Tests {
		t.Fatalf("the JS/TS adapter must declare debug and tests: %+v", capabilities)
	}
}
