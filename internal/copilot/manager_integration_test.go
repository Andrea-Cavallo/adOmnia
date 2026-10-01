package copilot

import (
	"context"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"testing"
	"time"
)

// TestRealLanguageServerStartsSignedOut avvia il Copilot Language Server ufficiale indicato da
// ADOMNIA_COPILOT_LS e verifica che, senza account, arrivi allo stato "signed-out" (non errore).
func TestRealLanguageServerStartsSignedOut(t *testing.T) {
	binary := os.Getenv("ADOMNIA_COPILOT_LS")
	if binary == "" {
		t.Skip("set ADOMNIA_COPILOT_LS to the official copilot-language-server binary")
	}
	directory := t.TempDir()
	store := NewSettingsStore(directory)
	settings := DefaultSettings()
	settings.Enabled = true
	settings.BinaryPath = binary
	if _, err := store.Save(settings); err != nil {
		t.Fatal(err)
	}
	manager := NewManager(store, NewInstaller(directory))
	manager.root = t.TempDir()
	t.Cleanup(manager.Shutdown)
	if err := manager.Start(); err != nil {
		t.Fatal(err)
	}
	waitFor(t, func() bool { return manager.Status().State == StateSignedOut }, "signed-out state from the real server")
	if status := manager.Status(); status.ServerVersion == "" || status.Profile.Host != "github.com" {
		t.Fatalf("unexpected status: %+v", status)
	}
}

// TestRealLanguageServerResolvesChatModel usa configurazione e credential store locali solo su
// richiesta esplicita. Blocca la regressione in cui copilot/models riceveva params:null e la
// successiva conversation/create partiva senza modelInfo.id.
func TestRealLanguageServerResolvesChatModel(t *testing.T) {
	directory := os.Getenv("ADOMNIA_COPILOT_DATA")
	if directory == "" {
		t.Skip("set ADOMNIA_COPILOT_DATA to the adOmnia data directory")
	}
	manager := NewManager(NewSettingsStore(directory), NewInstaller(directory))
	root := t.TempDir()
	manager.root = root
	t.Cleanup(manager.Shutdown)
	if err := manager.Start(); err != nil {
		t.Fatal(err)
	}
	waitFor(t, func() bool { return manager.Status().State == StateReady }, "authenticated Copilot server")
	conn, err := manager.connection()
	if err != nil {
		t.Fatal(err)
	}
	model, err := manager.defaultChatModel(conn)
	if err != nil {
		t.Fatal(err)
	}
	if model == "" {
		t.Fatal("Copilot returned no chat model")
	}
	manager.DocumentOpened(OpenedDocument{ID: "real-chat", URI: fileURI(filepath.Join(root, "main.go")), Root: root, RootName: "real-chat", RelativePath: "main.go", LanguageID: "go", Text: "package main\n"})
	var eventMu sync.Mutex
	var reply strings.Builder
	ended := false
	manager.SetEmitter(func(event string, payload any) {
		if event != "copilot.chat" {
			return
		}
		chatEvent := payload.(ChatEvent)
		eventMu.Lock()
		reply.WriteString(chatEvent.Reply)
		ended = ended || chatEvent.Kind == "end"
		eventMu.Unlock()
	})
	ctx, cancel := context.WithTimeout(context.Background(), 45*time.Second)
	defer cancel()
	response, err := manager.Chat(ctx, ChatRequest{Token: "real-chat-roundtrip", Message: "Reply with exactly OK.", DocumentID: "real-chat", IncludeDocument: true})
	if err != nil {
		t.Fatal(err)
	}
	eventMu.Lock()
	gotReply, gotEnd := reply.String(), ended
	eventMu.Unlock()
	if response.ConversationID == "" || !gotEnd || strings.TrimSpace(gotReply) == "" {
		t.Fatalf("incomplete real chat: response=%+v ended=%v reply=%q", response, gotEnd, gotReply)
	}
	if log := strings.Join(manager.Log(), "\n"); strings.Contains(log, "addView called before server initialized") || strings.Contains(log, "expected 1, got 0") {
		t.Fatalf("workspace initialized out of order:\n%s", log)
	}
	t.Logf("resolved chat model %q with Copilot Language Server %s", model, manager.Status().ServerVersion)
}
