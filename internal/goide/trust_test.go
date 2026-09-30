package goide

import "testing"

func TestTrustIsRememberedAcrossReopenAndRestart(t *testing.T) {
	store := &memoryStore{}
	dir := t.TempDir()
	service := NewService(store, nil)
	session, err := service.OpenProject(dir)
	if err != nil {
		t.Fatal(err)
	}
	if session.Project.Authorization == AuthorizationPermitted {
		t.Fatal("a new folder must not be trusted")
	}
	if _, err := service.SetToolAuthorization(string(session.ID), true); err != nil {
		t.Fatal(err)
	}
	if err := service.CloseSession(string(session.ID)); err != nil {
		t.Fatal(err)
	}
	restarted := NewService(store, nil)
	reopened, err := restarted.OpenProject(dir)
	if err != nil {
		t.Fatal(err)
	}
	if reopened.Project.Authorization != AuthorizationPermitted {
		t.Fatalf("trusted folder reopened as %q", reopened.Project.Authorization)
	}
	if _, err := restarted.SetToolAuthorization(string(reopened.ID), false); err != nil {
		t.Fatal(err)
	}
	if restarted.isTrusted(reopened.Project.RealPath) {
		t.Fatal("revoking trust must forget the folder")
	}
}
