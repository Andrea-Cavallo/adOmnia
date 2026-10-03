package goide

import (
	"encoding/json"
	"os"
	"path/filepath"
	"strconv"
	"testing"
)

func TestOpenProjectDoesNotAuthorizeTooling(t *testing.T) {
	root := t.TempDir()
	if err := os.WriteFile(filepath.Join(root, "go.mod"), []byte("module example.test/demo\n\ngo 1.24\n"), 0o600); err != nil {
		t.Fatal(err)
	}
	manager := NewWorkspaceManager(newLanguageRegistry())
	session, err := manager.OpenProject(root, DefaultStudioWorkspaceID)
	if err != nil {
		t.Fatal(err)
	}
	if session.Project.Authorization != AuthorizationOpened {
		t.Fatalf("authorization = %q, want %q", session.Project.Authorization, AuthorizationOpened)
	}
	if goLayoutOf(session.Project).GoModPath == "" || len(goLayoutOf(session.Project).Modules) != 1 {
		t.Fatalf("project metadata not detected: %#v", session.Project)
	}
	if goLayoutOf(session.Project).Modules[0].ModulePath != "example.test/demo" {
		t.Fatalf("module path = %q", goLayoutOf(session.Project).Modules[0].ModulePath)
	}
}

// I campi Go legacy di Project devono restare identici a quelli derivati dalle unità dell'adapter.
func TestInspectProjectDerivesLegacyGoFieldsFromUnits(t *testing.T) {
	root := t.TempDir()
	for path, content := range map[string]string{
		"go.mod":            "module example.test/app\n",
		"go.work":           "go 1.26\n\nuse .\n",
		"lib/go.mod":        "module example.test/lib\n",
		"scripts/x/main.go": "package main\n",
	} {
		full := filepath.Join(root, filepath.FromSlash(path))
		if err := os.MkdirAll(filepath.Dir(full), 0o755); err != nil {
			t.Fatal(err)
		}
		if err := os.WriteFile(full, []byte(content), 0o600); err != nil {
			t.Fatal(err)
		}
	}
	project := inspectProject(newLanguageRegistry(), root, root)
	if len(project.Units) != 3 {
		t.Fatalf("units = %#v", project.Units)
	}
	if goLayoutOf(project).GoModPath != filepath.Join(root, "go.mod") || goLayoutOf(project).GoWorkPath != filepath.Join(root, "go.work") {
		t.Fatalf("go.mod/go.work = %q %q", goLayoutOf(project).GoModPath, goLayoutOf(project).GoWorkPath)
	}
	if len(goLayoutOf(project).Modules) != 2 || goLayoutOf(project).Modules[1].Path != filepath.Join(root, "lib") || goLayoutOf(project).Modules[1].ModulePath != "example.test/lib" {
		t.Fatalf("modules = %#v", goLayoutOf(project).Modules)
	}
	if len(goLayoutOf(project).LooseGoDirs) != 0 {
		t.Fatalf("scripts/x is inside the root module, not loose: %#v", goLayoutOf(project).LooseGoDirs)
	}

	// Senza go.mod in radice, la cartella .go fuori dai moduli diventa "loose".
	if err := os.Remove(filepath.Join(root, "go.mod")); err != nil {
		t.Fatal(err)
	}
	project = inspectProject(newLanguageRegistry(), root, root)
	if goLayoutOf(project).GoModPath != "" || len(goLayoutOf(project).LooseGoDirs) != 1 || goLayoutOf(project).LooseGoDirs[0] != "scripts/x" {
		t.Fatalf("goModPath=%q loose=%#v", goLayoutOf(project).GoModPath, goLayoutOf(project).LooseGoDirs)
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

// Una sessione salvata prima delle unità (solo goModPath/modules, ora rimossi) va riletta al restore.
func TestRestoreDetectsUnitsOfLegacySessions(t *testing.T) {
	root := t.TempDir()
	if err := os.WriteFile(filepath.Join(root, "go.mod"), []byte("module example.test/legacy\n"), 0o600); err != nil {
		t.Fatal(err)
	}
	var legacy Session
	persisted := `{"id":"old","project":{"id":"p","name":"legacy","rootPath":` + strconv.Quote(root) + `,"realPath":` + strconv.Quote(root) + `,"goModPath":"x","modules":[{"path":"x"}]}}`
	if err := json.Unmarshal([]byte(persisted), &legacy); err != nil {
		t.Fatal(err)
	}
	manager := NewWorkspaceManager(newLanguageRegistry())
	manager.ReplaceSessions([]Session{legacy})
	restored, ok := manager.sessions["old"]
	if !ok || len(goLayoutOf(restored.Project).Modules) != 1 || goLayoutOf(restored.Project).Modules[0].ModulePath != "example.test/legacy" {
		t.Fatalf("legacy session not migrated: %#v", restored.Project)
	}
}
