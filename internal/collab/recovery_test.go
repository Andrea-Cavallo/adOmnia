package collab

import (
	"encoding/json"
	"testing"
	"time"
)

func disconnectGuest(t *testing.T, m *Manager, r *recorder) {
	t.Helper()
	m.mu.Lock()
	p := m.host
	m.mu.Unlock()
	p.conn.Close()
	r.waitFor(t, EventDisconnected)
}

func TestResumeKeepsIdentityReplaysAndHonorsRole(t *testing.T) {
	host, _ := startHost(t)
	guest, rec := join(t, host, RoleEditor, "Guest")
	id := guest.Status().Self
	if err := host.SetRole(id, RoleViewer); err != nil {
		t.Fatal(err)
	}
	rec.waitFor(t, EventParticipants)
	disconnectGuest(t, guest, rec)
	if !guest.Status().Disconnected {
		t.Fatal("disconnection state lost")
	}
	if _, err := host.Share(ShareCollection, "missed", json.RawMessage(`{"name":"missed","children":[]}`)); err != nil {
		t.Fatal(err)
	}
	status, err := guest.Resume()
	if err != nil {
		t.Fatal(err)
	}
	if status.Self != id || status.Disconnected {
		t.Fatalf("identity: %+v", status)
	}
	rec.waitFor(t, EventResumed)
	var s Share
	json.Unmarshal(rec.waitFor(t, EventShare).Payload, &s)
	if s.Title != "missed" {
		t.Fatal("missed snapshot not replayed")
	}
	for _, p := range status.Participants {
		if p.ID == id && p.Role != RoleViewer {
			t.Fatal("role restored incorrectly")
		}
	}
	if _, err := guest.Share(ShareCollection, "forbidden", json.RawMessage(`{}`)); err == nil {
		t.Fatal("resumed viewer bypassed permission")
	}
}

func TestRevocationAndExpiryRejectResume(t *testing.T) {
	for _, expire := range []bool{false, true} {
		t.Run(map[bool]string{false: "revoked", true: "expired"}[expire], func(t *testing.T) {
			host, _ := startHost(t)
			guest, rec := join(t, host, RoleEditor, "Guest")
			id := guest.Status().Self
			disconnectGuest(t, guest, rec)
			if expire {
				host.mu.Lock()
				for token, ticket := range host.resumes {
					ticket.expires = time.Now().Add(-time.Second)
					host.resumes[token] = ticket
				}
				host.mu.Unlock()
			} else if err := host.Revoke(id); err != nil {
				t.Fatal(err)
			}
			if _, err := guest.Resume(); err == nil {
				t.Fatal("invalid resume accepted")
			}
		})
	}
}
