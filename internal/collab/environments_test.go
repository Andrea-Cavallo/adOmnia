package collab

import (
	"encoding/json"
	"strings"
	"testing"
)

func TestEnvironmentOptInIsExplicitAndVaultNeverLeaves(t *testing.T) {
	data := json.RawMessage(`[{"id":"e","name":"DEV","variables":[{"id":"a","key":"token","type":"secret","value":"selected-secret"},{"id":"b","key":"password","type":"secret","value":"unselected-secret"},{"id":"v","key":"key","type":"secret","value":"vault:private"}]},{"private":true,"variables":[{"id":"p","key":"token","value":"private-secret"}]}]`)
	defaultShare, err := PreviewShare(ShareEnvironments, "DEV", data)
	if err != nil {
		t.Fatal(err)
	}
	if strings.Contains(string(defaultShare.Data), "selected-secret") {
		t.Fatal("default leaked a secret")
	}
	share, err := PreviewShareWithSecrets(ShareEnvironments, "DEV", data, []string{"a", "v", "p"})
	if err != nil {
		t.Fatal(err)
	}
	if !strings.Contains(string(share.Data), "selected-secret") {
		t.Fatal("selected plain variable missing")
	}
	for _, forbidden := range []string{"unselected-secret", "vault:private", "private-secret"} {
		if strings.Contains(string(share.Data), forbidden) {
			t.Fatalf("forbidden content leaked: %s", forbidden)
		}
	}
	if len(share.Redacted) != 2 {
		t.Fatalf("restored values must not appear removed: %v", share.Redacted)
	}
	// The host re-applies the exact policy when relaying a guest payload.
	relayed, err := sanitizeShare(share)
	if err != nil || !strings.Contains(string(relayed.Data), "selected-secret") {
		t.Fatalf("relay: %v %s", err, relayed.Data)
	}
}

func TestCanonicalRevisionIgnoresObjectKeyOrder(t *testing.T) {
	a, _ := PreviewShare(ShareRequest, "A", json.RawMessage(`{"url":"/x","method":"GET"}`))
	b, _ := PreviewShare(ShareRequest, "B", json.RawMessage(`{"method":"GET","url":"/x"}`))
	if a.Revision == "" || a.Revision != b.Revision {
		t.Fatal("revision must hash canonical content")
	}
}
