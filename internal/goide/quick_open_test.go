package goide

import (
	"fmt"
	"os"
	"path/filepath"
	"testing"
	"time"
)

func writeTree(t *testing.T, root string, files []string) {
	t.Helper()
	for _, file := range files {
		path := filepath.Join(root, filepath.FromSlash(file))
		if err := os.MkdirAll(filepath.Dir(path), 0o755); err != nil {
			t.Fatal(err)
		}
		if err := os.WriteFile(path, []byte("package x\n"), 0o644); err != nil {
			t.Fatal(err)
		}
	}
}

func TestQuickOpenRanksNamesFirstAndMatchesSubsequences(t *testing.T) {
	root := t.TempDir()
	writeTree(t, root, []string{"internal/server/handler.go", "cmd/server/main.go", "server.go", "pkg/p250/file7.go", "pkg/p025/file7.go", "node_modules/server.go"})
	manager := NewDocumentManager()
	project := Project{RealPath: root}
	results, err := manager.QuickOpen(project, "server", 10)
	if err != nil {
		t.Fatal(err)
	}
	if len(results) != 3 || results[0].RelativePath != "server.go" {
		t.Fatalf("il nome deve battere il percorso e le cartelle ignorate restano fuori: %+v", results)
	}
	results, _ = manager.QuickOpen(project, "p250file7", 10)
	if len(results) != 1 || results[0].RelativePath != "pkg/p250/file7.go" {
		t.Fatalf("sottosequenza non trovata: %+v", results)
	}
	results, _ = manager.QuickOpen(project, "p250/file7", 10)
	if len(results) != 1 || results[0].RelativePath != "pkg/p250/file7.go" {
		t.Fatalf("percorso non trovato: %+v", results)
	}
}

func TestQuickOpenIndexIsRebuiltAfterInvalidation(t *testing.T) {
	root := t.TempDir()
	writeTree(t, root, []string{"a.go"})
	manager := NewDocumentManager()
	project := Project{RealPath: root}
	if results, _ := manager.QuickOpen(project, "b.go", 10); len(results) != 0 {
		t.Fatal("b.go non esiste ancora")
	}
	writeTree(t, root, []string{"b.go"})
	if results, _ := manager.QuickOpen(project, "b.go", 10); len(results) != 0 {
		t.Fatal("senza invalidazione l'indice resta quello costruito")
	}
	manager.InvalidateFileIndex(root)
	if results, _ := manager.QuickOpen(project, "b.go", 10); len(results) != 1 {
		t.Fatal("dopo l'invalidazione il nuovo file deve comparire")
	}
}

func TestQuickOpenStaysFastOnLargeProjects(t *testing.T) {
	root := t.TempDir()
	files := make([]string, 0, 3200)
	for pkg := 0; pkg < 400; pkg++ {
		for file := 0; file < 8; file++ {
			files = append(files, fmt.Sprintf("pkg/p%03d/file%d.go", pkg, file))
		}
	}
	writeTree(t, root, files)
	manager := NewDocumentManager()
	project := Project{RealPath: root}
	if _, err := manager.QuickOpen(project, "", 10); err != nil {
		t.Fatal(err)
	}
	started := time.Now()
	for _, query := range []string{"p", "p2", "p25", "p250", "p250/", "p250/f", "p250/file7"} {
		if _, err := manager.QuickOpen(project, query, 100); err != nil {
			t.Fatal(err)
		}
	}
	if elapsed := time.Since(started); elapsed > time.Second {
		t.Fatalf("7 ricerche su 3.200 file in %s: troppo lente", elapsed)
	}
}
