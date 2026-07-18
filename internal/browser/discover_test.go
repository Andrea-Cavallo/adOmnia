package browser

import "testing"

func TestInspectablePageTargets(t *testing.T) {
	targets := []DebugTarget{
		{Type: "service_worker", URL: "chrome-extension://worker", WebSocketDebuggerURL: "ws://worker"},
		{Type: "page", URL: "https://www.google.com/", WebSocketDebuggerURL: "ws://page"},
		{Type: "page", URL: "devtools://devtools/bundled/inspector.html", WebSocketDebuggerURL: "ws://devtools"},
		{Type: "page", URL: "https://example.com/"},
	}

	got := inspectablePageTargets(targets)
	if len(got) != 1 || got[0].URL != "https://www.google.com/" {
		t.Fatalf("expected only the inspectable Google page, got %#v", got)
	}
}
