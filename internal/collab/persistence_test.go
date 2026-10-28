package collab

import (
	"encoding/base64"
	jsonv1 "encoding/json"
	"encoding/json/v2"
	"testing"
	"time"

	"github.com/Andrea-Cavallo/adOmnia/internal/storage"
)

func openRecoveryStorage(t *testing.T) {
	t.Helper()
	if err := storage.Open(t.TempDir()); err != nil {
		t.Fatal(err)
	}
	t.Cleanup(storage.Close)
}

func TestHostRestartRestoresCertificateReplayDocumentsAndRole(t *testing.T) {
	openRecoveryStorage(t)
	host := NewPersistentManager(nil)
	if _, err := host.Host("127.0.0.1", 0, "Alice"); err != nil {
		t.Fatal(err)
	}
	guest, guestEvents := join(t, host, RoleEditor, "Bob")
	guestID := guest.Status().Self
	if err := host.SetRole(guestID, RoleViewer); err != nil {
		t.Fatal(err)
	}
	guestEvents.waitFor(t, EventParticipants)
	initial := base64.StdEncoding.EncodeToString([]byte("shared source"))
	if err := host.OpenDocument("project:main.go", initial); err != nil {
		t.Fatal(err)
	}
	disconnectGuest(t, guest, guestEvents)
	if _, err := host.Share(ShareCollection, "missed", jsonv1.RawMessage(`{"name":"missed","children":[]}`)); err != nil {
		t.Fatal(err)
	}
	before := host.Status()
	host.Shutdown()

	restored := NewPersistentManager(nil)
	restored.Restore()
	status := restored.Status()
	if !status.RecoveryPending || !status.Disconnected || status.RecoveryError != "" {
		t.Fatalf("stato recovery: %+v", status)
	}
	if status.SessionID != before.SessionID || status.Fingerprint != before.Fingerprint || status.Address != before.Address {
		t.Fatalf("identità host cambiata: %+v", status)
	}
	if len(status.Documents) != 1 || status.Documents[0] != "project:main.go" {
		t.Fatalf("documenti recovery: %v", status.Documents)
	}
	if _, err := restored.Resume(); err != nil {
		t.Fatal(err)
	}
	t.Cleanup(restored.Stop)
	if _, err := guest.Resume(); err != nil {
		t.Fatal(err)
	}
	guestEvents.waitFor(t, EventResumed)
	shared := guestEvents.waitFor(t, EventShare)
	var share Share
	if err := json.Unmarshal(shared.Payload, &share); err != nil || share.Title != "missed" {
		t.Fatalf("snapshot replay: %+v, %v", share, err)
	}
	for _, participant := range restored.Status().Participants {
		if participant.ID == guestID && participant.Role != RoleViewer {
			t.Fatalf("ruolo recovery: %+v", participant)
		}
	}
	restored.mu.Lock()
	room := restored.documents["project:main.go"]
	restored.mu.Unlock()
	if room == nil || len(room.updates) != 1 || room.updates[0] != initial {
		t.Fatal("cronologia Yjs non ripristinata")
	}
}

func TestGuestRestartResumesSameIdentity(t *testing.T) {
	openRecoveryStorage(t)
	host, _ := startHost(t)
	guest, guestEvents := joinPersistentGuest(t, host)
	id := guest.Status().Self
	disconnectGuest(t, guest, guestEvents)
	guest.Shutdown()

	restored := NewPersistentManager(nil)
	restored.Restore()
	if status := restored.Status(); !status.RecoveryPending || status.SessionID != host.Status().SessionID {
		t.Fatalf("guest recovery: %+v", status)
	}
	status, err := restored.Resume()
	if err != nil {
		t.Fatal(err)
	}
	if status.Self != id || status.Disconnected {
		t.Fatalf("identità guest cambiata: %+v", status)
	}
	restored.Stop()
}

func joinPersistentGuest(t *testing.T, host *Manager) (*Manager, *recorder) {
	t.Helper()
	invite, err := host.CreateInvite(RoleEditor, time.Minute)
	if err != nil {
		t.Fatal(err)
	}
	events := &recorder{}
	guest := NewPersistentManager(events.emit)
	if _, err := guest.Join(invite.Code, "Guest"); err != nil {
		t.Fatal(err)
	}
	t.Cleanup(guest.Stop)
	return guest, events
}
