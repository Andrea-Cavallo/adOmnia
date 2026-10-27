package codestudio

import (
	"testing"

	"github.com/Andrea-Cavallo/adOmnia/internal/languages/golang"
)

func TestUserLanguageServerEntryPointsPinBeforeLaunch(t *testing.T) {
	root := t.TempDir()
	writeFixtureFile(t, root, "go.mod", "module example.test/intent\n\ngo 1.26\n")
	service := NewService(&memoryStore{}, nil)
	t.Cleanup(service.Shutdown)
	session, err := service.OpenProject(root)
	if err != nil {
		t.Fatal(err)
	}
	// Tool authorization is deliberately absent: no external process can launch.
	if _, err := service.StartLanguageServerFromUser(string(session.ID), LanguageServerSettings{}); err == nil {
		t.Fatal("untrusted tools launched")
	}
	if !service.lsp.UserPinned(session.ID, golang.ID) {
		t.Fatal("user start was not protected")
	}
	service.lsp.Stop(session.ID, golang.ID)
	if service.lsp.UserPinned(session.ID, golang.ID) {
		t.Fatal("stop did not clear explicit intent")
	}
	if _, err := service.RestartLanguageServerFromUser(string(session.ID), LanguageServerSettings{}); err == nil {
		t.Fatal("untrusted restart launched tools")
	}
	if !service.lsp.UserPinned(session.ID, golang.ID) {
		t.Fatal("user restart was not protected")
	}
}
