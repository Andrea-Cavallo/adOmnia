package web

import (
	"context"
	"os"
	"path/filepath"
	"testing"

	"github.com/Andrea-Cavallo/adOmnia/internal/ide/project"
	"github.com/Andrea-Cavallo/adOmnia/internal/ide/run"
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

func suggestionTitles(got []run.Suggestion) []string {
	titles := make([]string, 0, len(got))
	for _, suggestion := range got {
		titles = append(titles, suggestion.Title)
	}
	return titles
}

func TestSuggestNestUsesWatchScriptAndProductionStart(t *testing.T) {
	got := suggestFixture(t, map[string]string{
		"package.json": `{"name":"api","scripts":{"build":"nest build","start":"nest start","start:dev":"nest start --watch","start:prod":"node dist/main"},"dependencies":{"@nestjs/core":"10.0.0"},"devDependencies":{"@nestjs/cli":"10.0.0"}}`,
	})
	want := []string{"Nest · npm run start:dev", "Nest · npm run build", "Nest · npm run start:prod"}
	if titles := suggestionTitles(got); len(titles) != len(want) || titles[0] != want[0] || titles[1] != want[1] || titles[2] != want[2] {
		t.Fatalf("suggestions = %v, want %v", titles, want)
	}
	if got[0].ID == got[2].ID {
		t.Fatalf("the production start needs its own id: %q", got[0].ID)
	}
}

func TestSuggestNextAddsProductionStartOnlyWhenItIsNotTheDevScript(t *testing.T) {
	got := suggestFixture(t, map[string]string{
		"package.json": `{"name":"site","scripts":{"dev":"next dev","build":"next build","start":"next start"},"dependencies":{"next":"14.0.0","react":"18.0.0"}}`,
	})
	if titles := suggestionTitles(got); len(titles) != 3 || titles[2] != "Next · npm run start" {
		t.Fatalf("suggestions = %v", titles)
	}
	// Con il solo `start` (lo script dev), non si propone due volte lo stesso comando.
	only := suggestFixture(t, map[string]string{
		"package.json": `{"name":"site","scripts":{"start":"next dev"},"dependencies":{"next":"14.0.0"}}`,
	})
	if len(only) != 1 {
		t.Fatalf("a single start script must give one suggestion, got %v", suggestionTitles(only))
	}
}
