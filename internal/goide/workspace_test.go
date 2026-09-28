package goide

import (
	"os"
	"path/filepath"
	"testing"
)

func TestOpenProjectDoesNotAuthorizeTooling(t *testing.T) {
	root := t.TempDir()
	if err := os.WriteFile(filepath.Join(root, "go.mod"), []byte("module example.test/demo\n\ngo 1.24\n"), 0o600); err != nil {
		t.Fatal(err)
	}
	manager := NewWorkspaceManager()
	session, err := manager.OpenProject(root)
	if err != nil {
		t.Fatal(err)
	}
	if session.Project.Authorization != AuthorizationOpened {
		t.Fatalf("authorization = %q, want %q", session.Project.Authorization, AuthorizationOpened)
	}
	if session.Project.GoModPath == "" || len(session.Project.Modules) != 1 {
		t.Fatalf("project metadata not detected: %#v", session.Project)
	}
	if session.Project.Modules[0].ModulePath != "example.test/demo" {
		t.Fatalf("module path = %q", session.Project.Modules[0].ModulePath)
	}
}

func TestResolveProjectPathRejectsSymlinkEscape(t *testing.T) {
	root := t.TempDir()
	outside := t.TempDir()
	outsideFile := filepath.Join(outside, "secret.go")
	if err := os.WriteFile(outsideFile, []byte("package secret"), 0o600); err != nil {
		t.Fatal(err)
	}
	link := filepath.Join(root, "linked.go")
	if err := os.Symlink(outsideFile, link); err != nil {
		t.Skipf("symlink not available: %v", err)
	}
	_, realRoot, err := resolveProjectRoot(root)
	if err != nil {
		t.Fatal(err)
	}
	manager := NewDocumentManager()
	if _, err := manager.ResolveProjectPath(Project{RootPath: root, RealPath: realRoot}, link); err == nil {
		t.Fatal("expected symlink escape to be rejected")
	}
}
