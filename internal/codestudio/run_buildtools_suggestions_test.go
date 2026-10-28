package codestudio

import (
	"errors"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func haveTool(string) (string, error)    { return "/usr/bin/tool", nil }
func missingTool(string) (string, error) { return "", errors.New("not found") }

// Un Makefile diventa una proposta per ogni regola; ricette, variabili, target speciali e pattern
// rule non sono target eseguibili (P2-B, flusso Detected).
func TestMakeSuggestionsProposeRules(t *testing.T) {
	root := t.TempDir()
	content := strings.Join([]string{
		"# build",
		"VERSION = 1.0",
		".PHONY: build test",
		"build: ## compile",
		"\tgo build ./...",
		"test: build",
		"\tgo test ./...",
		"%.o: %.c",
		"\tcc -c $<",
		"all: build test",
		"",
	}, "\n")
	writeFile(t, filepath.Join(root, "Makefile"), content)
	suggestions := makeSuggestions(root, haveTool)
	titles := make([]string, 0, len(suggestions))
	for _, suggestion := range suggestions {
		titles = append(titles, suggestion.Title)
	}
	want := []string{"Makefile · build", "Makefile · test", "Makefile · all"}
	if strings.Join(titles, "|") != strings.Join(want, "|") {
		t.Fatalf("titles = %v, want %v", titles, want)
	}
	config := suggestions[0].Configuration
	if config.Kind != "make" || config.Target != "Makefile" || strings.Join(config.ProgramArguments, " ") != "build" {
		t.Fatalf("configuration = %+v", config)
	}
	draft := RunConfiguration{Kind: RunConfigurationKind(config.Kind), Target: config.Target, ProgramArguments: config.ProgramArguments}
	if _, err := normalizeToolConfiguration(draft); err != nil {
		t.Fatalf("the proposal is not a valid make configuration: %v", err)
	}
}

// Senza make installato non si propone nulla: la card non deve promettere un avvio impossibile.
func TestMakeSuggestionsRequireTheTool(t *testing.T) {
	root := t.TempDir()
	writeFile(t, filepath.Join(root, "Makefile"), "build:\n\ttrue\n")
	if got := makeSuggestions(root, missingTool); len(got) != 0 {
		t.Fatalf("suggestions without make = %+v", got)
	}
	if err := os.WriteFile(filepath.Join(root, "Makefile"), []byte(""), 0o600); err != nil {
		t.Fatal(err)
	}
	if got := makeSuggestions(root, haveTool); len(got) != 0 {
		t.Fatalf("an empty Makefile has no runnable targets: %+v", got)
	}
}

// Un file compose diventa una proposta per ogni servizio, con `compose -f <file> up <servizio>`.
func TestComposeSuggestionsProposeServices(t *testing.T) {
	root := t.TempDir()
	writeFile(t, filepath.Join(root, "compose.yaml"), strings.Join([]string{
		"services:",
		"  web:",
		"    image: node:24",
		"  db:",
		"    image: postgres:17",
		"  bad name:",
		"    image: broken:1",
		"",
	}, "\n"))
	suggestions := composeSuggestions(root, haveTool)
	if len(suggestions) != 2 {
		t.Fatalf("suggestions = %+v", suggestions)
	}
	// Ordine alfabetico: stabile fra due scan.
	if !strings.HasSuffix(suggestions[0].Title, "db") || !strings.HasSuffix(suggestions[1].Title, "web") {
		t.Fatalf("titles = %q, %q", suggestions[0].Title, suggestions[1].Title)
	}
	config := suggestions[1].Configuration
	if config.Kind != "docker-compose" || config.Target != "compose.yaml" || strings.Join(config.ProgramArguments, " ") != "up web" {
		t.Fatalf("configuration = %+v", config)
	}
	draft := RunConfiguration{Kind: RunConfigurationKind(config.Kind), Target: config.Target, ProgramArguments: config.ProgramArguments}
	if _, err := normalizeToolConfiguration(draft); err != nil {
		t.Fatalf("the proposal is not a valid compose configuration: %v", err)
	}
}

// Un YAML rotto o senza `services` non produce proposte, e il nome con uno spazio non passa la
// regola del runner.
func TestComposeSuggestionsIgnoreBrokenFiles(t *testing.T) {
	root := t.TempDir()
	writeFile(t, filepath.Join(root, "docker-compose.yml"), "services: [unclosed\n")
	if got := composeSuggestions(root, haveTool); len(got) != 0 {
		t.Fatalf("a broken compose file must not be proposed: %+v", got)
	}
	if got := composeServices([]byte("services:\n  bad name:\n    image: x\n")); len(got) != 0 {
		t.Fatalf("an invalid service name must be filtered: %v", got)
	}
	if got := composeServices([]byte("version: '3'\n")); len(got) != 0 {
		t.Fatalf("a file without services has no proposals: %v", got)
	}
}

// Le due famiglie convivono e non si pestano gli ID.
func TestBuildToolSuggestionsCombineMakeAndCompose(t *testing.T) {
	root := t.TempDir()
	writeFile(t, filepath.Join(root, "Makefile"), "build:\n\ttrue\n")
	writeFile(t, filepath.Join(root, "compose.yaml"), "services:\n  web:\n    image: node:24\n")
	suggestions := buildToolSuggestions(root, haveTool)
	if len(suggestions) != 2 || suggestions[0].ID != "make|build" || suggestions[1].ID != "compose|compose.yaml|web" {
		t.Fatalf("suggestions = %+v", suggestions)
	}
}
