package copilot

import (
	"context"
	"encoding/json"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"adomnia/internal/goide/lsp"
)

const fakeServerEnv = "ADOMNIA_FAKE_COPILOT_SERVER"

// TestMain trasforma il binario di test in un Copilot Language Server finto quando lo avvia il manager.
func TestMain(m *testing.M) {
	if os.Getenv(fakeServerEnv) == "1" {
		runFakeServer()
		return
	}
	os.Exit(m.Run())
}

type fakeServer struct {
	conn *lsp.Conn
	text map[string]string
}

func runFakeServer() {
	server := &fakeServer{text: map[string]string{}}
	server.conn = lsp.NewConn(os.Stdin, os.Stdout, server)
	server.conn.Run()
}

func (s *fakeServer) log(message string) {
	_ = s.conn.Notify("window/logMessage", map[string]any{"type": 3, "message": message})
}

func (s *fakeServer) HandleNotification(method string, params json.RawMessage) {
	switch method {
	case "workspace/didChangeConfiguration":
		s.log("config " + string(params))
	case "textDocument/didOpen":
		var open struct {
			TextDocument lsp.TextDocumentItem `json:"textDocument"`
		}
		_ = json.Unmarshal(params, &open)
		s.text[open.TextDocument.URI] = open.TextDocument.Text
		s.log("open " + open.TextDocument.URI)
	case "exit":
		os.Exit(0)
	}
}

func (s *fakeServer) HandleRequest(_ context.Context, method string, params json.RawMessage) (any, error) {
	switch method {
	case "initialize":
		return map[string]any{"serverInfo": map[string]string{"version": "9.9.9-fake"}, "capabilities": map[string]any{"inlineCompletionProvider": map[string]any{}}}, nil
	case "checkStatus":
		return map[string]string{"status": "OK", "user": "octocat"}, nil
	case "textDocument/inlineCompletion":
		return map[string]any{"items": []map[string]any{{
			"insertText": "return nil, err",
			"range":      map[string]any{"start": map[string]int{"line": 2, "character": 4}, "end": map[string]int{"line": 2, "character": 4}},
			"command":    map[string]any{"command": "github.copilot.didAcceptCompletionItem", "arguments": []string{"id-1"}},
		}}}, nil
	case "shutdown":
		return nil, nil
	}
	return nil, lsp.ErrMethodNotFound
}

func startFakeManager(t *testing.T, profile GitHubProfile) *Manager {
	t.Helper()
	t.Setenv(fakeServerEnv, "1")
	executable, err := os.Executable()
	if err != nil {
		t.Fatal(err)
	}
	directory := t.TempDir()
	store := NewSettingsStore(directory)
	settings := DefaultSettings()
	settings.Enabled = true
	settings.BinaryPath = executable
	settings.Profiles = []GitHubProfile{profile}
	settings.ActiveProfileID = profile.ID
	if _, err := store.Save(settings); err != nil {
		t.Fatal(err)
	}
	manager := NewManager(store, NewInstaller(directory))
	t.Cleanup(manager.Shutdown)
	if err := manager.Start(); err != nil {
		t.Fatal(err)
	}
	waitFor(t, func() bool { return manager.Status().State == StateReady }, "copilot ready")
	return manager
}

func waitFor(t *testing.T, condition func() bool, what string) {
	t.Helper()
	deadline := time.Now().Add(10 * time.Second)
	for time.Now().Before(deadline) {
		if condition() {
			return
		}
		time.Sleep(20 * time.Millisecond)
	}
	t.Fatalf("timed out waiting for %s", what)
}

func logContains(manager *Manager, text string) bool {
	for _, line := range manager.Log() {
		if strings.Contains(line, text) {
			return true
		}
	}
	return false
}

func TestManagerReadyWithEnterpriseHostAndGhostText(t *testing.T) {
	work, err := NewProfile("work", "Work", "company.ghe.com")
	if err != nil {
		t.Fatal(err)
	}
	manager := startFakeManager(t, work)
	status := manager.Status()
	if status.User != "octocat" || status.Profile.Host != "company.ghe.com" || status.ServerVersion != "9.9.9-fake" {
		t.Fatalf("unexpected status: %+v", status)
	}
	waitFor(t, func() bool { return logContains(manager, `"github-enterprise":{"uri":"https://company.ghe.com"}`) }, "enterprise configuration")

	root := t.TempDir()
	manager.DocumentOpened(OpenedDocument{ID: "doc-1", URI: fileURI(filepath.Join(root, "main.go")), Root: root, RootName: "demo", RelativePath: "main.go", LanguageID: "go", Text: "package main\n"})
	waitFor(t, func() bool { return logContains(manager, "open file://") }, "didOpen")
	items, err := manager.InlineCompletion(context.Background(), InlineCompletionRequest{DocumentID: "doc-1", Version: 1, Line: 3, Column: 5, TabSize: 4, Automatic: true})
	if err != nil {
		t.Fatal(err)
	}
	if len(items) != 1 || items[0].InsertText != "return nil, err" || items[0].StartLine != 3 || items[0].StartColumn != 5 {
		t.Fatalf("unexpected items: %+v", items)
	}
	if !strings.Contains(string(items[0].Raw), "didAcceptCompletionItem") {
		t.Fatal("raw item must keep the acceptance command for telemetry")
	}
}

func TestSensitiveFilesNeverReachCopilot(t *testing.T) {
	manager := startFakeManager(t, DefaultProfile())
	root := t.TempDir()
	manager.DocumentOpened(OpenedDocument{ID: "env", URI: fileURI(filepath.Join(root, ".env")), Root: root, RootName: "demo", RelativePath: ".env", LanguageID: "dotenv", Text: "TOKEN=secret"})
	if _, err := manager.InlineCompletion(context.Background(), InlineCompletionRequest{DocumentID: "env", Line: 1, Column: 1}); err != ErrExcluded {
		t.Fatalf("expected ErrExcluded, got %v", err)
	}
	time.Sleep(100 * time.Millisecond)
	if logContains(manager, ".env") {
		t.Fatal(".env must never be sent to the language server")
	}
}

func TestStaleBufferGivesNoSuggestion(t *testing.T) {
	manager := startFakeManager(t, DefaultProfile())
	root := t.TempDir()
	manager.DocumentOpened(OpenedDocument{ID: "doc", URI: fileURI(filepath.Join(root, "a.go")), Root: root, RootName: "demo", RelativePath: "a.go", LanguageID: "go", Text: "package a\n"})
	items, err := manager.InlineCompletion(context.Background(), InlineCompletionRequest{DocumentID: "doc", Version: 5, Line: 1, Column: 1})
	if err != nil || len(items) != 0 {
		t.Fatalf("a request newer than the synced buffer must return nothing: %+v %v", items, err)
	}
}

func TestContextFilterAIIgnore(t *testing.T) {
	root := t.TempDir()
	if err := os.MkdirAll(filepath.Join(root, ".adomnia"), 0o700); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(root, ".adomnia", "aiignore"), []byte("# customer data\ncustomer-data/**\n*.sql\n"), 0o600); err != nil {
		t.Fatal(err)
	}
	filter := LoadContextFilter(root)
	for path, excluded := range map[string]bool{
		"main.go": false, "internal/api/server.go": false, ".env": true, "config/.env.prod": true, "certs/server.key": true,
		"customer-data/export.csv": true, "db/seed.sql": true, "deploy/secrets/app.yaml": true,
	} {
		if got := filter.Excluded(path); got != excluded {
			t.Fatalf("%s: excluded=%v, want %v", path, got, excluded)
		}
	}
}
