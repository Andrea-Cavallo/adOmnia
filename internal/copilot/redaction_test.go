package copilot

import (
	"strings"
	"testing"
)

// Split so the repository never contains a contiguous credential-shaped string:
// GitHub push protection treats test fixtures as leaked secrets otherwise.
const (
	fakeAWSKey   = "AKIA" + "IOSFODNN7EXAMPLE"
	fakeJWTValue = "ey" + "JhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.dozjgNryP4J3jVmNHl0w5N_XgL0n3I9PlFUP0THsR8U"
)

// The Copilot language server is a cloud service: unsaved buffers must never
// carry a recognizable token, even when the file itself is allowed.
func TestDocumentBuffersAreRedactedBeforeSync(t *testing.T) {
	root := t.TempDir()
	manager := NewManager(NewSettingsStore(t.TempDir()), NewInstaller(t.TempDir()))
	uri := fileURI(root + "/main.go")
	text := "package main\n\nconst awsKey = \"" + fakeAWSKey + "\"\nvar jwt = \"" + fakeJWTValue + "\"\n"
	manager.DocumentOpened(OpenedDocument{ID: "doc-1", URI: uri, Root: root, RootName: "demo", RelativePath: "main.go", LanguageID: "go", Text: text})

	tracked := manager.documents[uri]
	if tracked == nil {
		t.Fatal("document not tracked")
	}
	if strings.Contains(tracked.text, fakeAWSKey) || strings.Contains(tracked.text, fakeJWTValue[:20]) {
		t.Fatalf("secret reached the synchronized buffer: %q", tracked.text)
	}
	if len(tracked.text) != len(text) || strings.Count(tracked.text, "\n") != strings.Count(text, "\n") {
		t.Fatalf("mask changed positions: %q", tracked.text)
	}

	changed := "package main\n\nconst password = \"another-secret-value\"\n"
	manager.DocumentChanged("doc-1", 2, changed)
	tracked = manager.documents[uri]
	if strings.Contains(tracked.text, "another-secret-value") {
		t.Fatalf("changed buffer leaked a secret: %q", tracked.text)
	}
}

// Without activation every AI service must stay idle: no resolver, no process.
func TestDisabledManagerDoesNotStart(t *testing.T) {
	manager := NewManager(NewSettingsStore(t.TempDir()), NewInstaller(t.TempDir()))
	if manager.Settings().Enabled {
		t.Fatal("Copilot is enabled by default")
	}
	if err := manager.Start(); err != nil {
		t.Fatal(err)
	}
	if manager.current != nil {
		t.Fatal("disabled Copilot started a process")
	}
	if manager.Status().State != StateDisabled {
		t.Fatalf("unexpected state: %s", manager.Status().State)
	}
}
