package panelwindow

import "testing"

func TestToolWindowKey(t *testing.T) {
	for _, tool := range []string{"run", "logs", "terminal", "copilot", "milk"} {
		key, err := ToolWindowKey("session-123", tool)
		if err != nil || key != "tool-session-123-"+tool {
			t.Fatalf("unexpected key for %s: %q %v", tool, key, err)
		}
	}
	for _, input := range [][2]string{{"", "run"}, {"../session", "run"}, {"session?tool=x", "run"}, {"session-1", "settings"}} {
		if _, err := ToolWindowKey(input[0], input[1]); err == nil {
			t.Fatalf("invalid tool resource accepted: %v", input)
		}
	}
	if err := New(nil, false).OpenTool("session-1", "run", "Run"); err == nil {
		t.Fatal("opening a tool requires the desktop runtime")
	}
}

func TestValidPanel(t *testing.T) {
	for _, id := range []string{"collections", "database", "broker", "dockerlab", "a-b-1"} {
		if !ValidPanel(id) {
			t.Errorf("%q should be valid", id)
		}
	}
	for _, id := range []string{"", "Database", "../x", "a b", "a?b=c", "1abc", "x&window=go-studio"} {
		if ValidPanel(id) {
			t.Errorf("%q should be rejected", id)
		}
	}
}

func TestOpenWithoutDesktopFails(t *testing.T) {
	var manager *Manager
	if err := manager.Open("database", "Database"); err == nil {
		t.Fatal("expected an error without a desktop runtime")
	}
	if err := New(nil, false).Open("database", "Database"); err == nil {
		t.Fatal("expected an error without a desktop runtime")
	}
}

func TestCloseAllThenWithoutWindowsDoesNotHoldTheMainWindow(t *testing.T) {
	called := false
	if New(nil, false).CloseAllThen(func() { called = true }) {
		t.Fatal("no panel window is open: the main window must close normally")
	}
	var manager *Manager
	if manager.CloseAllThen(func() { called = true }) || called {
		t.Fatal("nil manager must not hold the close nor call done")
	}
}
