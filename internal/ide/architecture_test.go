package ide_test

import (
	"os/exec"
	"strings"
	"testing"
)

// Il core dell'IDE non deve dipendere da alcun language adapter né dalle librerie del tooling Go:
// è la regola che rende possibile aggiungere un linguaggio senza toccare il core.
var forbiddenCoreImports = []string{
	"adomnia/internal/languages/",
	"adomnia/internal/codestudio",
	"golang.org/x/mod",
	"golang.org/x/tools",
	"golang.org/x/exp/trace",
	"github.com/google/pprof",
}

func TestCoreDoesNotImportLanguageAdapters(t *testing.T) {
	assertNoForbiddenDeps(t, "adomnia/internal/ide/...", forbiddenCoreImports)
}

// L'adapter dipende dal core, mai dall'host: niente cicli con internal/codestudio.
func TestLanguageAdaptersDoNotImportHost(t *testing.T) {
	assertNoForbiddenDeps(t, "adomnia/internal/languages/...", []string{"adomnia/internal/codestudio"})
}

// Ogni linguaggio resta indipendente dagli altri: condividono il core, non il codice di un altro
// adapter. Un bisogno comune si sposta nel core (MULTILANGUAGE-IDE 10.1).
func TestLanguageAdaptersDoNotImportEachOther(t *testing.T) {
	output, err := exec.Command("go", "list", "-f", `{{.ImportPath}}|{{join .Imports " "}}`, "adomnia/internal/languages/...").CombinedOutput()
	if err != nil {
		t.Fatalf("go list: %v\n%s", err, output)
	}
	const prefix = "adomnia/internal/languages/"
	for _, line := range strings.Split(strings.TrimSpace(string(output)), "\n") {
		path, imports, found := strings.Cut(line, "|")
		if !found || !strings.HasPrefix(path, prefix) {
			continue
		}
		language := strings.Split(strings.TrimPrefix(path, prefix), "/")[0]
		for _, dependency := range strings.Fields(imports) {
			if !strings.HasPrefix(dependency, prefix) || dependency == path {
				continue
			}
			other := strings.Split(strings.TrimPrefix(dependency, prefix), "/")[0]
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
	for _, dependency := range strings.Fields(string(output)) {
		for _, prefix := range forbidden {
			if strings.HasPrefix(dependency, prefix) {
				t.Errorf("%s depends on %s (forbidden prefix %s)", pattern, dependency, prefix)
			}
		}
	}
}
