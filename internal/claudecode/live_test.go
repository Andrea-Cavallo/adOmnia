package claudecode

import (
	"context"
	"net/http"
	"net/http/httptest"
	"os"
	"strings"
	"sync"
	"testing"
	"time"

	"adomnia/internal/milk"
)

// TestLiveClaudeCodeTurn parla con il vero adapter (Node + login di `claude`).
// Costa token: gira solo con ADOMNIA_LIVE_CLAUDE=1.
func TestLiveClaudeCodeTurn(t *testing.T) {
	if os.Getenv("ADOMNIA_LIVE_CLAUDE") != "1" {
		t.Skip("set ADOMNIA_LIVE_CLAUDE=1 to run against the real Claude Code adapter")
	}
	root := t.TempDir()
	if err := os.WriteFile(root+"/hello.txt", []byte("hi"), 0o600); err != nil {
		t.Fatal(err)
	}
	manager := milk.NewAgentManager(milk.NewSettingsStoreFile(t.TempDir(), "claude-code.json"), Agent())
	var mu sync.Mutex
	var events []string
	var reply strings.Builder
	manager.SetEmitter(func(event string, payload any) {
		mu.Lock()
		defer mu.Unlock()
		if chat, ok := payload.(milk.ChatEvent); ok {
			events = append(events, event+":"+chat.Kind)
			if chat.Kind == "text" {
				reply.WriteString(chat.Reply)
			}
			if chat.Tool != nil {
				t.Logf("tool %s %s", chat.Tool.Name, chat.Tool.Status)
			}
		}
	})
	if _, err := manager.SaveSettings(milk.Settings{Enabled: true, IgnoreAPIKey: true}); err != nil {
		t.Fatal(err)
	}
	deadline := time.Now().Add(3 * time.Minute)
	for manager.Status().State != milk.StateReady {
		if time.Now().After(deadline) || manager.Status().State == milk.StateError || manager.Status().State == milk.StateNotInstalled {
			t.Fatalf("adapter not ready: %+v %v", manager.Status(), manager.Log())
		}
		time.Sleep(200 * time.Millisecond)
	}
	defer manager.Shutdown()
	manager.SetActiveWorkspace(root)
	_, err := manager.Prompt(context.Background(), milk.PromptRequest{Token: "t1", Root: root, Message: "List the files here with a tool, then answer with just the file name."})
	if err != nil {
		t.Fatalf("prompt: %v", err)
	}
	mu.Lock()
	defer mu.Unlock()
	t.Logf("events %v reply %q", events, reply.String())
	if events[0] != "claude.chat:begin" || events[len(events)-1] != "claude.chat:end" || !strings.Contains(reply.String(), "hello.txt") {
		t.Fatalf("unexpected turn: %v %q", events, reply.String())
	}
}

// TestLiveBedrockFromProjectSettings: Bedrock configurato solo in .claude/settings.local.json del
// progetto deve arrivare a Claude Code avviato da adOmnia (finto endpoint Bedrock locale).
func TestLiveBedrockFromProjectSettings(t *testing.T) {
	if os.Getenv("ADOMNIA_LIVE_CLAUDE") != "1" {
		t.Skip("set ADOMNIA_LIVE_CLAUDE=1 to run against the real Claude Code adapter")
	}
	var mu sync.Mutex
	var paths []string
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		mu.Lock()
		paths = append(paths, r.Method+" "+r.URL.Path)
		mu.Unlock()
		http.Error(w, `{"message":"fake bedrock"}`, http.StatusBadRequest)
	}))
	defer server.Close()
	root := t.TempDir()
	settings := `{"env":{"CLAUDE_CODE_USE_BEDROCK":"1","CLAUDE_CODE_SKIP_BEDROCK_AUTH":"1","AWS_REGION":"eu-west-1","ANTHROPIC_BEDROCK_BASE_URL":"` + server.URL + `","ANTHROPIC_MODEL":"eu.anthropic.claude-sonnet-4-5-20250929-v1:0"}}`
	if err := os.MkdirAll(root+"/.claude", 0o700); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(root+"/.claude/settings.local.json", []byte(settings), 0o600); err != nil {
		t.Fatal(err)
	}
	if config := Inspect(root, true); config.Provider != "bedrock" || config.Region != "eu-west-1" {
		t.Fatalf("inspect: %+v", config)
	}
	manager := milk.NewAgentManager(milk.NewSettingsStoreFile(t.TempDir(), "claude-code.json"), Agent())
	manager.SetActiveWorkspace(root)
	if _, err := manager.SaveSettings(milk.Settings{Enabled: true, IgnoreAPIKey: true}); err != nil {
		t.Fatal(err)
	}
	deadline := time.Now().Add(3 * time.Minute)
	for manager.Status().State != milk.StateReady {
		if time.Now().After(deadline) || manager.Status().State == milk.StateError {
			t.Fatalf("adapter not ready: %+v", manager.Status())
		}
		time.Sleep(200 * time.Millisecond)
	}
	defer manager.Shutdown()
	ctx, cancel := context.WithTimeout(context.Background(), 2*time.Minute)
	defer cancel()
	_, err := manager.Prompt(ctx, milk.PromptRequest{Token: "t1", Root: root, Message: "hi"})
	mu.Lock()
	defer mu.Unlock()
	t.Logf("prompt error (expected from the fake endpoint): %v; requests %v; status %+v", err, paths, manager.Status())
	hit := false
	for _, path := range paths {
		hit = hit || strings.Contains(path, "/model/eu.anthropic.claude-sonnet-4-5-20250929-v1:0/")
	}
	if !hit {
		t.Fatalf("Claude Code did not call Bedrock with the project model: %v", paths)
	}
	for wait := time.Now().Add(10 * time.Second); !strings.Contains(manager.Status().Backend, "Bedrock") && time.Now().Before(wait); {
		time.Sleep(100 * time.Millisecond)
	}
	if status := manager.Status(); !strings.Contains(status.Backend, "Bedrock") {
		t.Fatalf("backend not reported: %+v", status)
	}
}
