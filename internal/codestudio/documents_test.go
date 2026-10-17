package codestudio

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
	if _, err := manager.SaveDocument(session, opened.Document.ID, "package mine\n", saved.DiskToken, false); err == nil || !strings.Contains(err.Error(), "modified externally") {
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

func TestListDirectoryHonoursGitIgnore(t *testing.T) {
	root := t.TempDir()
	if err := os.WriteFile(filepath.Join(root, ".gitignore"), []byte("out/\n*.log\n"), 0o644); err != nil {
		t.Fatal(err)
	}
	if err := os.MkdirAll(filepath.Join(root, "out"), 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.MkdirAll(filepath.Join(root, "node_modules"), 0o755); err != nil {
		t.Fatal(err)
	}
	for _, name := range []string{"main.go", "x.log"} {
		if err := os.WriteFile(filepath.Join(root, name), []byte("x\n"), 0o644); err != nil {
			t.Fatal(err)
		}
	}
	manager := NewDocumentManager()
	proj := testSession(root).Project

	// Senza la richiesta esplicita l'albero è coerente con .gitignore: le cartelle di
	// output spariscono (come node_modules), i file ignorati restano visibili ma marcati.
	entries, err := manager.ListDirectory(proj, "", false)
	if err != nil {
		t.Fatal(err)
	}
	names := make([]string, 0, len(entries))
	flags := map[string]bool{}
	for _, entry := range entries {
		names = append(names, entry.RelativePath)
		flags[entry.RelativePath] = entry.Ignored
	}
	want := []string{".gitignore", "main.go", "x.log"}
	if strings.Join(names, ",") != strings.Join(want, ",") {
		t.Fatalf("albero = %v, want %v", names, want)
	}
	if !flags["x.log"] || flags["main.go"] || flags[".gitignore"] {
		t.Fatalf("marcature errate: %#v", flags)
	}

	// Con "mostra ignorati" tornano anche le cartelle, marcate come ignorate.
	all, err := manager.ListDirectory(proj, "", true)
	if err != nil {
		t.Fatal(err)
	}
	allFlags := map[string]bool{}
	for _, entry := range all {
		allFlags[entry.RelativePath] = entry.Ignored
	}
	for _, name := range []string{"out", "node_modules", "x.log"} {
		if !allFlags[name] {
			t.Fatalf("%s deve essere marcato ignorato: %#v", name, all)
		}
	}
	if allFlags["main.go"] {
		t.Fatalf("i file normali non sono ignorati: %#v", allFlags)
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
	if len(goLayoutOf(project).Modules) != 2 || goLayoutOf(project).GoModPath == "" {
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
	if goLayoutOf(project).GoModPath != "" || len(goLayoutOf(project).Modules) != 1 {
		t.Fatalf("moduli inattesi: %#v", goLayoutOf(project).Modules)
	}
	if len(goLayoutOf(project).LooseGoDirs) != 1 || goLayoutOf(project).LooseGoDirs[0] != "scripts" {
		t.Fatalf("cartelle Go senza modulo inattese: %#v", goLayoutOf(project).LooseGoDirs)
	}
}

func TestLanguageForPathCoversProjectFiles(t *testing.T) {
	cases := map[string]string{
		"main.go": "go", "go.mod": "go", "go.sum": "gosum",
		"web/static/index.html": "html", "static/css/styles.css": "css", "static/js/script.js": "javascript",
		"Dockerfile": "dockerfile", "build/Dockerfile.dev": "dockerfile", "api.dockerfile": "dockerfile",
		"Makefile": "makefile", "rules.mk": "makefile", "pipeline.yaml": "yaml",
		".env": "ini", ".env.local": "ini", "query.sql": "sql", "README.md": "markdown", "docs/flow.mmd": "mermaid", "d.MERMAID": "mermaid", "LICENSE": "plaintext",
		// Formati base senza runtime (piano MULTILANGUAGE-IDE, fase 7): solo file support.
		"theme/app.scss": "scss", "Cargo.toml": "ini", "pom.xml": "xml", "config.yml": "yaml", "tsconfig.jsonc": "json",
		"scripts/deploy.sh": "shell", "build.ps1": "powershell", "run.cmd": "bat", "CHANGELOG.markdown": "markdown",
		"api/orders.proto": "proto", // Monaco id is "proto" ("protobuf" is only an alias: no colors)
	}
	for path, want := range cases {
		if got := languageForPath(path); got != want {
			t.Errorf("languageForPath(%q) = %q, want %q", path, got, want)
		}
	}
}
