package codestudio

import (
	"os"
	"path/filepath"
	"testing"
)

func writeServiceRunTargetFile(t *testing.T, root, relative, content string) {
	t.Helper()
	path := filepath.Join(root, filepath.FromSlash(relative))
	if err := os.MkdirAll(filepath.Dir(path), 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(path, []byte(content), 0o644); err != nil {
		t.Fatal(err)
	}
}

func TestListRunTargetsKeepsGoWorkModuleScopes(t *testing.T) {
	root := t.TempDir()
	writeServiceRunTargetFile(t, root, "go.work", "go 1.23\n\nuse (\n\t./api\n\t./worker\n)\n")
	writeServiceRunTargetFile(t, root, "api/go.mod", "module example.test/api\n\ngo 1.23\n")
	writeServiceRunTargetFile(t, root, "api/cmd/main.go", "package main\nfunc main() {}\n")
	writeServiceRunTargetFile(t, root, "worker/go.mod", "module example.test/worker\n\ngo 1.23\n")
	writeServiceRunTargetFile(t, root, "worker/main.go", "package main\nfunc main() {}\n")

	service := NewService(&memoryStore{}, nil)
	t.Cleanup(service.Shutdown)
	session, err := service.OpenProject(root)
	if err != nil {
		t.Fatal(err)
	}
	targets, err := service.ListRunTargets(string(session.ID))
	if err != nil {
		t.Fatal(err)
	}
	if len(targets) != 2 {
		t.Fatalf("targets = %#v", targets)
	}
	if targets[0].ModuleDir == targets[1].ModuleDir {
		t.Fatalf("module scopes collapsed: %#v", targets)
	}
}

func TestServiceResolvesImplicitRunBeforeCommandConstruction(t *testing.T) {
	root := t.TempDir()
	writeServiceRunTargetFile(t, root, "go.mod", "module example.test/app\n\ngo 1.23\n")
	writeServiceRunTargetFile(t, root, "cmd/app/main.go", "package main\nfunc main() {}\n")
	service := NewService(&memoryStore{}, nil)
	t.Cleanup(service.Shutdown)
	session, err := service.OpenProject(root)
	if err != nil {
		t.Fatal(err)
	}
	workingDirectory, target, err := service.resolveLanguageRunTarget(session, "go", "run", session.Project.RealPath, ".")
	if err != nil {
		t.Fatal(err)
	}
	if workingDirectory != session.Project.RealPath || target != "./cmd/app" {
		t.Fatalf("resolved = %q, %q", workingDirectory, target)
	}
}
