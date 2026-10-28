package ide_test

import (
	"os/exec"
	"strings"
	"testing"
)

// Il core dell'IDE non deve dipendere da alcun language adapter né dalle librerie del tooling Go:
// è la regola che rende possibile aggiungere un linguaggio senza toccare il core.
var forbiddenCoreImports = []string{
	"github.com/Andrea-Cavallo/adOmnia/internal/languages/",
	"github.com/Andrea-Cavallo/adOmnia/internal/codestudio",
	"golang.org/x/mod",
	"golang.org/x/tools",
	"golang.org/x/exp/trace",
	"github.com/google/pprof",
}

func TestCoreDoesNotImportLanguageAdapters(t *testing.T) {
	assertNoForbiddenDeps(t, "github.com/Andrea-Cavallo/adOmnia/internal/ide/...", forbiddenCoreImports)
}

// L'adapter dipende dal core, mai dall'host: niente cicli con internal/codestudio.
func TestLanguageAdaptersDoNotImportHost(t *testing.T) {
	assertNoForbiddenDeps(t, "github.com/Andrea-Cavallo/adOmnia/internal/languages/...", []string{"github.com/Andrea-Cavallo/adOmnia/internal/codestudio"})
}

// Ogni linguaggio resta indipendente dagli altri: condividono il core, non il codice di un altro
// adapter. Un bisogno comune si sposta nel core (MULTILANGUAGE-IDE 10.1).
func TestLanguageAdaptersDoNotImportEachOther(t *testing.T) {
	output, err := exec.Command("go", "list", "-f", `{{.ImportPath}}|{{join .Imports " "}}`, "github.com/Andrea-Cavallo/adOmnia/internal/languages/...").CombinedOutput()
	if err != nil {
		t.Fatalf("go list: %v\n%s", err, output)
	}
	const prefix = "github.com/Andrea-Cavallo/adOmnia/internal/languages/"
	for line := range strings.SplitSeq(strings.TrimSpace(string(output)), "\n") {
		path, imports, found := strings.Cut(line, "|")
		if !found || !strings.HasPrefix(path, prefix) {
			continue
		}
		language, _, _ := strings.Cut(strings.TrimPrefix(path, prefix), "/")
		for dependency := range strings.FieldsSeq(imports) {
			if !strings.HasPrefix(dependency, prefix) || dependency == path {
				continue
			}
			other, _, _ := strings.Cut(strings.TrimPrefix(dependency, prefix), "/")
			if other != language {
				t.Errorf("%s imports %s: adapters must not depend on each other", path, dependency)
			}
		}
	}
}

func assertNoForbiddenDeps(t *testing.T, pattern string, forbidden []string) {
	t.Helper()
	output, err := exec.Command("go", "list", "-deps", "-test", pattern).CombinedOutput()
	if err != nil {
		t.Fatalf("go list %s: %v\n%s", pattern, err, output)
	}
	for dependency := range strings.FieldsSeq(string(output)) {
		for _, prefix := range forbidden {
			if strings.HasPrefix(dependency, prefix) {
				t.Errorf("%s depends on %s (forbidden prefix %s)", pattern, dependency, prefix)
			}
		}
	}
}
