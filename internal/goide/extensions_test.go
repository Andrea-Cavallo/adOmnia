package goide

import (
	"adomnia/internal/plugins"
	"adomnia/internal/storage"
	"encoding/base64"
	"os"
	"path/filepath"
	"runtime"
	"strings"
	"testing"
)

func extensionFixture(t *testing.T, serverCommand ...string) (*Service, *plugins.PluginManager) {
	t.Helper()
	dir := t.TempDir()
	if err := storage.Open(dir); err != nil {
		t.Fatal(err)
	}
	t.Cleanup(storage.Close)
	plugins.Configure(dir)
	manager := plugins.NewPluginManager()
	plugins.AttachRuntime(manager, plugins.NewWasmRuntime())
	if err := manager.Init(); err != nil {
		t.Fatal(err)
	}
	t.Cleanup(manager.Shutdown)
	manifest := `{"id":"ide-test","name":"IDE test","runtime":"js","entryPoint":"main.js","actions":[{"id":"inspect","name":"Inspect"}],"contributes":{"commands":[{"id":"inspect","title":"Inspect","action":"inspect"}],"codeActions":[{"id":"fix","title":"Fix","action":"inspect"}],"analyzers":[{"id":"lint","name":"Lint","action":"inspect","languages":["go"]}],"templates":[{"id":"demo","name":"Demo","directory":"templates/demo"}],"languages":[{"id":"demo","name":"Demo","extensions":[".demo"],"server":{"command":"adomnia-no-such-server"}}]}}`
	if len(serverCommand) > 0 {
		manifest = strings.ReplaceAll(manifest, "adomnia-no-such-server", serverCommand[0])
	}
	files := map[string]string{}
	for name, data := range map[string]string{"main.js": `export function inspect(args) { return {text: args.text + "\n// extension", message: args.relativePath, diagnostics:[{line:1,message:"Inspect"}]}; }`, "templates/demo/main.go.tmpl": "package main\n// __MODULE__\nfunc main() {}\n"} {
		files[name] = base64.StdEncoding.EncodeToString([]byte(data))
	}
	if _, err := manager.InstallPluginPackage(manifest, files); err != nil {
		t.Fatal(err)
	}
	if err := manager.EnablePlugin("ide-test"); err != nil {
		t.Fatal(err)
	}
	service := NewService(&memoryStore{}, nil)
	service.SetExtensionManager(manager)
	t.Cleanup(service.Shutdown)
	return service, manager
}

func TestIDEExtensionLanguageServerUsesGenericLifecycleAndBuffers(t *testing.T) {
	executable, err := os.Executable()
	if err != nil {
		t.Fatal(err)
	}
	binary, err := os.ReadFile(executable)
	if err != nil {
		t.Fatal(err)
	}
	binDir := t.TempDir()
	command := "demo-lsp"
	filename := command
	if runtime.GOOS == "windows" {
		filename += ".exe"
	}
	if err := os.WriteFile(filepath.Join(binDir, filename), binary, 0755); err != nil {
		t.Fatal(err)
	}
	t.Setenv("PATH", binDir+string(os.PathListSeparator)+os.Getenv("PATH"))
	t.Setenv(fakeGoplsEnv, "1")
	service, manager := extensionFixture(t, command)
	root := t.TempDir()
	os.WriteFile(filepath.Join(root, "source.demo"), []byte("saved"), 0600)
	session, err := service.OpenProject(root)
	if err != nil {
		t.Fatal(err)
	}
	doc, err := service.OpenDocument(string(session.ID), "source.demo")
	if err != nil {
		t.Fatal(err)
	}
	service.SetToolAuthorization(string(session.ID), true)
	status, err := service.StartExtensionLanguageServer(string(session.ID), "demo")
	if err != nil || status.State != LanguageServerReady {
		t.Fatalf("LSP handshake: %+v %v", status, err)
	}
	if err := service.UpdateDocumentBuffer(string(session.ID), string(doc.Document.ID), 2, "unsaved"); err != nil {
		t.Fatal(err)
	}
	state, ok := service.lsp.forDocument(session.ID, doc.Document.ID)
	if !ok {
		t.Fatal("extension document not tracked")
	}
	state.mu.Lock()
	text := state.documents[doc.Document.ID].text
	state.mu.Unlock()
	if text != "unsaved" {
		t.Fatal("unsaved buffer not synced")
	}
	manager.DisablePlugin("ide-test")
	service.IDEContributions()
	status, err = service.ExtensionLanguageStatus(string(session.ID), "demo")
	if err != nil || status.State != LanguageServerStopped {
		t.Fatalf("disabled LSP remains running: %+v %v", status, err)
	}
}

