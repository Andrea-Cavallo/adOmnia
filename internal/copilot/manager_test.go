package copilot

import (
	"context"
	"encoding/json"
	"errors"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"sync/atomic"
	"testing"
	"time"

	"adomnia/internal/ide/lsp"
)

const fakeServerEnv = "ADOMNIA_FAKE_COPILOT_SERVER"
const fakeServerInitializeDelayEnv = "ADOMNIA_FAKE_COPILOT_INITIALIZE_DELAY"

// TestMain trasforma il binario di test in un Copilot Language Server finto quando lo avvia il manager.
func TestMain(m *testing.M) {
	if os.Getenv(fakeServerEnv) == "1" {
		runFakeServer()
		return
	}
	os.Exit(m.Run())
}

type fakeServer struct {
	conn        *lsp.Conn
	text        map[string]string
	initialized atomic.Bool
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
	case "workspace/didChangeWorkspaceFolders":
		if !s.initialized.Load() {
			s.log("EARLY workspace folders: addView called before server initialized")
		}
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
		if delay, err := time.ParseDuration(os.Getenv(fakeServerInitializeDelayEnv)); err == nil {
			time.Sleep(delay)
		}
		s.initialized.Store(true)
		return map[string]any{"serverInfo": map[string]string{"version": "9.9.9-fake"}, "capabilities": map[string]any{"inlineCompletionProvider": map[string]any{}}}, nil
	case "checkStatus":
		return map[string]string{"status": "OK", "user": "octocat"}, nil
	case "textDocument/inlineCompletion":
		return map[string]any{"items": []map[string]any{{
			"insertText": "return nil, err",
			"range":      map[string]any{"start": map[string]int{"line": 2, "character": 4}, "end": map[string]int{"line": 2, "character": 4}},
			"command":    map[string]any{"command": "github.copilot.didAcceptCompletionItem", "arguments": []string{"id-1"}},
		}}}, nil
	case "copilot/models":
		if string(params) == "null" {
			return nil, errors.New("copilot/models requires an object parameter")
		}
		return []map[string]any{
			{"id": "auto", "name": "Auto", "scopes": []string{"chat-panel"}, "isChatDefault": true},
			{"id": "fast", "name": "Fast", "scopes": []string{"chat-panel"}},
			{"id": "completion-only", "name": "Completion", "scopes": []string{"inline"}},
		}, nil
	case "conversation/create":
		var request struct {
			Token     string            `json:"workDoneToken"`
			ModelInfo map[string]string `json:"modelInfo"`
		}
		_ = json.Unmarshal(params, &request)
		if request.ModelInfo["id"] == "" {
			return nil, errors.New("A model id is required: provide modelInfo.id or the deprecated model field")
		}
		if request.Token == "chat-fast" && request.ModelInfo["id"] != "fast" {
			return nil, errors.New("selected model was not forwarded")
		}
		_ = s.conn.Notify("$/progress", map[string]any{"token": request.Token, "value": map[string]any{"kind": "begin"}})
		_ = s.conn.Notify("$/progress", map[string]any{"token": request.Token, "value": map[string]any{"kind": "report", "reply": "Use "}})
		_ = s.conn.Notify("$/progress", map[string]any{"token": request.Token, "value": map[string]any{"kind": "report", "editAgentRounds": []map[string]string{{"reply": "context."}}}})
		_ = s.conn.Notify("$/progress", map[string]any{"token": request.Token, "value": map[string]any{"kind": "end", "conversationId": "conversation-1", "turnId": "turn-1", "suggestedTitle": "Context"}})
		return map[string]string{"conversationId": "conversation-1", "turnId": "turn-1"}, nil
	case "conversation/turn":
		var request struct {
			Token string `json:"workDoneToken"`
		}
		_ = json.Unmarshal(params, &request)
		_ = s.conn.Notify("$/progress", map[string]any{"token": request.Token, "value": map[string]any{"kind": "report", "reply": "Follow-up"}})
		_ = s.conn.Notify("$/progress", map[string]any{"token": request.Token, "value": map[string]any{"kind": "end", "conversationId": "conversation-1", "turnId": "turn-2"}})
		return map[string]string{"conversationId": "conversation-1", "turnId": "turn-2"}, nil
	case "conversation/destroy":
		return nil, nil
	case "shutdown":
		return nil, nil
	}
	return nil, lsp.ErrMethodNotFound
}

