package codestudio

import (
	"context"
	"os"
	"path/filepath"
	"sort"
	"testing"

	"adomnia/internal/ide/run"
)

// writeFixtureFiles creates a minimal monorepo fixture: path → content.
func writeFixtureFiles(t *testing.T, root string, files map[string]string) {
	t.Helper()
	for name, content := range files {
		path := filepath.Join(root, filepath.FromSlash(name))
		if err := os.MkdirAll(filepath.Dir(path), 0o755); err != nil {
			t.Fatal(err)
		}
		if err := os.WriteFile(path, []byte(content), 0o644); err != nil {
			t.Fatal(err)
		}
	}
}

func TestMixedWorkspaceYieldsOneUnitPerModuleAndLanguage(t *testing.T) {
	root := t.TempDir()
	writeFixtureFiles(t, root, map[string]string{
		"orders/go.mod":                "module example.com/orders\n\ngo 1.22\n",
		"orders/main.go":               "package main\nfunc main() {}\n",
		"payments/go.mod":              "module example.com/payments\n\ngo 1.22\n",
		"web/package.json":             `{"name":"web","scripts":{"dev":"vite"}}`,
		"web/packages/ui/package.json": `{"name":"ui"}`,
	})
	units, err := newLanguageRegistry().DetectUnits(context.Background(), root)
	if err != nil {
		t.Fatal(err)
	}
	got := []string{}
	for _, unit := range units {
		rel, _ := filepath.Rel(root, unit.Root)
		got = append(got, unit.Language+":"+unit.Kind+":"+filepath.ToSlash(rel))
	}
	sort.Strings(got)
	want := []string{"go:module:orders", "go:module:payments", "typescript:node:web", "typescript:node:web/packages/ui"}
	for _, expected := range want {
		found := false
		for _, unit := range got {
			found = found || unit == expected
		}
		if !found {
			t.Errorf("missing unit %s in %v", expected, got)
		}
	}
}

func TestMixedWorkspaceSuggestionsStayInTheirOwnUnit(t *testing.T) {
	root := t.TempDir()
	writeFixtureFiles(t, root, map[string]string{
		"orders/go.mod":    "module example.com/orders\n\ngo 1.22\n",
		"web/package.json": `{"name":"web","scripts":{"dev":"vite","build":"vite build"}}`,
	})
	registry := newLanguageRegistry()
	units, err := registry.DetectUnits(context.Background(), root)
	if err != nil {
		t.Fatal(err)
	}
	var suggestions []run.Suggestion
	for _, unit := range units {
		adapter, _ := registry.Get(unit.Language)
		if provider, ok := adapter.(run.SuggestionProvider); ok {
			suggestions = append(suggestions, provider.Suggest(context.Background(), root, unit)...)
		}
	}
	byDirectory := map[string][]string{}
	for _, suggestion := range finalizeSuggestions(root, suggestions, nil) {
		directory := suggestion.Configuration.WorkingDirectory
		byDirectory[directory] = append(byDirectory[directory], suggestion.Language+"/"+suggestion.Action)
	}
	if len(byDirectory["orders"]) != 3 || len(byDirectory["web"]) != 2 || len(byDirectory) != 2 {
		t.Fatalf("each unit must only get its own language suggestions: %v", byDirectory)
	}
	for _, entry := range byDirectory["orders"] {
		if entry[:3] != "go/" {
			t.Errorf("orders got a non-Go suggestion: %s", entry)
		}
	}
}
