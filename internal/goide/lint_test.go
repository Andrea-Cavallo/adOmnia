package goide

import (
	"context"
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"testing"
)

func TestParseLintOutputsAndConvertColumnsToUTF16(t *testing.T) {
	root := t.TempDir()
	path := filepath.Join(root, "main.go")
	if err := os.WriteFile(path, []byte("package main\nvar é, x = 1, 2\n"), 0o644); err != nil {
		t.Fatal(err)
	}
	golangci := []byte(`noise before {"Issues":[{"FromLinter":"unused","Text":"var x is unused","Severity":"","Pos":{"Filename":"main.go","Line":2,"Column":8}}]}`)
	issues, err := parseLintOutput(LinterGolangci, root, golangci)
	if err != nil || len(issues) != 1 || issues[0].path != path || issues[0].source != "golangci-lint · unused" {
		t.Fatalf("golangci inatteso: %v %+v", err, issues)
	}
	staticcheck := []byte(`{"code":"U1000","severity":"error","location":{"file":"` + filepath.ToSlash(path) + `","line":2,"column":8},"message":"var x is unused"}` + "\n")
	fromStaticcheck, err := parseLintOutput(LinterStaticcheck, root, staticcheck)
	if err != nil || len(fromStaticcheck) != 1 || fromStaticcheck[0].severity != 1 || fromStaticcheck[0].code != "U1000" {
		t.Fatalf("staticcheck inatteso: %v %+v", err, fromStaticcheck)
	}
	session := Session{ID: "s", Project: Project{RealPath: root}}
	reports := lintReports(session, issues)
	// "var é, " occupa 8 byte ma 7 unità UTF-16: x è alla colonna Monaco 7.
	if len(reports) != 1 || reports[0].Diagnostics[0].Range.StartColumn != 7 || reports[0].RelativePath != "main.go" {
		t.Fatalf("report inatteso: %+v", reports)
	}
	if lintSeverity("") != 2 {
		t.Fatal("i problemi di lint senza severità devono essere warning")
	}
}

func linterForTest(t *testing.T, name string) string {
	t.Helper()
	if found, err := exec.LookPath(name); err == nil {
		return found
	}
	if home, err := os.UserHomeDir(); err == nil {
		candidate := filepath.Join(home, "go", "bin", executableName(name))
		if _, err := os.Stat(candidate); err == nil {
			return candidate
		}
	}
	t.Skipf("%s non installato", name)
	return ""
}

func TestRunLintWithRealLinters(t *testing.T) {
	for _, kind := range []string{LinterStaticcheck, LinterGolangci} {
		t.Run(kind, func(t *testing.T) {
			binary := linterForTest(t, kind)
			service := NewService(&memoryStore{}, nil)
			root := copyFixture(t, "lintissues")
			session, err := service.OpenProject(root)
			if err != nil {
				t.Fatal(err)
			}
			if _, err := service.RunLint(context.Background(), string(session.ID)); err == nil {
				t.Fatal("linter eseguito senza autorizzazione")
			}
			if _, err := service.SetToolAuthorization(string(session.ID), true); err != nil {
				t.Fatal(err)
			}
			service.DetectToolchain(string(session.ID))
			if err := service.ConfigureLinter(string(session.ID), binary); err != nil {
				t.Fatal(err)
			}
			info, _ := service.DetectLinter(string(session.ID))
			if !info.Available || info.Kind != kind || info.ConfigPath != "" {
				t.Fatalf("rilevamento inatteso: %+v", info)
			}
			result, err := service.RunLint(context.Background(), string(session.ID))
			if err != nil {
				t.Fatal(err)
			}
			if result.IssueCount == 0 || len(result.Reports) != 1 || result.Reports[0].RelativePath != "main.go" {
				t.Fatalf("problemi noti non trovati: %+v", result)
			}
			found := false
			for _, diagnostic := range result.Reports[0].Diagnostics {
				found = found || strings.Contains(diagnostic.Message, "unused")
			}
			if !found {
				t.Fatalf("funzione inutilizzata non segnalata: %+v", result.Reports[0].Diagnostics)
			}
			if _, err := os.Stat(filepath.Join(root, ".golangci.yml")); err == nil {
				t.Fatal("il linter non deve creare configurazioni implicite")
			}
			ctx, cancel := context.WithCancel(context.Background())
			cancel()
			if _, err := service.RunLint(ctx, string(session.ID)); err == nil {
				t.Fatal("lint annullato non interrotto")
			}
		})
	}
}

func TestLinterConfigIsDetectedNeverCreated(t *testing.T) {
	root := t.TempDir()
	if linterConfig(root, LinterGolangci) != "" {
		t.Fatal("configurazione inesistente rilevata")
	}
	path := filepath.Join(root, ".golangci.yaml")
	if err := os.WriteFile(path, []byte("version: \"2\"\n"), 0o644); err != nil {
		t.Fatal(err)
	}
	if linterConfig(root, LinterGolangci) != path || linterConfig(root, LinterStaticcheck) != "" {
		t.Fatal("configurazione di progetto non rilevata correttamente")
	}
}

