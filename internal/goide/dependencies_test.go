package goide

import (
	"os"
	"path/filepath"
	"testing"
)

func TestDependencyStateAndStructuredActions(t *testing.T) {
	root := t.TempDir()
	goMod := `module example.com/demo

go 1.26

require (
	example.com/direct v1.2.3
	example.com/indirect v0.4.0 // indirect
)
`
	if err := os.WriteFile(filepath.Join(root, "go.mod"), []byte(goMod), 0o600); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(root, "go.sum"), nil, 0o600); err != nil {
		t.Fatal(err)
	}
	state, err := readDependencyState(testSession(root).Project, "")
	if err != nil {
		t.Fatal(err)
	}
	if state.ModulePath != "example.com/demo" || !state.GoSumPresent || len(state.Dependencies) != 2 || !state.Dependencies[1].Indirect {
		t.Fatalf("stato dipendenze inatteso: %#v", state)
	}
	arguments, err := dependencyArguments(DependencyActionRequest{Action: "update", ModulePath: "example.com/direct", Version: "v1.3.0"})
	if err != nil || len(arguments) != 2 || arguments[0] != "get" || arguments[1] != "example.com/direct@v1.3.0" {
		t.Fatalf("argomenti update inattesi: %#v, %v", arguments, err)
	}
	arguments, err = dependencyArguments(DependencyActionRequest{Action: "remove", ModulePath: "example.com/direct"})
	if err != nil || arguments[1] != "example.com/direct@none" {
		t.Fatalf("argomenti remove inattesi: %#v, %v", arguments, err)
	}
	if _, err := dependencyArguments(DependencyActionRequest{Action: "add", ModulePath: "example.com/pkg; calc", Version: "latest"}); err == nil {
		t.Fatal("module path non sicuro accettato")
	}
}
