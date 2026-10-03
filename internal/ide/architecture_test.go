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
	"adomnia/internal/goide",
	"golang.org/x/mod",
	"golang.org/x/tools",
	"golang.org/x/exp/trace",
	"github.com/google/pprof",
}

func TestCoreDoesNotImportLanguageAdapters(t *testing.T) {
	assertNoForbiddenDeps(t, "adomnia/internal/ide/...", forbiddenCoreImports)
}

// L'adapter dipende dal core, mai dall'host: niente cicli con internal/goide.
func TestLanguageAdaptersDoNotImportHost(t *testing.T) {
	assertNoForbiddenDeps(t, "adomnia/internal/languages/...", []string{"adomnia/internal/goide"})
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
