package web

import (
	"context"
	"os"
	"path/filepath"
	"testing"

	"adomnia/internal/ide/project"
	"adomnia/internal/ide/run"
)

func suggestFixture(t *testing.T, files map[string]string) []run.Suggestion {
	t.Helper()
	root := t.TempDir()
	for name, content := range files {
		if err := os.WriteFile(filepath.Join(root, name), []byte(content), 0o644); err != nil {
			t.Fatal(err)
		}
	}
	var adapter run.SuggestionProvider = scriptAdapter{adapter{kinds[0]}}
	return adapter.Suggest(context.Background(), root, project.Unit{Language: ScriptID, Kind: UnitNode, Root: root})
}

func TestSuggestUsesRealPackageManagerAndExistingScripts(t *testing.T) {
	got := suggestFixture(t, map[string]string{
		"package.json":   `{"name":"app","scripts":{"dev":"vite","build":"vite build"},"devDependencies":{"vite":"5.0.0"}}`,
		"pnpm-lock.yaml": "lockfileVersion: 9",
	})
	if len(got) != 2 {
		t.Fatalf("want dev+build (no test script), got %+v", got)
	}
	run := got[0]
	if run.Action != "run" || run.Title != "Vite · pnpm run dev" || run.Configuration.Target != "pnpm" || len(run.Configuration.ProgramArguments) != 2 || run.Configuration.Kind != "command" {
		t.Fatalf("unexpected dev suggestion: %+v", run)
	}
	if got[1].Action != "build" {
		t.Fatalf("second must be build: %+v", got[1])
	}
}

func TestSuggestNothingWithoutManifestScripts(t *testing.T) {
	if got := suggestFixture(t, map[string]string{"package.json": `{"name":"lib"}`}); len(got) != 0 {
		t.Fatalf("no scripts means no suggestions: %+v", got)
	}
	if got := suggestFixture(t, map[string]string{"index.html": "<html>"}); len(got) != 0 {
		t.Fatalf("static site is served by Live Preview: %+v", got)
	}
}
