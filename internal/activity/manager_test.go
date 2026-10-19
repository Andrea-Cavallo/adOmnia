package activity

import "testing"

func TestActivitySubscribersCanQueryAndUnsubscribe(t *testing.T) {
	m := NewManager()
	calls := 0
	off := m.Subscribe(func() { calls++; _ = m.State("code-studio:s") })
	_, _ = m.Report("main", Active, []string{"code-studio:s"})
	m.RemoveWindow("main")
	if calls != 2 {
		t.Fatalf("notifications = %d", calls)
	}
	off()
	off()
	_, _ = m.Report("main", Background, nil)
	if calls != 2 {
		t.Fatal("subscriber retained after unsubscribe")
	}
}

func TestStatesAcrossWindowsAndRealResourceRelease(t *testing.T) {
	m := NewManager()
	if m.State("code-studio:s") != Background {
		t.Fatal("unseen workspace must be background")
	}
	_, _ = m.Report("main", Idle, []string{"code-studio:s"})
	if m.State("code-studio:s") != Idle {
		t.Fatal("visible idle workspace")
	}
	_, _ = m.Report("detached", Active, []string{"code-studio:s"})
	resource := Resource{Kind: "language-server", Restorable: true}
	if m.CanSuspend("code-studio:s", resource, true) {
		t.Fatal("detached active editor must win")
	}
	_, _ = m.Report("detached", Background, []string{"code-studio:s"})
	if !m.CanSuspend("code-studio:s", resource, true) {
		t.Fatal("idle automatic resource may suspend")
	}
	if m.CanSuspend("code-studio:s", resource, false) {
		t.Fatal("owner busy guard must win")
	}
	m.Track("lsp", "code-studio:s")
	if m.State("code-studio:s") != Idle {
		t.Fatal("idle is not suspended before release")
	}
	m.Released("lsp")
	if m.State("code-studio:s") != Suspended {
		t.Fatal("released resource should report suspended")
	}
	_, _ = m.Report("main", Active, []string{"code-studio:s"})
	if m.State("code-studio:s") != Active {
		t.Fatal("interaction resumes active state")
	}
	m.Forget("lsp")
	m.RemoveWindow("main")
	m.RemoveWindow("detached")
	if len(m.Snapshot().Scopes) != 0 {
		t.Fatal("closed scopes retained")
	}
}
func TestIntentionalAndUnknownResourcesAreAlwaysProtected(t *testing.T) {
	m := NewManager()
	for _, kind := range []string{"terminal", "debug", "request", "recording", "process", "database", "broker", "websocket", "sse", "unknown"} {
		for _, explicit := range []bool{true, false} {
			if m.CanSuspend("hidden", Resource{Kind: kind, Restorable: true, UserInitiated: explicit}, true) {
				t.Fatalf("%s was eligible", kind)
			}
		}
	}
	if m.CanSuspend("hidden", Resource{Kind: "language-server", Restorable: true, UserInitiated: true}, true) {
		t.Fatal("explicit server was eligible")
	}
	if m.CanSuspend("hidden", Resource{Kind: "language-server"}, true) {
		t.Fatal("non-restorable server was eligible")
	}
}
func TestClosedNativeWindowsDoNotKeepWorkspacesActive(t *testing.T) {
	m := NewManager()
	_, _ = m.Report("closed", Active, []string{"code-studio:s"})
	m.SetWindowAlive(func(string) bool { return false })
	if m.State("code-studio:s") != Background || len(m.windows) != 0 {
		t.Fatal("dead window retained")
	}
}
func TestCannotClaimSuspensionFromRenderer(t *testing.T) {
	m := NewManager()
	if _, err := m.Report("window", Suspended, []string{"code-studio:s"}); err == nil {
		t.Fatal("renderer must not claim released resources")
	}
}
