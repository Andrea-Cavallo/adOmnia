package main

import (
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func writeTestNote(t *testing.T, root, rel, content string) {
	t.Helper()
	path := filepath.Join(root, filepath.FromSlash(rel))
	if err := os.MkdirAll(filepath.Dir(path), 0755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(path, []byte(content), 0644); err != nil {
		t.Fatal(err)
	}
}

func TestMarkdownWorkspaceFileOperationsAndAgentGraph(t *testing.T) {
	t.Setenv("APPDATA", t.TempDir())
	root := filepath.Join(t.TempDir(), "notes")
	if err := os.MkdirAll(root, 0755); err != nil {
		t.Fatal(err)
	}

	writeTestNote(t, root, "index.md", strings.Join([]string{
		"---",
		"tags: [home, api]",
		"---",
		"# Index",
		"",
		"See [[notes/note-01|first note]], [second](notes/note-02.md), and [[Missing Note]].",
	}, "\n"))
	for i := 1; i <= 21; i++ {
		prev := "index"
		if i > 1 {
			prev = "notes/note-" + twoDigit(i-1)
		}
		next := "Missing Note"
		if i < 21 {
			next = "notes/note-" + twoDigit(i+1)
		}
		writeTestNote(t, root, "notes/note-"+twoDigit(i)+".md", "# Note "+twoDigit(i)+"\n\nBack to [previous]("+prev+".md) and forward to [next]("+next+").\n\n#tag-"+twoDigit(i))
	}
	writeTestNote(t, root, ".git/ignored.md", "# ignored")
	writeTestNote(t, root, "node_modules/ignored.md", "# ignored")
	writeTestNote(t, root, "dist/ignored.markdown", "# ignored")
	if err := os.WriteFile(filepath.Join(root, "plain.txt"), []byte("not markdown"), 0644); err != nil {
		t.Fatal(err)
	}

	app := &App{}
	files, err := app.ListMarkdownFiles(root)
	if err != nil {
		t.Fatal(err)
	}
	if len(files) != 22 {
		t.Fatalf("expected 22 markdown files, got %d", len(files))
	}
	if files[0].RelPath != "index.md" {
		t.Fatalf("expected sorted first file index.md, got %q", files[0].RelPath)
	}
	for _, file := range files {
		if strings.Contains(file.RelPath, ".git") || strings.Contains(file.RelPath, "node_modules") || strings.Contains(file.RelPath, "dist") {
			t.Fatalf("ignored directory leaked into markdown list: %s", file.RelPath)
		}
	}

	indexPath := filepath.Join(root, "index.md")
	before, err := os.Stat(indexPath)
	if err != nil {
		t.Fatal(err)
	}
	indexContent, err := app.ReadMarkdownFile(indexPath)
	if err != nil {
		t.Fatal(err)
	}
	if !strings.Contains(indexContent, "[[Missing Note]]") {
		t.Fatalf("expected unresolved wiki link in index note")
	}
	after, err := os.Stat(indexPath)
	if err != nil {
		t.Fatal(err)
	}
	if !before.ModTime().Equal(after.ModTime()) {
		t.Fatalf("read/list workflow mutated index.md")
	}

	created, err := app.CreateMarkdownFile(root, "new/deep-note", "# Deep Note\n\n[[index]]")
	if err != nil {
		t.Fatal(err)
	}
	if created.RelPath != "new/deep-note.md" {
		t.Fatalf("expected extension to be appended, got %q", created.RelPath)
	}
	if err := app.WriteMarkdownFile(created.Path, "# Deep Note\n\nUpdated body\n"); err != nil {
		t.Fatal(err)
	}
	readBack, err := app.ReadMarkdownFile(created.Path)
	if err != nil {
		t.Fatal(err)
	}
	if !strings.Contains(readBack, "Updated body") {
		t.Fatalf("write/read cycle did not persist content")
	}

	renamed, err := app.RenameMarkdownFile(root, created.RelPath, "new/renamed-note.markdown")
	if err != nil {
		t.Fatal(err)
	}
	if renamed.RelPath != "new/renamed-note.markdown" {
		t.Fatalf("rename returned wrong rel path: %q", renamed.RelPath)
	}
	if _, err := os.Stat(created.Path); !os.IsNotExist(err) {
		t.Fatalf("old file still exists after rename")
	}
	if err := app.DeleteMarkdownFile(root, renamed.RelPath); err != nil {
		t.Fatal(err)
	}
	if _, err := os.Stat(renamed.Path); !os.IsNotExist(err) {
		t.Fatalf("renamed file still exists after delete")
	}

	graphJSON := `{"schema":"adomnia.markdown.graph","summary":{"notes":22,"edges":42,"unresolved":1},"nodes":[{"id":"index.md","unresolvedOutgoing":["Missing Note"]}]}`
	graphPath, err := app.WriteMarkdownAgentGraph(root, graphJSON)
	if err != nil {
		t.Fatal(err)
	}
	graphData, err := os.ReadFile(graphPath)
	if err != nil {
		t.Fatal(err)
	}
	if !strings.Contains(string(graphData), `"unresolved":1`) || !strings.Contains(filepath.ToSlash(graphPath), ".adomnia/markdown-graph.json") {
		t.Fatalf("agent graph was not written in the expected shape/path")
	}

	imported, err := app.ImportMarkdownFolderToWorkspace(root)
	if err != nil {
		t.Fatal(err)
	}
	if imported.Files != 22 {
		t.Fatalf("expected import to copy 22 markdown files, got %d", imported.Files)
	}
	if !strings.Contains(filepath.ToSlash(imported.Root), "markdown-workspaces/notes-") {
		t.Fatalf("unexpected imported root: %s", imported.Root)
	}
	importedFiles, err := app.ListMarkdownFiles(imported.Root)
	if err != nil {
		t.Fatal(err)
	}
	if len(importedFiles) != 22 {
		t.Fatalf("expected imported workspace to list 22 files, got %d", len(importedFiles))
	}
}

func twoDigit(value int) string {
	if value < 10 {
		return "0" + string(rune('0'+value))
	}
	return string(rune('0'+value/10)) + string(rune('0'+value%10))
}
