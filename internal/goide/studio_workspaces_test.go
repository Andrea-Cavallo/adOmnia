package goide

import (
	"encoding/json"
	"path/filepath"
	"strings"
	"testing"
)

func newWorkspaceTestProject(t *testing.T) string {
	t.Helper()
	root := t.TempDir()
	writeFile(t, filepath.Join(root, "go.mod"), "module example.com/app\n\ngo 1.22\n")
	return root
}

func TestStudioWorkspacesKeepTheSameProjectApart(t *testing.T) {
	project := newWorkspaceTestProject(t)
	service := NewService(&memoryStore{}, nil)
	first, err := service.OpenProject(project)
	if err != nil {
		t.Fatal(err)
	}
	if first.WorkspaceID != DefaultStudioWorkspaceID {
		t.Fatalf("first session workspace = %q", first.WorkspaceID)
	}
	state, err := service.CreateStudioWorkspace("Client B")
	if err != nil {
		t.Fatal(err)
	}
	second, err := service.OpenProject(project)
	if err != nil {
		t.Fatal(err)
	}
	if second.ID == first.ID || second.WorkspaceID != state.ActiveID {
		t.Fatalf("the second workspace must get its own session: first=%+v second=%+v", first, second)
	}
	again, err := service.OpenProject(project)
	if err != nil || again.ID != second.ID {
		t.Fatalf("reopening in the same workspace must reuse the session: %v %v", again.ID, err)
	}
}

func TestStudioWorkspacesPersistAndMigrateOlderSchemas(t *testing.T) {
	project := newWorkspaceTestProject(t)
	legacy, err := json.Marshal(map[string]any{
		"version":  3,
		"sessions": []Session{{ID: "session-old", Project: Project{Name: "app", RootPath: project, RealPath: project}}},
	})
	if err != nil {
		t.Fatal(err)
	}
	store := &memoryStore{data: legacy}
	service := NewService(store, nil)
	sessions, err := service.ListSessions()
	if err != nil {
		t.Fatal(err)
	}
	if len(sessions) != 1 || sessions[0].WorkspaceID != DefaultStudioWorkspaceID {
		t.Fatalf("legacy sessions must land in the default workspace: %+v", sessions)
	}
	created, err := service.CreateStudioWorkspace("Payments")
	if err != nil {
		t.Fatal(err)
	}

	reloaded := NewService(store, nil)
	state, err := reloaded.ListStudioWorkspaces()
	if err != nil {
		t.Fatal(err)
	}
	if state.ActiveID != created.ActiveID || len(state.Workspaces) != 2 || state.Workspaces[1].Name != "Payments" {
		t.Fatalf("workspaces not persisted: %+v", state)
	}
}

func TestStudioWorkspaceRulesProtectOpenProjects(t *testing.T) {
	service := NewService(&memoryStore{}, nil)
	if _, err := service.CreateStudioWorkspace("  "); err == nil {
		t.Fatal("empty names must be rejected")
	}
	state, err := service.CreateStudioWorkspace("Mobile")
	if err != nil {
		t.Fatal(err)
	}
	if _, err := service.CreateStudioWorkspace("mobile"); err == nil {
		t.Fatal("names must be unique ignoring case")
	}
	session, err := service.OpenProject(newWorkspaceTestProject(t))
	if err != nil {
		t.Fatal(err)
	}
	if _, err := service.DeleteStudioWorkspace(state.ActiveID); err == nil || !strings.Contains(err.Error(), "chiudi") {
		t.Fatalf("a workspace with open projects must not be deleted: %v", err)
	}
	if err := service.CloseSession(string(session.ID)); err != nil {
		t.Fatal(err)
	}
	after, err := service.DeleteStudioWorkspace(state.ActiveID)
	if err != nil {
		t.Fatal(err)
	}
	if after.ActiveID != DefaultStudioWorkspaceID || len(after.Workspaces) != 1 {
		t.Fatalf("deleting the active workspace must fall back to the default: %+v", after)
	}
	if _, err := service.DeleteStudioWorkspace(DefaultStudioWorkspaceID); err == nil {
		t.Fatal("the default workspace must not be deleted")
	}
}
