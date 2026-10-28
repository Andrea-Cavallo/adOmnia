package opencode

import (
	"context"
	"fmt"
	"net/http"
	"net/http/httptest"
	"os"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/Andrea-Cavallo/adOmnia/internal/milk"
)

// Opt-in real OpenCode subprocess + local inference fixture: no model download or paid tokens.
func TestLiveOpenCodeACP(t *testing.T) {
	if os.Getenv("ADOMNIA_LIVE_OPENCODE") != "1" {
		t.Skip("set ADOMNIA_LIVE_OPENCODE=1 to exercise installed OpenCode with a local HTTP fixture")
	}
	for _, key := range []string{"XDG_CONFIG_HOME", "XDG_CACHE_HOME", "XDG_DATA_HOME", "XDG_STATE_HOME"} {
		t.Setenv(key, t.TempDir())
	}
	var mu sync.Mutex
	var paths []string
	var reply strings.Builder
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		mu.Lock()
		paths = append(paths, r.URL.Path)
		mu.Unlock()
		if r.URL.Path == "/api/show" {
			w.Header().Set("Content-Type", "application/json")
			fmt.Fprint(w, `{"capabilities":["completion","tools"]}`)
			return
		}
		if r.URL.Path == "/v1/chat/completions" {
			w.Header().Set("Content-Type", "text/event-stream")
			fmt.Fprint(w, "data: {\"id\":\"test\",\"object\":\"chat.completion.chunk\",\"created\":1,\"model\":\"adomnia-test\",\"choices\":[{\"index\":0,\"delta\":{\"role\":\"assistant\",\"content\":\"LOCAL_OK\"},\"finish_reason\":null}]}\n\n")
			fmt.Fprint(w, "data: {\"id\":\"test\",\"object\":\"chat.completion.chunk\",\"created\":1,\"model\":\"adomnia-test\",\"choices\":[{\"index\":0,\"delta\":{},\"finish_reason\":\"stop\"}]}\n\ndata: [DONE]\n\n")
			return
		}
		http.NotFound(w, r)
	}))
	defer server.Close()
	settings, err := Validate(milk.Settings{Enabled: true, Env: map[string]string{EndpointKey: server.URL, ModelKey: "adomnia-test"}})
	if err != nil {
		t.Fatal(err)
	}
	store := milk.NewSettingsStoreFile(t.TempDir(), "opencode.json")
	if _, err := store.Save(settings); err != nil {
		t.Fatal(err)
	}
	manager := milk.NewAgentManager(store, Agent())
	defer manager.Shutdown()
	manager.SetEmitter(func(event string, payload any) {
		if chat, ok := payload.(milk.ChatEvent); ok && chat.Kind == "text" {
			mu.Lock()
			reply.WriteString(chat.Reply)
			mu.Unlock()
		}
	})
	if err := manager.Start(); err != nil {
		t.Fatalf("ACP startup: %v; logs %v", err, manager.Log())
	}
	root := t.TempDir()
	ctx, cancel := context.WithTimeout(context.Background(), 40*time.Second)
	defer cancel()
	if _, err := manager.Prompt(ctx, milk.PromptRequest{Token: "local-test", Root: root, Message: "Reply LOCAL_OK. Do not use tools."}); err != nil {
		t.Fatalf("prompt: %v; logs %v", err, manager.Log())
	}
	mu.Lock()
	defer mu.Unlock()
	if !strings.Contains(reply.String(), "LOCAL_OK") {
		t.Fatalf("reply %q paths %v logs %v", reply.String(), paths, manager.Log())
	}
	t.Logf("OpenCode %s: ACP handshake, session, local provider request and streamed reply verified", manager.Status().Version)
}
