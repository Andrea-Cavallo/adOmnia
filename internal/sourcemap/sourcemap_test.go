package sourcemap

import (
	"os"
	"path/filepath"
	"testing"
)

func repo(t *testing.T, files ...string) string {
	t.Helper()
	root := t.TempDir()
	for _, file := range files {
		path := filepath.Join(root, filepath.FromSlash(file))
		if err := os.MkdirAll(filepath.Dir(path), 0o755); err != nil {
			t.Fatal(err)
		}
		if err := os.WriteFile(path, []byte("package x\n"), 0o644); err != nil {
			t.Fatal(err)
		}
	}
	ClearIndex()
	return root
}

func TestResolveMatchesTheLongestCandidateFirst(t *testing.T) {
	root := repo(t, "internal/orders/service.go", "other/service.go")
	result := Resolve([]string{root}, []string{
		"home/ci/app/internal/orders/service.go",
		"internal/orders/service.go",
		"service.go",
	})
	if !result.Found {
		t.Fatalf("expected a match, got %+v", result)
	}
	if filepath.Base(filepath.Dir(result.Path)) != "orders" {
		t.Fatalf("resolved the wrong file: %s", result.Path)
	}
	if result.Matched != "internal/orders/service.go" {
		t.Fatalf("expected the specific candidate to win, got %q", result.Matched)
	}
}

func TestResolveReportsAmbiguity(t *testing.T) {
	root := repo(t, "a/Order.java", "b/Order.java")
	result := Resolve([]string{root}, []string{"Order.java"})
	if !result.Found || len(result.Ambiguous) != 1 {
		t.Fatalf("expected one reported alternative, got %+v", result)
	}
}

func TestResolveSkipsDependencyDirectories(t *testing.T) {
	root := repo(t, "node_modules/pkg/index.js")
	if result := Resolve([]string{root}, []string{"pkg/index.js"}); result.Found {
		t.Fatalf("node_modules must not be indexed: %+v", result)
	}
}

func TestOpenRefusesPathsOutsideTheSelectedRoots(t *testing.T) {
	root := repo(t, "main.go")
	outside := filepath.Join(t.TempDir(), "evil.go")
	if err := os.WriteFile(outside, []byte("x"), 0o644); err != nil {
		t.Fatal(err)
	}
	if err := Open([]string{root}, outside, 1, "echo {file}"); err == nil {
		t.Fatal("expected the path outside the repository to be refused")
	}
}

func TestEditorCommandExpandsFileAndLine(t *testing.T) {
	cmd, err := editorCommand("code -g {file}:{line}", "/src/main.go", 42)
	if err != nil {
		t.Fatal(err)
	}
	if got := cmd.Args[len(cmd.Args)-1]; got != "/src/main.go:42" {
		t.Fatalf("unexpected argument %q", got)
	}
}
