package goide

import (
	"context"
	"os/exec"
	"path/filepath"
	"testing"
)

// Un analizzatore personalizzato reale: stampa nel formato di go vet su stderr ed esce con 3.
const fakeAnalyzer = `package main

import (
	"fmt"
	"os"
)

func main() {
	if len(os.Args) < 2 || os.Args[1] != "./..." {
		fmt.Fprintln(os.Stderr, "unexpected arguments", os.Args[1:])
		os.Exit(1)
	}
	fmt.Fprintln(os.Stderr, "# example.com/custom")
	fmt.Fprintln(os.Stderr, "main.go:3:6: nolog: function name should describe intent")
	fmt.Fprintln(os.Stderr, "main.go:5: missing column is fine")
	os.Exit(3)
}
`

func TestCustomLinterParsesVetStyleOutput(t *testing.T) {
	goBinary, err := exec.LookPath("go")
	if err != nil {
		t.Skip("go non disponibile")
	}
	tools := t.TempDir()
	writeFixtureFile(t, tools, "go.mod", "module example.com/analyzer\n\ngo 1.22\n")
	writeFixtureFile(t, tools, "main.go", fakeAnalyzer)
	analyzer := filepath.Join(tools, executableName("myanalyzer"))
	build := exec.Command(goBinary, "build", "-o", analyzer, ".")
	build.Dir = tools
	if output, err := build.CombinedOutput(); err != nil {
		t.Fatalf("build analizzatore: %v\n%s", err, output)
	}

	root := t.TempDir()
	writeFixtureFile(t, root, "go.mod", "module example.com/custom\n\ngo 1.22\n")
	writeFixtureFile(t, root, "main.go", "package main\n\nfunc doIt() {}\n\nfunc main() { doIt() }\n")
	service := NewService(&memoryStore{}, nil)
	t.Cleanup(service.Shutdown)
	session, err := service.OpenProject(root)
	if err != nil {
		t.Fatal(err)
	}
	id := string(session.ID)
	service.SetToolAuthorization(id, true)
	service.DetectToolchain(id)
	if err := service.ConfigureLinter(id, analyzer); err != nil {
		t.Fatal(err)
	}
	info, _ := service.DetectLinter(id)
	if !info.Available || info.Kind != LinterCustom {
		t.Fatalf("analizzatore personalizzato non rilevato: %+v", info)
	}
	result, err := service.RunLint(context.Background(), id)
	if err != nil || result.IssueCount != 2 || result.Reports[0].RelativePath != "main.go" {
		t.Fatalf("risultato inatteso: %v %+v", err, result)
	}
	first := result.Reports[0].Diagnostics[0]
	if first.Range.StartLine != 3 || first.Source != "myanalyzer" || first.Message != "nolog: function name should describe intent" {
		t.Fatalf("diagnostica inattesa: %+v", first)
	}
}
