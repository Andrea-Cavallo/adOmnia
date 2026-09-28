package goide

import (
	"context"
	"os"
	"path/filepath"
	"testing"
)

func TestSearchProjectRespectsOptionsExclusionsAndCancellation(t *testing.T) {
	root := t.TempDir()
	files := map[string]string{
		"main.go":          "package main\n// Café config\nfunc main() { config() }\n",
		"vendor/lib/x.go":  "config\n",
		"docs/notes.md":    "Config here\n",
		"internal/skip.go": "config\n",
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
	service := NewService(&memoryStore{}, nil)
	session, err := service.OpenProject(root)
	if err != nil {
		t.Fatal(err)
	}
	result, err := service.SearchProject(context.Background(), SearchQuery{SessionID: session.ID, Pattern: "config", Exclude: []string{"internal/**"}})
	if err != nil {
		t.Fatal(err)
	}
	if len(result.Matches) != 3 {
		t.Fatalf("risultati inattesi: %+v", result.Matches)
	}
	// "Café " precede "config": la colonna è in unità UTF-16, come in Monaco.
	if first := result.Matches[1]; first.RelativePath != "main.go" || first.Line != 2 || first.Column != 9 {
		t.Fatalf("posizione inattesa: %+v", first)
	}
	sensitive, _ := service.SearchProject(context.Background(), SearchQuery{SessionID: session.ID, Pattern: "Config", CaseSensitive: true, Include: []string{"*.md"}})
	if len(sensitive.Matches) != 1 || sensitive.Matches[0].RelativePath != "docs/notes.md" {
		t.Fatalf("filtro include/case inatteso: %+v", sensitive.Matches)
	}
	if _, err := service.SearchProject(context.Background(), SearchQuery{SessionID: session.ID, Pattern: "(", Regex: true}); err == nil {
		t.Fatal("regex non valida accettata")
	}
	ctx, cancel := context.WithCancel(context.Background())
	cancel()
	if _, err := service.SearchProject(ctx, SearchQuery{SessionID: session.ID, Pattern: "config"}); err == nil {
		t.Fatal("ricerca annullata non interrotta")
	}
}
