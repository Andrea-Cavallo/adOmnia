package collab

import (
	"encoding/base64"
	"encoding/json"
	"testing"
)

func TestDocumentRelayAuthorizationAndLateSync(t *testing.T) {
	host, hostRec := startHost(t)
	editor, editorRec := join(t, host, RoleEditor, "Editor")
	viewer, viewerRec := join(t, host, RoleViewer, "Viewer")
	initial := base64.StdEncoding.EncodeToString([]byte{1, 2, 3})
	if err := host.OpenDocument("opaque-room", initial); err != nil {
		t.Fatal(err)
	}
	editorRec.waitFor(t, EventDocument)
	viewerRec.waitFor(t, EventDocument)
	update := DocumentMessage{ID: "opaque-room", Action: "update", Data: base64.StdEncoding.EncodeToString([]byte{4, 5})}
	if err := editor.Document(update); err != nil {
		t.Fatal(err)
	}
	if e := hostRec.waitFor(t, EventDocument); e.From != editor.Status().Self {
		t.Fatal("forged sender")
	}
	viewerRec.waitFor(t, EventDocument)
	// A forged client role cannot bypass host-side permission checks.
	if msg := host.relayDocument(viewer.Status().Self, mustJSON(update)); msg == "" {
		t.Fatal("viewer update accepted")
	}
	if err := host.SetRole(editor.Status().Self, RoleViewer); err != nil {
		t.Fatal(err)
	}
	if msg := host.relayDocument(editor.Status().Self, mustJSON(update)); msg == "" {
		t.Fatal("downgraded editor update accepted")
	}
	late, rec := join(t, host, RoleViewer, "Late")
	if err := late.Document(DocumentMessage{ID: "opaque-room", Action: "sync"}); err != nil {
		t.Fatal(err)
	}
	var sync DocumentMessage
	json.Unmarshal(rec.waitFor(t, EventDocument).Payload, &sync)
	if len(sync.Updates) != 2 || sync.Updates[0] != initial || sync.Updates[1] != update.Data {
		t.Fatalf("history: %+v", sync)
	}
	if msg := host.relayDocument(viewer.Status().Self, mustJSON(DocumentMessage{ID: "opaque-room", Action: "close"})); msg == "" {
		t.Fatal("guest closed room")
	}
	if err := host.Document(DocumentMessage{ID: "opaque-room", Action: "close"}); err != nil {
		t.Fatal(err)
	}
	if msg := host.relayDocument(late.Status().Self, mustJSON(update)); msg == "" {
		t.Fatal("closed room accepted update")
	}
}

func TestDocumentLimitsAndHostOnlyCreation(t *testing.T) {
	host, _ := startHost(t)
	guest, _ := join(t, host, RoleEditor, "Guest")
	if err := guest.OpenDocument("x", "AQ=="); err == nil {
		t.Fatal("guest created room")
	}
	if err := host.OpenDocument("x", "invalid"); err == nil {
		t.Fatal("invalid base64 accepted")
	}
	if err := host.OpenDocument("x", "AQ=="); err != nil {
		t.Fatal(err)
	}
	if err := host.OpenDocument("x", "AQ=="); err == nil {
		t.Fatal("room overwritten")
	}
	for _, msg := range []DocumentMessage{
		{ID: "unknown", Action: "update", Data: "AQ=="},
		{ID: "x", Action: "open", Data: "AQ=="},
		{ID: "x", Action: "update", Data: "invalid"},
		{ID: "x", Action: "sync", Updates: []string{"AQ=="}},
	} {
		if reason := host.relayDocument(guest.Status().Self, mustJSON(msg)); reason == "" {
			t.Fatalf("accepted: %+v", msg)
		}
	}
	host.mu.Lock()
	host.documents["x"].bytes = maxDocumentHistory
	host.mu.Unlock()
	if err := host.Document(DocumentMessage{ID: "x", Action: "update", Data: "AQ=="}); err == nil {
		t.Fatal("history limit ignored")
	}
}
