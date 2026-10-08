package collab

import (
	"encoding/json"
	"strings"
	"sync"
	"testing"
	"time"
)

type recorder struct {
	mu     sync.Mutex
	events []Event
}

func (r *recorder) emit(e Event) {
	r.mu.Lock()
	defer r.mu.Unlock()
	r.events = append(r.events, e)
}

func (r *recorder) waitFor(t *testing.T, typ string) Event {
	t.Helper()
	deadline := time.Now().Add(5 * time.Second)
	for time.Now().Before(deadline) {
		r.mu.Lock()
		for i, e := range r.events {
			if e.Type == typ {
				r.events = append(r.events[:i:i], r.events[i+1:]...)
				r.mu.Unlock()
				return e
			}
		}
		r.mu.Unlock()
		time.Sleep(10 * time.Millisecond)
	}
	t.Fatalf("evento %q non ricevuto", typ)
	return Event{}
}

func startHost(t *testing.T) (*Manager, *recorder) {
	t.Helper()
	rec := &recorder{}
	host := NewManager(rec.emit)
	if _, err := host.Host("127.0.0.1", 0, "Alice"); err != nil {
		t.Fatal(err)
	}
	t.Cleanup(host.Stop)
	return host, rec
}

func join(t *testing.T, host *Manager, role Role, name string) (*Manager, *recorder) {
	t.Helper()
	inv, err := host.CreateInvite(role, time.Minute)
	if err != nil {
		t.Fatal(err)
	}
	rec := &recorder{}
	guest := NewManager(rec.emit)
	if _, err := guest.Join(inv.Code, name); err != nil {
		t.Fatal(err)
	}
	t.Cleanup(guest.Stop)
	return guest, rec
}

func TestShareFlowsBothWaysAndIsRedacted(t *testing.T) {
	host, hostRec := startHost(t)
	guest, guestRec := join(t, host, RoleEditor, "Bob")
	hostRec.waitFor(t, EventParticipants)
	if n := len(host.Status().Participants); n != 2 {
		t.Fatalf("partecipanti host = %d", n)
	}

	data := json.RawMessage(`{"name":"Payments","headers":[{"key":"Authorization","value":"Bearer abc"}],"auth":{"bearer":{"token":"xyz"}},"variables":[{"key":"base","value":"http://x"},{"key":"k","value":"v","secret":true}]}`)
	if _, err := host.Share(ShareCollection, "Payments", data); err != nil {
		t.Fatal(err)
	}
	got := guestRec.waitFor(t, EventShare)
	var share Share
	_ = json.Unmarshal(got.Payload, &share)
	body := string(share.Data)
	for _, secret := range []string{"Bearer abc", "xyz", `"v"`} {
		if strings.Contains(body, secret) {
			t.Fatalf("segreto %s trapelato: %s", secret, body)
		}
	}
	if !strings.Contains(body, "http://x") || len(share.Redacted) != 3 {
		t.Fatalf("redazione inattesa: %s %v", body, share.Redacted)
	}

	if _, err := guest.Share(ShareRequest, "GET /x", json.RawMessage(`{"url":"/x"}`)); err != nil {
		t.Fatal(err)
	}
	if e := hostRec.waitFor(t, EventShare); e.From != guest.Status().Self {
		t.Fatalf("mittente = %q", e.From)
	}
}

func TestViewerCannotShare(t *testing.T) {
	host, _ := startHost(t)
	guest, _ := join(t, host, RoleViewer, "Eve")
	if _, err := guest.Share(ShareRequest, "x", json.RawMessage(`{}`)); err == nil {
		t.Fatal("viewer non deve poter condividere")
	}
	// anche se il client bara, l'host rifiuta
	guest.mu.Lock()
	guest.self.Role = RoleEditor
	guest.mu.Unlock()
	if msg := host.relayShare(guestID(t, host), mustJSON(Share{Kind: ShareRequest, Data: json.RawMessage(`{}`)})); msg == "" {
		t.Fatal("l'host deve rifiutare la condivisione di un viewer")
	}
}

func TestInviteIsSingleUseAndPinned(t *testing.T) {
	host, _ := startHost(t)
	inv, _ := host.CreateInvite(RoleEditor, time.Minute)
	first := NewManager(nil)
	if _, err := first.Join(inv.Code, "A"); err != nil {
		t.Fatal(err)
	}
	defer first.Stop()
	if _, err := NewManager(nil).Join(inv.Code, "B"); err == nil {
		t.Fatal("un invito deve valere una sola volta")
	}

	other, _ := host.CreateInvite(RoleEditor, time.Minute)
	tampered := strings.Replace(other.Code, "fp="+host.Status().Fingerprint, "fp="+strings.Repeat("0", 64), 1)
	if _, err := NewManager(nil).Join(tampered, "C"); err == nil || !strings.Contains(err.Error(), "fingerprint") {
		t.Fatalf("pinning non applicato: %v", err)
	}
}

func TestRevokeAndStopNotifyGuest(t *testing.T) {
	host, _ := startHost(t)
	guest, guestRec := join(t, host, RoleEditor, "Bob")
	if err := host.Revoke(guestID(t, host)); err != nil {
		t.Fatal(err)
	}
	guestRec.waitFor(t, EventClosed)
	if guest.Status().Mode != ModeIdle {
		t.Fatal("il guest revocato deve tornare idle")
	}

	_, rec2 := join(t, host, RoleEditor, "Carl")
	host.Stop()
	rec2.waitFor(t, EventClosed)
}

func TestHostRequiresSpecificIP(t *testing.T) {
	if _, err := NewManager(nil).Host("0.0.0.0", 0, "x"); err == nil {
		t.Fatal("0.0.0.0 non deve essere accettato")
	}
}

func TestBruteGuardBacksOff(t *testing.T) {
	g := newBruteGuard()
	now := time.Now()
	g.now = func() time.Time { return now }
	for range guardFreeAttempts {
		g.fail("1.2.3.4")
	}
	if g.allowed("1.2.3.4") {
		t.Fatal("dopo troppi errori l'IP va bloccato")
	}
	now = now.Add(guardBaseBackoff)
	if !g.allowed("1.2.3.4") {
		t.Fatal("il blocco deve scadere")
	}
}

func guestID(t *testing.T, host *Manager) string {
	t.Helper()
	for _, p := range host.Status().Participants {
		if !p.Host {
			return p.ID
		}
	}
	t.Fatal("nessun guest")
	return ""
}
