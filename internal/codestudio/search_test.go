package codestudio

import (
	"context"
	"fmt"
	"os"
	"path/filepath"
	"strings"
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

func TestSearchProjectStopsAtResultCapInFileOrder(t *testing.T) {
	root := t.TempDir()
	for i := range 40 {
		content := strings.Repeat("hit\n", 100)
		if err := os.WriteFile(filepath.Join(root, fmt.Sprintf("f%02d.txt", i)), []byte(content), 0o644); err != nil {
			t.Fatal(err)
		}
	}
	service := NewService(&memoryStore{}, nil)
	session, err := service.OpenProject(root)
	if err != nil {
		t.Fatal(err)
	}
	result, err := service.SearchProject(context.Background(), SearchQuery{SessionID: session.ID, Pattern: "hit"})
	if err != nil {
		t.Fatal(err)
	}
	if len(result.Matches) != maxSearchResults || !result.Truncated {
		t.Fatalf("tetto non applicato: %d risultati, truncated=%v", len(result.Matches), result.Truncated)
	}
	if first, last := result.Matches[0], result.Matches[len(result.Matches)-1]; first.RelativePath != "f00.txt" || last.RelativePath != "f19.txt" {
		t.Fatalf("ordine dei file alterato: %s … %s", first.RelativePath, last.RelativePath)
	}
}

func TestSearchProjectHonoursRootGitignore(t *testing.T) {
	root := t.TempDir()
	files := map[string]string{
		".gitignore":       "*.gen.go\n/out/\n",
		"a.go":             "token\n",
		"b.gen.go":         "token\n",
		"out/c.go":         "token\n",
		"__pycache__/d.py": "token\n",
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
	result, err := service.SearchProject(context.Background(), SearchQuery{SessionID: session.ID, Pattern: "token"})
	if err != nil {
		t.Fatal(err)
	}
	if len(result.Matches) != 1 || result.Matches[0].RelativePath != "a.go" {
		t.Fatalf("attesi solo i file non ignorati: %+v", result.Matches)
	}
}