func TestChatStreamsAndFiltersWorkspaceContext(t *testing.T) {
	root := t.TempDir()
	manager := startFakeManager(t, DefaultProfile(), root)
	if err := os.MkdirAll(filepath.Join(root, ".adomnia"), 0o700); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(root, ".adomnia", "aiignore"), []byte("private/**\n"), 0o600); err != nil {
		t.Fatal(err)
	}
	if err := os.MkdirAll(filepath.Join(root, "private"), 0o700); err != nil {
		t.Fatal(err)
	}
	for name, content := range map[string]string{"go.mod": "module example.test\n", "main.go": "package main\nfunc main() {}\n", ".env": "TOKEN=secret", "private/customer.go": "package private"} {
		path := filepath.Join(root, filepath.FromSlash(name))
		if err := os.MkdirAll(filepath.Dir(path), 0o700); err != nil {
			t.Fatal(err)
		}
		if err := os.WriteFile(path, []byte(content), 0o600); err != nil {
			t.Fatal(err)
		}
	}
	manager.DocumentOpened(OpenedDocument{ID: "chat-doc", URI: fileURI(filepath.Join(root, "main.go")), Root: root, RootName: "demo", RelativePath: "main.go", LanguageID: "go", Text: "package main\nfunc main() {}\n"})

	var events []ChatEvent
	var eventMu sync.Mutex
	manager.SetEmitter(func(event string, payload any) {
		if event == "copilot.chat" {
			eventMu.Lock()
			events = append(events, payload.(ChatEvent))
			eventMu.Unlock()
		}
	})
	response, err := manager.Chat(context.Background(), ChatRequest{Token: "chat-1", Message: "Explain this", DocumentID: "chat-doc", IncludeDocument: true, IncludeWorkspace: true, Selection: &ChatSelection{StartLine: 1, StartCharacter: 0, EndLine: 1, EndCharacter: 14}})
	if err != nil {
		t.Fatal(err)
	}
	if response.ConversationID != "conversation-1" || response.Model != "auto" {
		t.Fatalf("unexpected response: %+v", response)
	}
	eventMu.Lock()
	defer eventMu.Unlock()
	var reply string
	for _, event := range events {
		reply += event.Reply
	}
	if reply != "Use context." || len(events) != 4 || events[len(events)-1].Kind != "end" {
		t.Fatalf("unexpected progress: %+v", events)
	}
	manifest := buildWorkspaceManifest(root)
	if !strings.Contains(manifest, "main.go") || strings.Contains(manifest, ".env") || strings.Contains(manifest, "private/customer.go") {
		t.Fatalf("workspace manifest leaked or omitted files: %s", manifest)
	}
}

func TestChatModelsFiltersScopesAndSelectedModelIsSent(t *testing.T) {
	manager := startFakeManager(t, DefaultProfile(), t.TempDir())
	models, err := manager.ChatModels()
	if err != nil {
		t.Fatal(err)
	}
	if len(models) != 2 || models[0].ID != "auto" || models[1].ID != "fast" || models[0].Name != "Auto" {
		t.Fatalf("unexpected chat models: %+v", models)
	}
	response, err := manager.Chat(context.Background(), ChatRequest{Token: "chat-fast", Model: "fast", Message: "Be quick"})
	if err != nil {
		t.Fatal(err)
	}
	if response.Model != "fast" {
		t.Fatalf("selected model not returned: %+v", response)
	}
}

func TestSelectionTextUsesUTF16Positions(t *testing.T) {
	text := "zero\nA😀BC\nlast"
	selected, ok := selectionText(text, ChatSelection{StartLine: 1, StartCharacter: 1, EndLine: 1, EndCharacter: 4})
	if !ok || selected != "😀B" {
		t.Fatalf("selected=%q ok=%v", selected, ok)
	}
}

func TestWorkspaceFoldersWaitUntilServerInitialized(t *testing.T) {
	t.Setenv(fakeServerInitializeDelayEnv, "250ms")
	manager := newFakeManager(t, DefaultProfile())
	root := t.TempDir()
	manager.mu.Lock()
	manager.root = root
	manager.mu.Unlock()
	started := make(chan error, 1)
	go func() { started <- manager.Start() }()
	waitFor(t, func() bool {
		manager.mu.Lock()
		defer manager.mu.Unlock()
		return manager.current != nil
	}, "Copilot process created")
	manager.DocumentOpened(OpenedDocument{ID: "during-init", URI: fileURI(filepath.Join(root, "main.go")), Root: root, RootName: "during-init", RelativePath: "main.go", LanguageID: "go", Text: "package main\n"})
	if err := <-started; err != nil {
		t.Fatal(err)
	}
	if log := strings.Join(manager.Log(), "\n"); strings.Contains(log, "EARLY workspace folders") {
		t.Fatalf("workspace notification escaped before initialized:\n%s", log)
	}
}

func startFakeManager(t *testing.T, profile GitHubProfile, root string) *Manager {
	t.Helper()
	manager := newFakeManager(t, profile)
	manager.root = root
	if err := manager.Start(); err != nil {
		t.Fatal(err)
	}
	waitFor(t, func() bool { return manager.Status().State == StateReady }, "copilot ready")
	return manager
}

func newFakeManager(t *testing.T, profile GitHubProfile) *Manager {
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
	root := t.TempDir()
	manager := startFakeManager(t, work, root)
	status := manager.Status()
	if status.User != "octocat" || status.Profile.Host != "company.ghe.com" || status.ServerVersion != "9.9.9-fake" {
		t.Fatalf("unexpected status: %+v", status)
	}
	waitFor(t, func() bool { return logContains(manager, `"github-enterprise":{"uri":"https://company.ghe.com"}`) }, "enterprise configuration")

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
	root := t.TempDir()
	manager := startFakeManager(t, DefaultProfile(), root)
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
	root := t.TempDir()
	manager := startFakeManager(t, DefaultProfile(), root)
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
