package codestudio

import (
	"reflect"
	"testing"
	"time"
)

func TestDocumentationService(t *testing.T) {
	root := t.TempDir()
	writeFixtureFile(t, root, "go.mod", "module example.com/docs\n\ngo 1.22\n")
	writeFixtureFile(t, root, "pay/pay.go", "// Package pay charges cards.\npackage pay\n\n// Charge charges a card.\nfunc Charge() {}\n\nfunc Refund() {}\n")
	writeFixtureFile(t, root, "api/pay.proto", "syntax = \"proto3\";\n\n// Payments.\nservice Payments { rpc Pay(Req) returns (Res); }\nmessage Req {}\nmessage Res {}\n")

	service := NewService(&memoryStore{}, nil)
	t.Cleanup(service.Shutdown)
	session, err := service.OpenProject(root)
	if err != nil {
		t.Fatal(err)
	}
	report, err := service.Documentation(string(session.ID))
	if err != nil {
		t.Fatal(err)
	}
	if len(report.Packages) != 1 || report.Packages[0].ImportPath != "example.com/docs/pay" || report.Packages[0].Dir != "pay" {
		t.Fatalf("packages: %+v", report.Packages)
	}
	charge := report.Packages[0].Funcs[0]
	if charge.Name != "Charge" || charge.Site.Path != "pay/pay.go" || charge.Site.Line != 5 {
		t.Fatalf("charge: %+v", charge)
	}
	if len(report.Problems) != 1 || report.Problems[0].Kind != "doc-missing" || report.Problems[0].Location.Line != 7 || report.Problems[0].Fix == nil {
		t.Fatalf("problems: %+v", report.Problems)
	}
	edit := report.Problems[0].Fix.Edits[0]
	if edit.Text != "// Refund \n" || edit.Range.StartLine != 7 || edit.Range.StartColumn != 1 {
		t.Fatalf("stub edit: %+v", edit)
	}
	if len(report.Protos) != 1 || report.Protos[0].Services[0].Doc != "Payments." {
		t.Fatalf("protos: %+v", report.Protos)
	}
}

// waitForSourceGeneration fa avanzare il test solo quando il watcher ha visto la modifica: con un
// watcher incompleto la cache si valida con l'impronta, quindi non c'è niente da aspettare.
func waitForSourceGeneration(t *testing.T, service *Service, sessionID string, before uint64) {
	t.Helper()
	if _, watchedFully := service.sourceGeneration(sessionID); !watchedFully {
		return
	}
	deadline := time.Now().Add(5 * time.Second)
	for time.Now().Before(deadline) {
		if generation, _ := service.sourceGeneration(sessionID); generation != before {
			return
		}
		time.Sleep(10 * time.Millisecond)
	}
	t.Fatalf("the watcher did not report the edit")
}

func TestDocumentationCacheInvalidatesOnEdit(t *testing.T) {
	root := t.TempDir()
	writeFixtureFile(t, root, "go.mod", "module example.com/docs\n\ngo 1.22\n")
	writeFixtureFile(t, root, "pay/pay.go", "// Package pay charges cards.\npackage pay\n\nfunc Charge() {}\n")

	service := NewService(&memoryStore{}, nil)
	t.Cleanup(service.Shutdown)
	session, err := service.OpenProject(root)
	if err != nil {
		t.Fatal(err)
	}
	// The watcher starts in the background: an edit written while it registers folders is never reported.
	waitWatching(t, service, session.ID)

	first, err := service.Documentation(string(session.ID))
	if err != nil {
		t.Fatal(err)
	}
	if len(first.Problems) != 1 {
		t.Fatalf("first read should report the missing comment: %+v", first.Problems)
	}
	// The panel reopens on the same sources: the second read comes from the cache.
	again, err := service.Documentation(string(session.ID))
	if err != nil {
		t.Fatal(err)
	}
	if !reflect.DeepEqual(first, again) {
		t.Fatalf("cached read differs from the first one")
	}

	generation, _ := service.sourceGeneration(string(session.ID))
	writeFixtureFile(t, root, "pay/pay.go", "// Package pay charges cards.\npackage pay\n\n// Charge charges a card.\nfunc Charge() {}\n")
	waitForSourceGeneration(t, service, string(session.ID), generation)

	third, err := service.Documentation(string(session.ID))
	if err != nil {
		t.Fatal(err)
	}
	if len(third.Problems) != 0 {
		t.Fatalf("the edit was not picked up: %+v", third.Problems)
	}
}
