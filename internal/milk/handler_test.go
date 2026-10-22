package milk

import (
	"encoding/json"
	"testing"
)

func captureCommands(t *testing.T, m *Manager) *CommandEvent {
	t.Helper()
	var captured CommandEvent
	m.SetEmitter(func(name string, payload any) {
		if name == "milk.commands" {
			captured = payload.(CommandEvent)
		}
	})
	return &captured
}

func TestAvailableCommandsAreStoredAndPublished(t *testing.T) {
	m := NewManager(NewSettingsStore(t.TempDir()))
	m.rootBySession["s1"] = "/project"
	captured := captureCommands(t, m)

	(&handler{manager: m}).HandleNotification("session/update", json.RawMessage(`{"sessionId":"s1","update":{"sessionUpdate":"available_commands_update","availableCommands":[{"name":"workflow","description":"run a workflow","input":{"type":"text","hint":"<name> <task>"}},{"name":"/usage","description":"show usage"}]}}`))

	if len(captured.Commands) != 2 || captured.Commands[0].Name != "workflow" || captured.Commands[0].Hint != "<name> <task>" || captured.Commands[1].Name != "usage" {
		t.Fatalf("commands not published: %+v", captured)
	}
	if captured.Root != "/project" {
		t.Fatalf("wrong root: %+v", captured)
	}
	if got := m.commands["/project"]; len(got) != 2 || got[1].Description != "show usage" {
		t.Fatalf("commands not stored: %+v", got)
	}
}

func TestBackgroundFollowUpGetsItsOwnTurn(t *testing.T) {
	m := NewManager(NewSettingsStore(t.TempDir()))
	m.rootBySession["s1"] = "/project"
	var events []ChatEvent
	m.SetEmitter(func(name string, payload any) {
		if name == "milk.chat" {
			events = append(events, payload.(ChatEvent))
		}
	})
	h := &handler{manager: m}

	// milk avvia il turno da solo: nessun prompt di adOmnia è in corso.
	h.HandleNotification("session/update", json.RawMessage(`{"sessionId":"s1","update":{"sessionUpdate":"state_update","state":"running"}}`))
	token := m.tokenForSession("s1")
	if token == "" {
		t.Fatal("background turn got no token")
	}
	h.HandleNotification("session/update", json.RawMessage(`{"sessionId":"s1","update":{"sessionUpdate":"agent_message_chunk","content":{"type":"text","text":"job done"}}}`))
	h.HandleNotification("session/update", json.RawMessage(`{"sessionId":"s1","update":{"sessionUpdate":"state_update","state":"idle","stopReason":"end_turn"}}`))

	if len(events) != 3 || events[0].Kind != "begin" || events[1].Kind != "text" || events[1].Reply != "job done" || events[2].Kind != "end" {
		t.Fatalf("unexpected events: %+v", events)
	}
	for _, event := range events {
		if event.Token != token || event.Root != "/project" {
			t.Fatalf("event lost the background turn identity: %+v", event)
		}
	}
	if m.tokenForSession("s1") != "" {
		t.Fatal("background turn was not released")
	}
}

func TestNormalPromptWinsOverBackgroundToken(t *testing.T) {
	m := NewManager(NewSettingsStore(t.TempDir()))
	m.rootBySession["s1"] = "/project"
	m.turns["s1"] = "prompt-token"
	if got := m.tokenForSession("s1"); got != "prompt-token" {
		t.Fatalf("prompt turn must keep its token, got %q", got)
	}
	if m.beginAmbient("s1") == "" {
		t.Fatal("ambient token must exist for background turns")
	}
}
