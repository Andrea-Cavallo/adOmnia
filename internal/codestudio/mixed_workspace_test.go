package codestudio

import (
	"context"
	"os"
	"path/filepath"
	"runtime"
	"slices"
	"sort"
	"strings"
	"testing"

	"adomnia/internal/ide/language"
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

func TestMixedWorkspaceWithAJavaServiceKeepsItsSuggestionsInItsFolder(t *testing.T) {
	root := t.TempDir()
	wrapper := "mvnw"
	if runtime.GOOS == "windows" {
		wrapper = "mvnw.cmd"
	}
	writeFixtureFiles(t, root, map[string]string{
		"orders/go.mod":                "module example.com/orders\n\ngo 1.22\n",
		"billing/pom.xml":              `<project><parent><artifactId>spring-boot-starter-parent</artifactId></parent><artifactId>billing</artifactId></project>`,
		"billing/" + wrapper:           "",
		"billing/src/main/java/A.java": "class A {}",
	})
	registry := newLanguageRegistry()
	units, err := registry.DetectUnits(context.Background(), root)
	if err != nil {
		t.Fatal(err)
	}
	var suggestions []run.Suggestion
	languages := map[string]bool{}
	for _, unit := range units {
		languages[unit.Language+":"+unit.Kind] = true
		adapter, _ := registry.Get(unit.Language)
		if provider, ok := adapter.(run.SuggestionProvider); ok {
			suggestions = append(suggestions, provider.Suggest(context.Background(), root, unit)...)
		}
	}
	if !languages["go:module"] || !languages["java:maven"] {
		t.Fatalf("expected a Go module and a Maven unit, got %v", languages)
	}
	byDirectory := map[string][]string{}
	for _, suggestion := range finalizeSuggestions(root, suggestions, nil) {
		byDirectory[suggestion.Configuration.WorkingDirectory] = append(byDirectory[suggestion.Configuration.WorkingDirectory], suggestion.Language+"/"+suggestion.Action)
	}
	// L'invariante è la proprietà, non il conteggio: ogni unità riceve solo le proposte del
	// proprio linguaggio, nella propria cartella. Quante siano non fa parte del contratto —
	// Maven ne propone più di build (package, compile, clean install, clean), come attestato
	// da TestSuggestUsesTheWrapperAndAddsSpringBootRun in languages/java — quindi fissarle
	// qui renderebbe il test sensibile a una scelta di prodotto legittima e non al difetto
	// che questo test esiste per cogliere.
	if len(byDirectory) != 2 {
		t.Fatalf("every suggestion must land in its own unit, got %d folders: %v", len(byDirectory), byDirectory)
	}
	for _, entry := range byDirectory["billing"] {
		if !strings.HasPrefix(entry, "java/") {
			t.Errorf("billing got a non-Java suggestion: %s", entry)
		}
	}
	for _, entry := range byDirectory["orders"] {
		if !strings.HasPrefix(entry, "go/") {
			t.Errorf("orders got a non-Go suggestion: %s", entry)
		}
	}
	// La Spring Boot app deve avere run, test e build: è ciò che il nome del test promette.
	for _, wanted := range []string{"java/run", "java/test", "java/build"} {
		if !slices.Contains(byDirectory["billing"], wanted) {
			t.Errorf("billing is missing %s: %v", wanted, byDirectory["billing"])
		}
	}
	if !slices.Contains(byDirectory["orders"], "go/run") || !slices.Contains(byDirectory["orders"], "go/build") {
		t.Errorf("orders lost its Go suggestions: %v", byDirectory["orders"])
	}
	if adapter, _ := registry.Get("java"); adapter == nil {
		t.Fatal("java must be registered")
	} else if id, ok := adapter.(language.DocumentSelector).DocumentLanguageID("billing/src/main/java/A.java"); !ok || id != "java" {
		t.Fatalf("A.java must be a java document, got %q %v", id, ok)
	}
}

// A real monorepo: go.work with two modules, an npm workspaces app, a Maven service and a Python service
// Each detector must keep its own units and none may swallow the others' folders.
func TestMonorepoWithGoWorkNpmWorkspacesAndJava(t *testing.T) {
	root := t.TempDir()
	writeFixtureFiles(t, root, map[string]string{
		"go.work":                       "go 1.22\n\nuse (\n\t./orders\n\t./payments\n)\n",
		"orders/go.mod":                 "module example.com/orders\n\ngo 1.22\n",
		"payments/go.mod":               "module example.com/payments\n\ngo 1.22\n",
		"web/package.json":              `{"name":"web","workspaces":["packages/*"],"scripts":{"dev":"vite"}}`,
		"web/packages/ui/package.json":  `{"name":"ui"}`,
		"web/packages/app/package.json": `{"name":"app"}`,
		"billing/pom.xml":               "<project><modelVersion>4.0.0</modelVersion><groupId>x</groupId><artifactId>billing</artifactId><version>1</version></project>",
		"ml/pyproject.toml":             "[project]\nname = \"ml\"\n",
	})
	units, err := newLanguageRegistry().DetectUnits(context.Background(), root)
	if err != nil {
		t.Fatal(err)
	}
	languageOf := map[string]string{}
	for _, unit := range units {
		rel, _ := filepath.Rel(root, unit.Root)
		languageOf[filepath.ToSlash(rel)] = unit.Language
	}
	for directory, language := range map[string]string{"orders": "go", "payments": "go", "web": "typescript", "web/packages/ui": "typescript", "web/packages/app": "typescript", "billing": "java"} {
		if languageOf[directory] != language {
			t.Errorf("%s: want a %s unit, got %q (all: %v)", directory, language, languageOf[directory], languageOf)
		}
	}
	if languageOf["ml"] != "python" {
		t.Errorf("ml must be a Python unit, got %q", languageOf["ml"])
	}
	// go.work is the Go workspace unit of the root, not a module: it must not shadow the other languages' units.
	for _, unit := range units {
		if unit.Root == root && unit.Kind != "workspace" {
			t.Errorf("the root unit must be the go.work workspace, got %s/%s", unit.Language, unit.Kind)
		}
	}
}
