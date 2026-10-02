package goide

import (
	"context"
	"os"
	"path/filepath"
	"testing"
)

func TestLintBaselineHidesOnlyKnownFindings(t *testing.T) {
	binary := linterForTest(t, LinterStaticcheck)
	root := t.TempDir()
	writeFixtureFile(t, root, "go.mod", "module example.com/baseline\n\ngo 1.22\n")
	writeFixtureFile(t, root, "main.go", "package main\n\nfunc unusedOld() {}\n\nfunc main() {}\n")
	service := NewService(&memoryStore{}, nil)
	t.Cleanup(service.Shutdown)
	session, err := service.OpenProject(root)
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
	saved, err := service.SaveLintBaseline(context.Background(), id)
	if err != nil || saved != 1 {
		t.Fatalf("baseline: %d %v", saved, err)
	}
	if _, err := os.Stat(filepath.Join(root, ".adomnia", "lint-baseline.json")); err != nil {
		t.Fatal(err)
	}
	// Il problema noto si sposta di riga (resta nascosto), ne nasce uno nuovo (visibile).
	writeFixtureFile(t, root, "main.go", "package main\n\n\n\nfunc unusedOld() {}\n\nfunc unusedNew() {}\n\nfunc main() {}\n")
	result, err := service.RunLint(context.Background(), id)
	if err != nil || result.Baselined != 1 || result.IssueCount != 1 || result.Reports[0].Diagnostics[0].Range.StartLine != 7 {
		t.Fatalf("baseline non applicata: %v %+v", err, result)
	}
	if err := service.ClearLintBaseline(id); err != nil {
		t.Fatal(err)
	}
	if err := service.ClearLintBaseline(id); err != nil {
		t.Fatal("rimuovere una baseline assente non è un errore")
	}
	result, err = service.RunLint(context.Background(), id)
	if err != nil || result.Baselined != 0 || result.IssueCount != 2 {
		t.Fatalf("senza baseline vanno mostrati tutti: %v %+v", err, result)
	}
}

func TestLinterConfigFileIsCreatedOnlyOnRequest(t *testing.T) {
	binary := linterForTest(t, LinterStaticcheck)
	root := t.TempDir()
	writeFixtureFile(t, root, "go.mod", "module example.com/cfg\n\ngo 1.22\n")
	service := NewService(&memoryStore{}, nil)
	t.Cleanup(service.Shutdown)
	session, err := service.OpenProject(root)
	if err != nil {
		t.Fatal(err)
	}
	id := string(session.ID)
	service.SetToolAuthorization(id, true)
	service.DetectToolchain(id)
	if err := service.ConfigureLinter(id, binary); err != nil {
		t.Fatal(err)
	}
	if name, err := service.LinterConfigFile(id, false); err != nil || name != "" {
		t.Fatalf("senza richiesta non va creato nulla: %q %v", name, err)
	}
	name, err := service.LinterConfigFile(id, true)
	if err != nil || name != "staticcheck.conf" {
		t.Fatalf("configurazione non creata: %q %v", name, err)
	}
	if info, _ := service.DetectLinter(id); info.ConfigPath == "" {
		t.Fatal("la configurazione creata deve essere rilevata")
	}
	if again, err := service.LinterConfigFile(id, false); err != nil || again != "staticcheck.conf" {
		t.Fatalf("configurazione esistente: %q %v", again, err)
	}
}