func TestIDEExtensionSandboxContextTrustAndDisable(t *testing.T) {
	service, manager := extensionFixture(t)
	root := t.TempDir()
	os.WriteFile(filepath.Join(root, "main.go"), []byte("package main\n"), 0600)
	session, err := service.OpenProject(root)
	if err != nil {
		t.Fatal(err)
	}
	doc, err := service.OpenDocument(string(session.ID), "main.go")
	if err != nil {
		t.Fatal(err)
	}
	request := IDEExtensionRequest{SessionID: string(session.ID), PluginID: "ide-test", ID: "inspect", Kind: "command", DocumentID: string(doc.Document.ID), Text: "package main\n// unsaved"}
	if _, err := service.InvokeIDEExtension(request); err == nil {
		t.Fatal("untrusted project invoked extension")
	}
	if _, err := service.SetToolAuthorization(string(session.ID), true); err != nil {
		t.Fatal(err)
	}
	result, err := service.InvokeIDEExtension(request)
	if err != nil || !result.Success {
		t.Fatalf("sandbox action: %+v %v", result, err)
	}
	data := result.Data.(map[string]interface{})
	if data["text"] != request.Text+"\n// extension" || data["message"] != "main.go" {
		t.Fatalf("context not delivered: %#v", data)
	}
	original, _ := os.ReadFile(filepath.Join(root, "main.go"))
	if string(original) != "package main\n" {
		t.Fatal("action wrote file without review")
	}
	request.DocumentID = "other-project-document"
	if _, err := service.InvokeIDEExtension(request); err == nil {
		t.Fatal("cross-project document accepted")
	}
	request.DocumentID = string(doc.Document.ID)
	request.ID = "undeclared"
	if _, err := service.InvokeIDEExtension(request); err == nil {
		t.Fatal("undeclared contribution accepted")
	}
	manager.DisablePlugin("ide-test")
	request.ID = "inspect"
	if _, err := service.InvokeIDEExtension(request); err == nil {
		t.Fatal("disabled extension ran")
	}
	service.IDEContributions()
	if _, _, ok := service.workspace.languages.ForPath("file.demo"); ok {
		t.Fatal("disabled language still registered")
	}
}

func TestIDEExtensionTemplateCreatesRealProjectAndLanguageLifecycle(t *testing.T) {
	service, manager := extensionFixture(t)
	templates, err := service.ListProjectTemplates()
	if err != nil {
		t.Fatal(err)
	}
	found := false
	for _, template := range templates.Templates {
		found = found || template.ID == "plugin:ide-test:demo"
	}
	if !found {
		t.Fatal("plugin template not listed")
	}
	created, err := service.CreateProject(CreateProjectRequest{ParentPath: t.TempDir(), Name: "demo", ModulePath: "example.com/demo", Template: "plugin:ide-test:demo", Confirmed: true})
	if err != nil {
		t.Fatal(err)
	}
	content, err := os.ReadFile(filepath.Join(created.Session.Project.RealPath, "main.go"))
	if err != nil || !strings.Contains(string(content), "example.com/demo") {
		t.Fatalf("template not rendered: %s %v", content, err)
	}
	if owner, id, ok := service.workspace.languages.ForPath("source.demo"); !ok || owner.ID() != "demo" || id != "demo" {
		t.Fatal("language selector not registered")
	}
	if _, err := service.StartExtensionLanguageServer(string(created.Session.ID), "demo"); err == nil || !strings.Contains(err.Error(), "trust") {
		t.Fatal("untrusted LSP launch accepted")
	}
	service.SetToolAuthorization(string(created.Session.ID), true)
	if _, err := service.StartExtensionLanguageServer(string(created.Session.ID), "demo"); err == nil {
		t.Fatal("missing LSP was reported available")
	}
	paths, err := service.RemoteSourceFiles(string(created.Session.ID))
	if err != nil || len(paths) != 1 || paths[0] != "main.go" {
		t.Fatalf("source index: %v %v", paths, err)
	}
	manager.DisablePlugin("ide-test")
	if _, _, err := service.resolveProjectTemplate("plugin:ide-test:demo"); err == nil {
		t.Fatal("disabled template resolved")
	}
}
