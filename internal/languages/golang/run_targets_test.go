package golang

import (
	"context"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"adomnia/internal/ide/run"
)

func writeRunTargetFile(t *testing.T, root, relative, content string) {
	t.Helper()
	path := filepath.Join(root, filepath.FromSlash(relative))
	if err := os.MkdirAll(filepath.Dir(path), 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(path, []byte(content), 0o644); err != nil {
		t.Fatal(err)
	}
}

func TestDiscoverRunTargetsRequiresMainFunction(t *testing.T) {
	root := t.TempDir()
	writeRunTargetFile(t, root, "go.mod", "module example.test/app\n\ngo 1.23\n")
	writeRunTargetFile(t, root, "cmd/api/main.go", "package main\nfunc main() {}\n")
	writeRunTargetFile(t, root, "cmd/worker/worker.go", "package main\nfunc Work() {}\n")
	writeRunTargetFile(t, root, "cmd/ignored/main.go", "//go:build ignore\n\npackage main\nfunc main() {}\n")

	targets, err := New().DiscoverRunTargets(context.Background(), root)
	if err != nil {
		t.Fatal(err)
	}
	if len(targets) != 1 || targets[0].Package != "./cmd/api" || targets[0].ModuleDir != root {
		t.Fatalf("targets = %#v", targets)
	}
}

func TestResolveRunTargetFindsSingleMainUnderCmd(t *testing.T) {
	root := t.TempDir()
	writeRunTargetFile(t, root, "go.mod", "module example.test/server\n\ngo 1.23\n")
	writeRunTargetFile(t, root, "cmd/server/main.go", "package main\nfunc main() {}\n")

	target, err := New().ResolveRunTarget(context.Background(), run.ResolveTargetRequest{Root: root, WorkingDirectory: root, Target: ".", Kind: "run"})
	if err != nil {
		t.Fatal(err)
	}
	if target.Package != "./cmd/server" || target.ModuleDir != root {
		t.Fatalf("target = %#v", target)
	}
}

func TestResolveRunTargetRejectsAmbiguousMainPackages(t *testing.T) {
	root := t.TempDir()
	writeRunTargetFile(t, root, "go.mod", "module example.test/tools\n\ngo 1.23\n")
	writeRunTargetFile(t, root, "cmd/api/main.go", "package main\nfunc main() {}\n")
	writeRunTargetFile(t, root, "cmd/worker/main.go", "package main\nfunc main() {}\n")

	_, err := New().ResolveRunTarget(context.Background(), run.ResolveTargetRequest{Root: root, WorkingDirectory: root, Target: ".", Kind: "run"})
	if err == nil || !strings.Contains(err.Error(), "choose a run target") || !strings.Contains(err.Error(), "./cmd/api") {
		t.Fatalf("error = %v", err)
	}
}

func TestResolveRunTargetPrefersConventionalModuleCommand(t *testing.T) {
	root := t.TempDir()
	writeRunTargetFile(t, root, "go.mod", "module example.test/api\n\ngo 1.23\n")
	writeRunTargetFile(t, root, "cmd/api/main.go", "package main\nfunc main() {}\n")
	writeRunTargetFile(t, root, "cmd/worker/main.go", "package main\nfunc main() {}\n")

	target, err := New().ResolveRunTarget(context.Background(), run.ResolveTargetRequest{Root: root, WorkingDirectory: root, Target: ".", Kind: "run"})
	if err != nil {
		t.Fatal(err)
	}
	if target.Package != "./cmd/api" {
		t.Fatalf("target = %#v", target)
	}
}

func TestResolveRunTargetUsesInnermostModuleForFile(t *testing.T) {
	root := t.TempDir()
	writeRunTargetFile(t, root, "go.mod", "module example.test/root\n")
	writeRunTargetFile(t, root, "services/api/go.mod", "module example.test/api\n")
	writeRunTargetFile(t, root, "services/api/cmd/main.go", "package main\nfunc main() {}\n")

	target, err := New().ResolveRunTarget(context.Background(), run.ResolveTargetRequest{Root: root, WorkingDirectory: root, Target: "services/api/cmd/main.go", Kind: "run"})
	if err != nil {
		t.Fatal(err)
	}
	if target.Package != "./cmd" || target.ModuleDir != filepath.Join(root, "services", "api") {
		t.Fatalf("target = %#v", target)
	}
}
