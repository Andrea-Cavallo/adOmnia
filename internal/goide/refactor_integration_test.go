package goide

import (
	"context"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"testing"
)

// copyTree copia il progetto in una cartella nuova, per compilare ogni refactoring in isolamento.
func copyTree(t *testing.T, source string) string {
	t.Helper()
	target := t.TempDir()
	err := filepath.WalkDir(source, func(path string, entry os.DirEntry, err error) error {
		if err != nil {
			return err
		}
		relative, _ := filepath.Rel(source, path)
		if entry.IsDir() {
			return os.MkdirAll(filepath.Join(target, relative), 0o755)
		}
		data, err := os.ReadFile(path)
		if err != nil {
			return err
		}
		return os.WriteFile(filepath.Join(target, relative), data, 0o644)
	})
	if err != nil {
		t.Fatal(err)
	}
	return target
}

func TestRefactoringsWithRealGoplsProduceCompilableCode(t *testing.T) {
	gopls := findGoplsForTest(t)
	root := copyFixture(t, "refactor")
	recorder := &eventRecorder{}
	service := NewService(&memoryStore{}, recorder.record)
	t.Cleanup(service.Shutdown)
	session := startLanguageServerForTest(t, service, recorder, root, gopls)
	sessionID := string(session.ID)
	document, err := service.OpenDocument(sessionID, "main.go")
	if err != nil {
		t.Fatal(err)
	}
	selection := func(needle string) EditorRange {
		line, column := positionOf(t, document.Content, needle, 0)
		return EditorRange{StartLine: line, StartColumn: column, EndLine: line, EndColumn: column + len(needle)}
	}
	lines := func(first, last string) EditorRange {
		start, _ := positionOf(t, document.Content, first, 0)
		end, _ := positionOf(t, document.Content, last, 0)
		width := len(strings.Split(document.Content, "\n")[end-1])
		return EditorRange{StartLine: start, StartColumn: 1, EndLine: end, EndColumn: width + 1}
	}
	caret := func(needle string, offset int) EditorRange {
		line, column := positionOf(t, document.Content, needle, offset)
		return EditorRange{StartLine: line, StartColumn: column, EndLine: line, EndColumn: column}
	}
	cases := []struct {
		name, kind, only, expect string
		selection                EditorRange
	}{
		{"extract variable", "refactor.extract.variable", "refactor.extract", ":= rect.Width * rect.Height", selection("rect.Width * rect.Height")},
		{"extract function across packages", "refactor.extract.function", "refactor.extract", "func newFunction(", lines("label := fmt.Sprintf", "label += fmt.Sprintf")},
		{"inline call from another package", "refactor.inline.call", "refactor.inline", "* 2", caret("Double(", 1)},
		{"inline variable", "refactor.inline.variable", "refactor.inline", `"area %d", rect.Width * rect.Height`, caret("area)", 0)},
		{"move declarations to a new file", "refactor.extract.toNewFile", "refactor.extract", "", lines("func report(", "}\n\nfunc main")},
	}
	for _, testCase := range cases {
		t.Run(testCase.name, func(t *testing.T) {
			actions, err := service.CodeActions(context.Background(), sessionID, string(document.Document.ID), testCase.selection, []string{testCase.only})
			if err != nil {
				t.Fatal(err)
			}
			var chosen *CodeActionEntry
			for index := range actions {
				if actions[index].Kind == testCase.kind {
					chosen = &actions[index]
				}
			}
			if chosen == nil {
				t.Fatalf("gopls non offre %s: %+v", testCase.kind, actions)
			}
			change, err := service.ResolveCodeAction(context.Background(), sessionID, chosen.ID)
			if err != nil {
				t.Fatal(err)
			}
			if len(change.Files) == 0 {
				t.Fatal("nessuna modifica prodotta")
			}
			tree := copyTree(t, root)
			combined := ""
			for _, file := range change.Files {
				if file.RelativePath == "" {
					t.Fatalf("file fuori dal progetto nella modifica: %+v", file)
				}
				path := filepath.Join(tree, filepath.FromSlash(file.RelativePath))
				if err := os.MkdirAll(filepath.Dir(path), 0o755); err != nil {
					t.Fatal(err)
				}
				if err := os.WriteFile(path, []byte(file.NewContent), 0o644); err != nil {
					t.Fatal(err)
				}
				combined += file.NewContent
			}
			if testCase.kind == "refactor.extract.toNewFile" && !hasCreatedFile(change) {
				t.Fatalf("lo spostamento deve creare un file nuovo: %+v", change.Files)
			}
			if testCase.expect != "" && !strings.Contains(combined, testCase.expect) {
				t.Fatalf("risultato inatteso, manca %q:\n%s", testCase.expect, combined)
			}
			build := exec.Command("go", "build", "./...")
			build.Dir = tree
			if output, err := build.CombinedOutput(); err != nil {
				t.Fatalf("il codice dopo %s non compila: %v\n%s\n%s", testCase.name, err, output, combined)
			}
		})
	}
}

func hasCreatedFile(change WorkspaceChange) bool {
	for _, file := range change.Files {
		if file.Created {
			return true
		}
	}
	return false
}

func TestChangeSignatureWithRealGoplsRewritesCallers(t *testing.T) {
	gopls := findGoplsForTest(t)
	root := copyFixture(t, "refactor")
	recorder := &eventRecorder{}
	service := NewService(&memoryStore{}, recorder.record)
	t.Cleanup(service.Shutdown)
	session := startLanguageServerForTest(t, service, recorder, root, gopls)
	sessionID := string(session.ID)
	document, err := service.OpenDocument(sessionID, "geo/geo.go")
	if err != nil {
		t.Fatal(err)
	}
	line, column := positionOf(t, document.Content, "Scale(", 0)
	caret := EditorRange{StartLine: line, StartColumn: column, EndLine: line, EndColumn: column}
	// Parametri invertiti, risultato invariato.
	change, err := service.ChangeSignature(context.Background(), sessionID, string(document.Document.ID), caret, []int{1, 0}, []int{0})
	if err != nil {
		t.Fatal(err)
	}
	if _, err := service.ChangeSignature(context.Background(), sessionID, string(document.Document.ID), caret, []int{-1}, nil); err == nil {
		t.Fatal("un indice negativo va rifiutato")
	}
	tree := copyTree(t, root)
	combined := ""
	for _, file := range change.Files {
		if err := os.WriteFile(filepath.Join(tree, filepath.FromSlash(file.RelativePath)), []byte(file.NewContent), 0o644); err != nil {
			t.Fatal(err)
		}
		combined += file.NewContent
	}
	if !strings.Contains(combined, "func Scale(factor, value int) int") && !strings.Contains(combined, "func Scale(factor int, value int) int") || !strings.Contains(combined, "geo.Scale(3, 2)") {
		t.Fatalf("firma o chiamante non riscritti (%d file):\n%s", len(change.Files), combined)
	}
	build := exec.Command("go", "build", "./...")
	build.Dir = tree
	if output, err := build.CombinedOutput(); err != nil {
		t.Fatalf("il codice dopo Change Signature non compila: %v\n%s\n%s", err, output, combined)
	}
}
