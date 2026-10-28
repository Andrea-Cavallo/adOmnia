package codestudio

import (
	"os"
	"path/filepath"
	"strings"
	"testing"

	"github.com/Andrea-Cavallo/adOmnia/internal/ide/project"
)

func TestFileOperations(t *testing.T) {
	root := t.TempDir()
	project := Project{RealPath: root}
	manager := &DocumentManager{}
	write := func(rel, content string) {
		path := filepath.Join(root, filepath.FromSlash(rel))
		if err := os.MkdirAll(filepath.Dir(path), 0o755); err != nil {
			t.Fatal(err)
		}
		if err := os.WriteFile(path, []byte(content), 0o644); err != nil {
			t.Fatal(err)
		}
	}
	exists := func(rel string) bool {
		_, err := os.Lstat(filepath.Join(root, filepath.FromSlash(rel)))
		return err == nil
	}
	write("pkg/a.go", "package pkg\n")
	write("pkg/b.go", "package pkg\n")

	if err := manager.CreateDirectory(project, "internal/new"); err != nil || !exists("internal/new") {
		t.Fatalf("create directory: %v", err)
	}
	if err := manager.MovePath(project, "pkg/a.go", "pkg/renamed.go"); err != nil || exists("pkg/a.go") || !exists("pkg/renamed.go") {
		t.Fatalf("rename file: %v", err)
	}
	if err := manager.MovePath(project, "pkg/renamed.go", "pkg/b.go"); err == nil {
		t.Fatal("rename must never overwrite an existing file")
	}
	if err := manager.MovePath(project, "pkg", "pkg/inner"); err == nil {
		t.Fatal("moving a folder inside itself must fail")
	}
	if err := manager.DuplicatePath(project, "pkg", "pkg-copy"); err != nil || !exists("pkg-copy/b.go") || !exists("pkg/b.go") {
		t.Fatalf("duplicate folder: %v", err)
	}
	var kept []string
	if err := manager.DeletePath(project, "pkg-copy", func(rel, _ string) { kept = append(kept, rel) }); err != nil || exists("pkg-copy") {
		t.Fatalf("delete folder: %v", err)
	}
	if len(kept) != 2 || kept[0] != "pkg-copy/b.go" {
		t.Fatalf("deleted files not kept for local history: %v", kept)
	}
	for _, bad := range []string{"", ".", "..", "../outside", filepath.Join(root, "pkg")} {
		if err := manager.DeletePath(project, bad, nil); err == nil {
			t.Errorf("DeletePath(%q) accepted", bad)
		}
		if err := manager.MovePath(project, "pkg/b.go", bad); err == nil {
			t.Errorf("MovePath to %q accepted", bad)
		}
	}
	if !exists("pkg/b.go") {
		t.Fatal("rejected operations must not touch files")
	}
}

func TestMovePackageRewritesOnlyGoImports(t *testing.T) {
	root := t.TempDir()
	write := func(rel, content string) {
		path := filepath.Join(root, filepath.FromSlash(rel))
		if err := os.MkdirAll(filepath.Dir(path), 0o755); err != nil {
			t.Fatal(err)
		}
		if err := os.WriteFile(path, []byte(content), 0o644); err != nil {
			t.Fatal(err)
		}
	}
	read := func(rel string) string {
		content, err := os.ReadFile(filepath.Join(root, filepath.FromSlash(rel)))
		if err != nil {
			t.Fatal(err)
		}
		return string(content)
	}
	write("go.mod", "module example.com/app\n")
	write("internal/old/value.go", "package old\n")
	write("internal/old/sub/value.go", "package sub\n")
	write("cmd/app/main.go", "package main\n\nimport (\n oldalias \"example.com/app/internal/old\"\n \"example.com/app/internal/old/sub\"\n)\n\nconst untouched = \"example.com/app/internal/old\"\n")
	projectModel := Project{RealPath: root, RootPath: root, Units: []project.Unit{{Language: "go", Kind: "module", Root: root, Name: "example.com/app", Manifest: filepath.Join(root, "go.mod")}}}
	manager := &DocumentManager{}
	if err := manager.MovePath(projectModel, "internal/old", "pkg/newplace"); err != nil {
		t.Fatal(err)
	}
	if _, err := os.Stat(filepath.Join(root, "pkg/newplace/value.go")); err != nil {
		t.Fatal(err)
	}
	content := read("cmd/app/main.go")
	for _, expected := range []string{"oldalias \"example.com/app/pkg/newplace\"", "\"example.com/app/pkg/newplace/sub\"", "const untouched = \"example.com/app/internal/old\""} {
		if !strings.Contains(content, expected) {
			t.Fatalf("missing %q in:\n%s", expected, content)
		}
	}
}