func TestGolangciFixesBecomeEditorEditsWithUTF16Columns(t *testing.T) {
	root := t.TempDir()
	text := "package main\n\nimport \"fmt\"\n\nfunc main() {\n\ts := \"è\" + fmt.Sprintf(\"hello\")\n\tfmt.Println(s)\n}\n"
	if err := os.WriteFile(filepath.Join(root, "main.go"), []byte(text), 0o644); err != nil {
		t.Fatal(err)
	}
	start := strings.Index(text, "fmt.Sprintf")
	end := start + len(`fmt.Sprintf("hello")`)
	output := fmt.Sprintf(`{"Issues":[{"FromLinter":"staticcheck","Text":"S1039: unnecessary use of fmt.Sprintf","Severity":"","Pos":{"Filename":"main.go","Line":6,"Column":%d},`+
		`"SuggestedFixes":[{"Message":"Replace with string literal","TextEdits":[{"Pos":%d,"End":%d,"NewText":"ImhlbGxvIg=="}]}]},`+
		`{"FromLinter":"errcheck","Text":"broken fix","Pos":{"Filename":"main.go","Line":7,"Column":2},"SuggestedFixes":[{"Message":"bad","TextEdits":[{"Pos":0,"End":99999,"NewText":null}]}]}]}`,
		start-strings.LastIndex(text[:start], "\n"), start, end)
	issues, err := parseGolangci(root, []byte(output))
	if err != nil {
		t.Fatal(err)
	}
	session := Session{ID: "s", Project: Project{RealPath: root}}
	reports := lintReports(session, issues)
	if len(reports) != 1 || len(reports[0].Diagnostics) != 2 {
		t.Fatalf("report inattesi: %+v", reports)
	}
	fixed := reports[0].Diagnostics[0]
	if fixed.Suppression != "//nolint:staticcheck" || len(fixed.Fixes) != 1 {
		t.Fatalf("fix o soppressione mancanti: %+v", fixed)
	}
	edit := fixed.Fixes[0].Edits[0]
	// "\ts := \"è\" + " occupa 12 unità UTF-16 (è = 1), anche se in byte sono 13.
	if edit.Text != `"hello"` || edit.Range.StartLine != 6 || edit.Range.StartColumn != 13 || edit.Range.EndColumn != 13+len(`fmt.Sprintf("hello")`) {
		t.Fatalf("edit inatteso: %+v", edit)
	}
	if len(reports[0].Diagnostics[1].Fixes) != 0 || reports[0].Diagnostics[1].Suppression != "//nolint:errcheck" {
		t.Fatalf("una correzione fuori dal testo deve essere scartata: %+v", reports[0].Diagnostics[1])
	}
}

func TestRunLintChangedLintsOnlyModifiedGoFiles(t *testing.T) {
	if _, err := exec.LookPath("git"); err != nil {
		t.Skip("git non disponibile")
	}
	binary := linterForTest(t, LinterStaticcheck)
	repo := t.TempDir()
	writeFixtureFile(t, repo, "go.mod", "module example.com/lintchanged\n\ngo 1.22\n")
	writeFixtureFile(t, repo, "main.go", "package main\n\nfunc unusedMain() {}\n\nfunc main() {}\n")
	writeFixtureFile(t, repo, "pkg/other/other.go", "package other\n\nfunc unusedOther() {}\n")
	gitCommand(t, repo, "init", "-q", "-b", "main")
	gitCommand(t, repo, "add", ".")
	gitCommand(t, repo, "commit", "-q", "-m", "initial")

	service := NewService(&memoryStore{}, nil)
	t.Cleanup(service.Shutdown)
	session, err := service.OpenProject(repo)
	if err != nil {
		t.Fatal(err)
	}
	id := string(session.ID)
	if _, err := service.SetToolAuthorization(id, true); err != nil {
		t.Fatal(err)
	}
	service.DetectToolchain(id)
	if err := service.ConfigureLinter(id, binary); err != nil {
		t.Fatal(err)
	}
	clean, err := service.RunLintChanged(context.Background(), id)
	if err != nil || !clean.ChangedOnly || clean.IssueCount != 0 {
		t.Fatalf("senza modifiche non va segnalato nulla: %+v %v", clean, err)
	}
	writeFixtureFile(t, repo, "pkg/other/other.go", "package other\n\nfunc unusedOther() {}\n\nfunc alsoUnused() {}\n")
	result, err := service.RunLintChanged(context.Background(), id)
	if err != nil {
		t.Fatal(err)
	}
	if result.ChangedFiles != 1 || len(result.Reports) != 1 || result.Reports[0].RelativePath != "pkg/other/other.go" || result.IssueCount != 2 {
		t.Fatalf("solo il file modificato va analizzato: %+v", result)
	}
}
