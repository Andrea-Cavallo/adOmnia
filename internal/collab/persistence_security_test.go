package collab

import (
	"encoding/base64"
	jsonv1 "encoding/json"
	"fmt"
	"strings"
	"testing"
	"time"

	"github.com/Andrea-Cavallo/adOmnia/internal/storage"
)

func TestRecoveryStoreEncryptsCredentialsSecretsAndSource(t *testing.T) {
	openRecoveryStorage(t)
	host := NewPersistentManager(nil)
	if _, err := host.Host("127.0.0.1", 0, "Alice"); err != nil {
		t.Fatal(err)
	}
	guest, _ := join(t, host, RoleEditor, "Bob")
	host.mu.Lock()
	var resumeToken string
	for token := range host.resumes {
		resumeToken = token
	}
	privateKey := host.keyPEM
	host.mu.Unlock()
	source := base64.StdEncoding.EncodeToString([]byte("source-secret"))
	if err := host.OpenDocument("project:main.go", source); err != nil {
		t.Fatal(err)
	}
	if err := host.SaveInbox(`[{"title":"inbox-secret"}]`); err != nil {
		t.Fatal(err)
	}
	environments := jsonv1.RawMessage(`[{"id":"e","name":"DEV","variables":[{"id":"a","key":"token","type":"secret","value":"selected-secret"}]}]`)
	if _, err := host.ShareWithSecrets(ShareEnvironments, "DEV", environments, []string{"a"}); err != nil {
		t.Fatal(err)
	}
	keys, err := storage.List("collab", "")
	if err != nil || len(keys) == 0 {
		t.Fatalf("chiavi recovery: %v, %v", keys, err)
	}
	for _, key := range keys {
		raw, err := storage.Get("collab", key)
		if err != nil {
			t.Fatal(err)
		}
		for _, secret := range []string{resumeToken, privateKey, "EC PRIVATE KEY", "inbox-secret", "selected-secret", source} {
			if secret != "" && strings.Contains(string(raw), secret) {
				t.Fatalf("recovery %s contiene un segreto in chiaro", key)
			}
		}
	}
	host.Stop()
	guest.Stop()
	keys, err = storage.List("collab", "")
	if err != nil || len(keys) != 0 {
		t.Fatalf("Stop non ha cancellato il recovery: %v, %v", keys, err)
	}
}

func TestRevocationAndExpirySurviveHostRestart(t *testing.T) {
	for _, expired := range []bool{false, true} {
		t.Run(map[bool]string{false: "revoked", true: "expired"}[expired], func(t *testing.T) {
			openRecoveryStorage(t)
			host := NewPersistentManager(nil)
			if _, err := host.Host("127.0.0.1", 0, "Alice"); err != nil {
				t.Fatal(err)
			}
			guest, events := join(t, host, RoleEditor, "Bob")
			id := guest.Status().Self
			disconnectGuest(t, guest, events)
			if expired {
				host.mu.Lock()
				for token, ticket := range host.resumes {
					ticket.expires = time.Now().Add(-time.Second)
					host.resumes[token] = ticket
				}
				host.mu.Unlock()
				host.checkpointSession()
			} else if err := host.Revoke(id); err != nil {
				t.Fatal(err)
			}
			host.Shutdown()
			restored := NewPersistentManager(nil)
			restored.Restore()
			if _, err := restored.Resume(); err != nil {
				t.Fatal(err)
			}
			defer restored.Stop()
			if _, err := guest.Resume(); err == nil {
				t.Fatal("ticket revocato o scaduto accettato dopo il restart")
			}
		})
	}
}

func TestCorruptRecoveryIsVisibleAndDoesNotOpenListener(t *testing.T) {
	openRecoveryStorage(t)
	if err := storage.Put("collab", recoverySessionKey, []byte("corrupted")); err != nil {
		t.Fatal(err)
	}
	manager := NewPersistentManager(nil)
	manager.Restore()
	status := manager.Status()
	if status.Mode != ModeIdle || status.RecoveryError == "" || status.RecoveryPending {
		t.Fatalf("recovery corrotto non segnalato: %+v", status)
	}
	if _, err := manager.Resume(); err == nil {
		t.Fatal("un recovery corrotto non può aprire una sessione")
	}
}

func TestReplayLimitStillWarnsAfterHostRestart(t *testing.T) {
	openRecoveryStorage(t)
	host := NewPersistentManager(nil)
	if _, err := host.Host("127.0.0.1", 0, "Alice"); err != nil {
		t.Fatal(err)
	}
	guest, events := join(t, host, RoleEditor, "Bob")
	disconnectGuest(t, guest, events)
	for index := range 33 {
		payload := jsonv1.RawMessage(fmt.Sprintf(`{"name":"share-%d","children":[]}`, index))
		if _, err := host.Share(ShareCollection, "share", payload); err != nil {
			t.Fatal(err)
		}
	}
	host.Shutdown()
	restored := NewPersistentManager(nil)
	restored.Restore()
	if _, err := restored.Resume(); err != nil {
		t.Fatal(err)
	}
	defer restored.Stop()
	if _, err := guest.Resume(); err != nil {
		t.Fatal(err)
	}
	warning := events.waitFor(t, EventError)
	if !strings.Contains(string(warning.Payload), "non sono più disponibili") {
		t.Fatalf("warning replay mancante: %s", warning.Payload)
	}
}

func TestGuestAheadOfRecoveredHostGetsConflictWarning(t *testing.T) {
	openRecoveryStorage(t)
	host := NewPersistentManager(nil)
	if _, err := host.Host("127.0.0.1", 0, "Alice"); err != nil {
		t.Fatal(err)
	}
	guest, events := join(t, host, RoleEditor, "Bob")
	oldSession, err := storage.Get("collab", recoverySessionKey)
	if err != nil {
		t.Fatal(err)
	}
	if _, err := host.Share(ShareCollection, "newer", jsonv1.RawMessage(`{"name":"newer","children":[]}`)); err != nil {
		t.Fatal(err)
	}
	events.waitFor(t, EventShare)
	disconnectGuest(t, guest, events)
	host.Shutdown()
	if err := storage.Put("collab", recoverySessionKey, oldSession); err != nil {
		t.Fatal(err)
	}
	restored := NewPersistentManager(nil)
	restored.Restore()
	if _, err := restored.Resume(); err != nil {
		t.Fatal(err)
	}
	defer restored.Stop()
	if _, err := guest.Resume(); err != nil {
		t.Fatal(err)
	}
	warning := events.waitFor(t, EventError)
	if !strings.Contains(string(warning.Payload), "snapshot precedente") {
		t.Fatalf("conflitto snapshot non segnalato: %s", warning.Payload)
	}
}
