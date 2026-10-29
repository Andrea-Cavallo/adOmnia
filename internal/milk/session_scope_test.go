package milk

import (
	jsonv1 "encoding/json"
	"testing"
)

func TestTaskSessionScopeDoesNotResetOrReuseChat(t *testing.T) {
	manager := NewManager(NewSettingsStore(t.TempDir()))
	root := "/project"
	chatKey := sessionMapKey(root, "")
	taskKey := sessionMapKey(root, "task-attempt")
	manager.sessions[chatKey] = "chat-session"
	manager.sessions[taskKey] = "task-session"
	manager.rootBySession["chat-session"] = root
	manager.rootBySession["task-session"] = root
	manager.scopeBySession["task-session"] = "task-attempt"

	manager.ResetSession(root)
	if _, exists := manager.sessions[chatKey]; exists {
		t.Fatal("chat session was not reset")
	}
	if manager.sessions[taskKey] != "task-session" || manager.rootBySession["task-session"] != root {
		t.Fatal("resetting chat removed the task session")
	}

	var published ChatEvent
	manager.SetEmitter(func(name string, payload any) {
		if name == "milk.chat" {
			published = payload.(ChatEvent)
		}
	})
	manager.publishChat(ChatEvent{Token: "task-attempt", Root: root, SessionID: "task-session", Kind: "text"})
	if published.SessionKey != "task-attempt" {
		t.Fatalf("task scope lost from chat event: %+v", published)
	}
}

func TestSessionForCreatesDistinctChatAndTaskSessions(t *testing.T) {
	manager := NewManager(NewSettingsStore(t.TempDir()))
	pair := newConnPair(t, &handler{manager: manager})
	manager.current = &process{conn: pair.conn}
	go func() {
		for index := 1; index <= 2; index++ {
			wire := pair.readClientLine(t)
			writeLine(t, pair.agentToClient, map[string]any{
				"jsonrpc": "2.0", "id": jsonv1.RawMessage(wire["id"]),
				"result": map[string]any{"sessionId": string(rune('a' + index - 1))},
			})
		}
	}()
	chat, err := manager.sessionFor("/project", "")
	if err != nil {
		t.Fatal(err)
	}
	task, err := manager.sessionFor("/project", "attempt-one")
	if err != nil {
		t.Fatal(err)
	}
	again, err := manager.sessionFor("/project", "")
	if err != nil {
		t.Fatal(err)
	}
	if chat == task || chat != again {
		t.Fatalf("session scopes were mixed: chat=%q task=%q again=%q", chat, task, again)
	}
}

func TestForgetScopedSessionKeepsTheChatAndReleasesTheAttempt(t *testing.T) {
	manager := NewManager(NewSettingsStore(t.TempDir()))
	root := "/project"
	chatKey := sessionMapKey(root, "")
	taskKey := sessionMapKey(root, "attempt-one")
	manager.sessions[chatKey] = "chat-session"
	manager.sessions[taskKey] = "task-session"
	manager.rootBySession["chat-session"] = root
	manager.rootBySession["task-session"] = root
	manager.scopeBySession["task-session"] = "attempt-one"
	manager.turns["task-session"] = "attempt-one"

	manager.ForgetScopedSession(root, "attempt-one")
	if _, exists := manager.sessions[taskKey]; exists {
		t.Fatal("task session was not released")
	}
	for name, values := range map[string]map[string]string{
		"rootBySession":  manager.rootBySession,
		"scopeBySession": manager.scopeBySession,
		"turns":          manager.turns,
	} {
		if _, exists := values["task-session"]; exists {
			t.Fatalf("%s still references the released session", name)
		}
	}
	if manager.sessions[chatKey] != "chat-session" || manager.rootBySession["chat-session"] != root {
		t.Fatal("releasing a task session changed the project chat")
	}
	manager.ForgetScopedSession(root, "") // la chat non è mai uno scope di task
	if manager.sessions[chatKey] != "chat-session" {
		t.Fatal("an empty scope must never release the chat session")
	}
}

func TestInitializeCapabilitiesDeclareOnlyImplementedClientMethods(t *testing.T) {
	standard := NewAgentManager(NewSettingsStore(t.TempDir()), Agent{Name: "fixture", Event: "fixture", Protocol: 1})
	params := standard.initializeParams()
	capabilities := params["clientCapabilities"].(map[string]any)
	files := capabilities["fs"].(map[string]bool)
	if !files["readTextFile"] || files["writeTextFile"] || capabilities["terminal"] != false {
		t.Fatalf("unexpected client capabilities: %+v", capabilities)
	}
}
