package golang

import (
	"os"
	"path/filepath"
	"slices"
	"testing"
)

func TestCoverageArgumentsCoverRequestedPatterns(t *testing.T) {
	arguments, err := TestArguments(TestOptions{Packages: []string{"./internal/...", "./cmd/api"}}, "coverage.out")
	if err != nil {
		t.Fatal(err)
	}
	if !slices.Contains(arguments, "-coverpkg=./internal/...,./cmd/api") || !slices.Contains(arguments, "-coverprofile") {
		t.Fatalf("coverage scope missing: %v", arguments)
	}
}

func TestReadModulePathAcceptsQuotedPathAndComment(t *testing.T) {
	path := filepath.Join(t.TempDir(), "go.mod")
	if err := os.WriteFile(path, []byte("module \"example.com/acme/service\" // local service\n\ngo 1.25\n"), 0o600); err != nil {
		t.Fatal(err)
	}
	if got := ReadModulePath(path); got != "example.com/acme/service" {
		t.Fatalf("module path = %q", got)
	}
}
