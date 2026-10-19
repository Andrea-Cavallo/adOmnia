package securityintel_test

import (
	"go/parser"
	"go/token"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

// Il core di adOmnia Security Intelligence non deve importare un adapter.
//
// È lo stesso confine dell'IDE Platform: il motore conosce Component, Advisory e il
// risk model, non Maven o Go. Se questo test fallisce, qualcuno ha versato un
// dettaglio dell'ecosistema nel core, e aggiungere package.json o Cargo.toml
// richiederà di nuovo di toccare tutto.
func TestCoreDoesNotImportAdapters(t *testing.T) {
	packageDirectory, err := os.Getwd()
	if err != nil {
		t.Fatal(err)
	}
	forbidden := []string{
		"adomnia/internal/securityintel/maven",
		"adomnia/internal/securityintel/gomod",
		"adomnia/internal/securityintel/govuln",
		"adomnia/internal/languages/",
		"adomnia/internal/codestudio",
	}
	tokenSet := token.NewFileSet()
	entries, err := os.ReadDir(packageDirectory)
	if err != nil {
		t.Fatalf("read core package: %v", err)
	}
	for _, entry := range entries {
		name := entry.Name()
		if entry.IsDir() || !strings.HasSuffix(name, ".go") || strings.HasSuffix(name, "_test.go") {
			continue
		}
		file, err := parser.ParseFile(tokenSet, filepath.Join(packageDirectory, name), nil, parser.ImportsOnly)
		if err != nil {
			t.Fatalf("parse core package: %v", err)
		}
		for _, spec := range file.Imports {
			path := strings.Trim(spec.Path.Value, `"`)
			for _, blocked := range forbidden {
				if path == blocked || strings.HasPrefix(path, blocked) {
					t.Errorf("%s imports %s: the security engine core must stay independent of the ecosystem adapters (see %s)",
						name, path, filepath.Base(packageDirectory))
				}
			}
		}
	}
}
