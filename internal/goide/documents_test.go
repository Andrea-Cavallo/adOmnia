package goide

import (
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"
)

func testSession(root string) Session {
	return Session{
		ID: "session-test",
		Project: Project{
			ID: "project-test", Name: filepath.Base(root), RootPath: root, RealPath: root,
			Authorization: AuthorizationOpened,
		},
		OpenedAt: time.Now(), UpdatedAt: time.Now(),
	}
}

func TestDocumentOpenSaveAndExternalConflict(t *testing.T) {
	root := t.TempDir()
	path := filepath.Join(root, "main.go")
	if err := os.WriteFile(path, []byte("package main\n"), 0o640); err != nil {
		t.Fatal(err)
	}
	manager := NewDocumentManager()
	session := testSession(root)
	opened, err := manager.OpenDocument(session, "main.go")
	if err != nil {
		t.Fatal(err)
	}
	if opened.Document.Language != "go" || opened.Document.URI == "" {
		t.Fatalf("document metadata incompleto: %#v", opened.Document)
	}
	saved, err := manager.SaveDocument(session, opened.Document.ID, "package main\n\nfunc main() {}\n", opened.DiskToken, false)
	if err != nil {
		t.Fatal(err)
	}
	if saved.DiskToken == opened.DiskToken || saved.Document.Version != 2 {
		t.Fatalf("salvataggio non versionato: %#v", saved)
	}
	if err := os.WriteFile(path, []byte("package changed\n"), 0o640); err != nil {
		t.Fatal(err)
	}
	if _, err := manager.SaveDocument(session, opened.Document.ID, "package mine\n", saved.DiskToken, false); err == nil || !strings.Contains(err.Error(), "modificato esternamente") {
		t.Fatalf("conflitto esterno non rilevato: %v", err)
	}
	data, err := os.ReadFile(path)
	if err != nil || string(data) != "package changed\n" {
		t.Fatalf("il buffer fallito ha sovrascritto il file: %q, %v", data, err)
	}
}

func TestDirectoryIsLazyAndQuickOpenIsBounded(t *testing.T) {
	root := t.TempDir()
	if err := os.MkdirAll(filepath.Join(root, "cmd", "server"), 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.MkdirAll(filepath.Join(root, ".git", "objects"), 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(root, "cmd", "server", "main.go"), []byte("package main\n"), 0o644); err != nil {
		t.Fatal(err)
	}
	manager := NewDocumentManager()
	project := testSession(root).Project
	rootEntries, err := manager.ListDirectory(project, "", false)
	if err != nil {
		t.Fatal(err)
	}
	if len(rootEntries) != 1 || rootEntries[0].RelativePath != "cmd" {
		t.Fatalf("la lettura deve restare a un livello e ignorare .git: %#v", rootEntries)
	}
	results, err := manager.QuickOpen(project, "main", 10)
	if err != nil {
		t.Fatal(err)
	}
	if len(results) != 1 || results[0].RelativePath != "cmd/server/main.go" {
		t.Fatalf("quick open inatteso: %#v", results)
	}
}

func TestWorkspaceFindsNestedModules(t *testing.T) {
	root := t.TempDir()
	if err := os.WriteFile(filepath.Join(root, "go.mod"), []byte("module example.com/root\n"), 0o644); err != nil {
		t.Fatal(err)
	}
	if err := os.MkdirAll(filepath.Join(root, "services", "api"), 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(root, "services", "api", "go.mod"), []byte("module example.com/api\n"), 0o644); err != nil {
		t.Fatal(err)
	}
	project := inspectProject(newLanguageRegistry(), root, root)
	if len(project.Modules) != 2 || project.GoModPath == "" {
		t.Fatalf("moduli annidati non rilevati: %#v", project)
	}
}

func TestWorkspaceDistinguishesGoFoldersWithoutModule(t *testing.T) {
	root := t.TempDir()
	files := map[string]string{
		"scripts/gen.go":    "package main\n",
		"svc/go.mod":        "module example.com/svc\n",
		"svc/main.go":       "package main\n",
		"svc/internal/x.go": "package internal\n",
	}
	for name, content := range files {
		path := filepath.Join(root, filepath.FromSlash(name))
		if err := os.MkdirAll(filepath.Dir(path), 0o755); err != nil {
			t.Fatal(err)
		}
		if err := os.WriteFile(path, []byte(content), 0o644); err != nil {
			t.Fatal(err)
		}
	}
	project := inspectProject(newLanguageRegistry(), root, root)
	if project.GoModPath != "" || len(project.Modules) != 1 {
		t.Fatalf("moduli inattesi: %#v", project.Modules)
	}
	if len(project.LooseGoDirs) != 1 || project.LooseGoDirs[0] != "scripts" {
		t.Fatalf("cartelle Go senza modulo inattese: %#v", project.LooseGoDirs)
	}
}

func TestLanguageForPathCoversProjectFiles(t *testing.T) {
	cases := map[string]string{
		"main.go": "go", "go.mod": "go", "go.sum": "gosum",
		"web/static/index.html": "html", "static/css/styles.css": "css", "static/js/script.js": "javascript",
		"Dockerfile": "dockerfile", "build/Dockerfile.dev": "dockerfile", "api.dockerfile": "dockerfile",
		"Makefile": "makefile", "rules.mk": "makefile", "pipeline.yaml": "yaml",
		".env": "ini", ".env.local": "ini", "query.sql": "sql", "README.md": "markdown", "LICENSE": "plaintext",
	}
	for path, want := range cases {
		if got := languageForPath(path); got != want {
			t.Errorf("languageForPath(%q) = %q, want %q", path, got, want)
		}
	}
}
