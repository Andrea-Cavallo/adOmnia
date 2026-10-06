package milk

import "testing"

func TestSessionsAreForgottenWithTheProcess(t *testing.T) {
	m := NewManager(NewSettingsStore(t.TempDir()))
	m.sessions["/a"], m.rootBySession["s1"] = "s1", "/a"
	m.sessions["/b"], m.rootBySession["s2"] = "s2", "/b"

	m.ResetSession("/a")
	if _, ok := m.sessions["/a"]; ok || m.rootBySession["s1"] != "" || m.sessions["/b"] != "s2" {
		t.Fatalf("ResetSession must drop only /a: %v %v", m.sessions, m.rootBySession)
	}

	m.forgetSessionsLocked()
	if len(m.sessions) != 0 || len(m.rootBySession) != 0 {
		t.Fatalf("a new milk process must not reuse old sessions: %v", m.sessions)
	}
}

func TestPermissionWithoutMatchingOptionIsCancelled(t *testing.T) {
	allow, deny := permissionOptionIDs(nil)
	if allow != "" || deny != "" {
		t.Fatalf("expected no invented option ids, got %q %q", allow, deny)
	}
	outcome := permissionResponse(deny)["outcome"].(map[string]any)
	if outcome["outcome"] != "cancelled" {
		t.Fatalf("expected cancelled, got %v", outcome)
	}
}
