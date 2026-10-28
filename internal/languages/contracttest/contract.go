// Package contracttest verifica il contratto condiviso che ogni language adapter deve rispettare
// (MULTILANGUAGE-IDE 10.2): identità stabile, selettore dei documenti, rilevamento delle unità,
// suggerimenti eseguibili e schema dei campi. Una suite parametrica sola, invece di prove scritte
// a mano per linguaggio: un adapter nuovo si aggiunge qui con una riga.
package contracttest

import (
	"context"
	"os"
	"path/filepath"
	"regexp"
	"strings"
	"testing"

	"github.com/Andrea-Cavallo/adOmnia/internal/ide/language"
	"github.com/Andrea-Cavallo/adOmnia/internal/ide/project"
	"github.com/Andrea-Cavallo/adOmnia/internal/ide/run"
)

// Case è la fixture minima di un linguaggio. Detectable dice se l'adapter rileva unità (HTML, CSS
// e JSON sono solo editor: non hanno un progetto proprio).
type Case struct {
	Name string
	// Language è l'adapter in prova.
	Language language.Language
	// Files sono i file della fixture, relativi alla radice temporanea.
	Files map[string]string
	// UnitRoot è la cartella dell'unità attesa, relativa alla radice ("." per la radice).
	UnitRoot string
	// Document è un file che l'adapter deve riconoscere con EditorLanguage.
	Document       string
	EditorLanguage string
	Detectable     bool
	// WantSuggestions esige almeno una proposta per l'unità rilevata.
	WantSuggestions bool
}

var stableID = regexp.MustCompile(`^[a-z][a-z0-9-]*$`)

// Run esegue il contratto su tutte le fixture. Non avvia processi né scarica strumenti.
func Run(t *testing.T, cases []Case) {
	t.Helper()
	seen := map[string]bool{}
	for _, test := range cases {
		t.Run(test.Name, func(t *testing.T) {
			id := test.Language.ID()
			if !stableID.MatchString(id) {
				t.Fatalf("the language id %q is not a stable lowercase id", id)
			}
			if seen[id] {
				t.Fatalf("the language id %q is used by two adapters", id)
			}
			seen[id] = true
			if strings.TrimSpace(test.Language.Name()) == "" {
				t.Fatalf("%s has no display name", id)
			}
			selector, ok := test.Language.(language.DocumentSelector)
			if !ok {
				t.Fatalf("%s has no document selector", id)
			}
			if editor, ok := selector.DocumentLanguageID(test.Document); !ok || editor != test.EditorLanguage {
				t.Fatalf("%s maps %q to %q (%v), want %q", id, test.Document, editor, ok, test.EditorLanguage)
			}
			if _, ok := selector.DocumentLanguageID("README.unknown"); ok {
				t.Fatalf("%s claims an unrelated file", id)
			}
			if !test.Detectable {
				return
			}
			runDetection(t, test)
		})
	}
}

func runDetection(t *testing.T, test Case) {
	t.Helper()
	root := t.TempDir()
	for name, content := range test.Files {
		path := filepath.Join(root, filepath.FromSlash(name))
		if err := os.MkdirAll(filepath.Dir(path), 0o755); err != nil {
			t.Fatal(err)
		}
		if err := os.WriteFile(path, []byte(content), 0o644); err != nil {
			t.Fatal(err)
		}
	}
	detector, ok := test.Language.(language.ProjectDetector)
	if !ok {
		t.Fatalf("%s is marked detectable but has no project detector", test.Language.ID())
	}
	units, err := detector.DetectUnits(context.Background(), root)
	if err != nil {
		t.Fatalf("detect: %v", err)
	}
	var unit *project.Unit
	for index := range units {
		candidate := units[index]
		if candidate.Language != test.Language.ID() {
			t.Fatalf("%s produced a unit of language %q", test.Language.ID(), candidate.Language)
		}
		relative := relativePath(root, candidate.Root)
		if relative == test.UnitRoot && unit == nil {
			unit = &units[index]
		}
		if candidate.Manifest != "" && !inside(root, candidate.Manifest) {
			t.Fatalf("the manifest %q is outside the project", candidate.Manifest)
		}
	}
	if unit == nil {
		t.Fatalf("no unit in %q; units: %+v", test.UnitRoot, units)
	}
	if provider, ok := test.Language.(run.SuggestionProvider); ok {
		suggestions := provider.Suggest(context.Background(), root, *unit)
		if test.WantSuggestions && len(suggestions) == 0 {
			t.Fatalf("no suggestions for the detected unit")
		}
		for _, suggestion := range suggestions {
			if suggestion.ID == "" || suggestion.Title == "" || suggestion.Language != test.Language.ID() {
				t.Fatalf("incomplete suggestion: %+v", suggestion)
			}
			switch suggestion.Action {
			case "run", "test", "build":
			default:
				t.Fatalf("unknown suggestion action %q", suggestion.Action)
			}
			if validator, ok := test.Language.(run.ConfigValidator); ok {
				if err := validator.ValidateRunConfiguration(suggestion.Configuration); err != nil {
					t.Fatalf("the suggestion %q is not valid: %v", suggestion.Title, err)
				}
			}
		}
	}
	if provider, ok := test.Language.(run.SchemaProvider); ok {
		runner, hasRunner := test.Language.(run.Runner)
		if !hasRunner {
			t.Fatalf("%s offers a run schema but no runner", test.Language.ID())
		}
		// Un kind può non avere campi propri (es. i tool Go già descritti dai campi comuni); lo
		// schema però deve appartenere al linguaggio e al kind richiesto.
		withFields := 0
		for _, kind := range runner.RunKinds() {
			schema := provider.RunSchema(kind)
			if schema.Language != test.Language.ID() || schema.Kind != kind {
				t.Fatalf("schema for %q is incomplete: %+v", kind, schema)
			}
			if len(schema.Fields) > 0 {
				withFields++
			}
		}
		if withFields == 0 {
			t.Fatalf("%s describes no field for any of its kinds", test.Language.ID())
		}
	}
}

// relativePath è la cartella relativa al progetto, in forma slash ("." per la radice).
func relativePath(root, directory string) string {
	relative, err := filepath.Rel(root, directory)
	if err != nil {
		return ""
	}
	relative = filepath.ToSlash(relative)
	if relative == "" {
		return "."
	}
	return relative
}

func inside(root, candidate string) bool {
	relative, err := filepath.Rel(root, candidate)
	return err == nil && relative != ".." && !strings.HasPrefix(relative, ".."+string(filepath.Separator))
}
