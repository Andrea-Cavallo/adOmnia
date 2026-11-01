package codestudio

import (
	"context"
	"os"
	"path/filepath"
	"testing"
)

func TestRedetectUnitsRefreshesStaleRestoredUnits(t *testing.T) {
	root := t.TempDir()
	manager := NewWorkspaceManager(newLanguageRegistry())
	// Restored from disk with no units: the project gained a go.mod while adOmnia was closed.
	manager.ReplaceSessions([]Session{{ID: "s", Project: Project{RootPath: root, RealPath: root}}})
	if err := os.WriteFile(filepath.Join(root, "go.mod"), []byte("module example.com/app\n\ngo 1.22\n"), 0o600); err != nil {
		t.Fatal(err)
	}
	if !manager.RedetectUnits(context.Background(), "s") {
		t.Fatal("new units must be reported as a change")
	}
	session, err := manager.GetSession("s")
	if err != nil || len(session.Project.Units) == 0 || session.Project.Units[0].Language != "go" {
		t.Fatalf("units not refreshed: %+v %v", session.Project.Units, err)
	}
	if manager.RedetectUnits(context.Background(), "s") {
		t.Fatal("unchanged units must not publish an update")
	}
	if manager.RedetectUnits(context.Background(), "missing") {
		t.Fatal("a closed session has nothing to refresh")
	}
}
