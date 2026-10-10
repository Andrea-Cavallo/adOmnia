package claudecode

import (
	"context"
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
