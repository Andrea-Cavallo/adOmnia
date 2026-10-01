package goide

import (
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func TestCommandGoToolAndCompoundConfigurations(t *testing.T) {
	for _, invalid := range []RunConfiguration{
		{Name: "c", Kind: RunKindCommand},
		{Name: "c", Kind: RunKindCommand, Target: "-rf"},
		{Name: "g", Kind: RunKindGoTool, Target: "run --x"},
		{Name: "x", Kind: RunKindCompound, Compound: []string{"a"}},
	} {
		if _, err := normalizeConfiguration(invalid); err == nil {
			t.Fatalf("configurazione non valida accettata: %#v", invalid)
		}
	}
	compound, err := normalizeConfiguration(RunConfiguration{ID: "self", Name: "stack", Kind: RunKindCompound, Compound: []string{"a", " b ", "a", "self"}, PreRun: []string{"a"}})
	if err != nil || strings.Join(compound.Compound, ",") != "a,b" || len(compound.PreRun) != 0 {
		t.Fatalf("compound normalizzata male: %#v %v", compound, err)
	}

	project := t.TempDir()
	writeFixtureFile(t, project, "go.mod", "module example.com/cmd\n\ngo 1.26\n")
	service := NewService(&memoryStore{}, nil)
	t.Cleanup(service.Shutdown)
	session, err := service.OpenProject(project)
	if err != nil {
		t.Fatal(err)
	}
	id := string(session.ID)
	api, _ := service.SaveRunConfiguration(id, RunConfiguration{Name: "api", Kind: RunKindGoTool, Target: "version"})
	worker, _ := service.SaveRunConfiguration(id, RunConfiguration{Name: "worker", Kind: RunKindCommand, Target: "go", ProgramArguments: []string{"env", "GOOS"}})
	stack, err := service.SaveRunConfiguration(id, RunConfiguration{Name: "stack", Kind: RunKindCompound, Compound: []string{api.ID, worker.ID}})
	if err != nil {
		t.Fatal(err)
	}
	if _, err := service.SaveRunConfiguration(id, RunConfiguration{Name: "nested", Kind: RunKindCompound, Compound: []string{api.ID, stack.ID}}); err == nil {
		t.Fatal("una compound dentro una compound deve essere rifiutata")
	}
	if _, err := service.SaveRunConfiguration(id, RunConfiguration{Name: "ghost", Kind: RunKindCompound, Compound: []string{api.ID, "missing"}}); err == nil {
		t.Fatal("una compound con una configurazione inesistente deve essere rifiutata")
	}
	if _, err := service.SaveRunConfiguration(id, RunConfiguration{Name: "escape", Kind: RunKindCommand, Target: "../outside.sh"}); err == nil {
		t.Fatal("un comando fuori dal progetto deve essere rifiutato")
	}
	if _, err := service.StartConfiguredRun(id, stack.ID, nil); err == nil {
		t.Fatal("senza Trust la compound non deve avviare nulla")
	}
}

func TestSharedRunConfigurationsRoundTripThroughTheProject(t *testing.T) {
	project := t.TempDir()
	writeFixtureFile(t, project, "go.mod", "module example.com/shared\n\ngo 1.26\n")
	writeFixtureFile(t, project, "main.go", "package main\n\nfunc main() {}\n")

	first := NewService(&memoryStore{}, nil)
	t.Cleanup(first.Shutdown)
	session, err := first.OpenProject(project)
	if err != nil {
		t.Fatal(err)
	}
	saved, err := first.SaveRunConfiguration(string(session.ID), RunConfiguration{
		Name: "api", Kind: RunKindPackage, Shared: true, Pinned: true,
		Environment: []EnvironmentEntry{{Key: "TOKEN", Value: "super-secret", Secret: true}, {Key: "PORT", Value: "8080"}},
	})
	if err != nil {
		t.Fatal(err)
	}
	if _, err := first.SaveRunConfiguration(string(session.ID), RunConfiguration{Name: "private", Kind: RunKindPackage}); err != nil {
		t.Fatal(err)
	}
	data, err := os.ReadFile(filepath.Join(project, ".adomnia", "run-configurations.json"))
	if err != nil {
		t.Fatal(err)
	}
	text := string(data)
	if strings.Contains(text, "super-secret") || strings.Contains(text, "private") || strings.Contains(text, `"pinned"`) || !strings.Contains(text, `"PORT"`) {
		t.Fatalf("file condiviso inatteso:\n%s", text)
	}

	// Un collega apre lo stesso repository: trova la configurazione condivisa con lo stesso ID, non quella privata.
	second := NewService(&memoryStore{}, nil)
	t.Cleanup(second.Shutdown)
	other, err := second.OpenProject(project)
	if err != nil {
		t.Fatal(err)
	}
	configs, err := second.ListRunConfigurations(string(other.ID))
	if err != nil {
		t.Fatal(err)
	}
	if len(configs) != 1 || configs[0].ID != saved.ID || !configs[0].Shared || configs[0].Pinned {
		t.Fatalf("configurazioni importate inattese: %#v", configs)
	}
}

func TestCommandAndGoToolRunsReallyExecute(t *testing.T) {
	project := t.TempDir()
	writeFixtureFile(t, project, "go.mod", "module example.com/run\n\ngo 1.26\n")
	events := make(chan EventEnvelope, 1024)
	service := NewService(&memoryStore{}, func(event EventEnvelope) { events <- event })
	t.Cleanup(service.Shutdown)
	session, err := service.OpenProject(project)
	if err != nil {
		t.Fatal(err)
	}
	if _, err := service.SetToolAuthorization(string(session.ID), true); err != nil {
		t.Fatal(err)
	}
	for _, request := range []RunRequest{
		{SessionID: session.ID, Kind: "go-tool", Target: "version"},
		{SessionID: session.ID, Kind: "command", Target: "go", ProgramArguments: []string{"env", "GOMOD"}},
	} {
		execution, err := service.StartRun(request)
		if err != nil {
			t.Fatalf("%s: %v", request.Kind, err)
		}
		finished := waitServiceEvent(t, events, func(event EventEnvelope) bool {
			next, ok := event.Payload.(Execution)
			return event.Type == "run.finished" && ok && next.ID == execution.ID
		}).Payload.(Execution)
		if finished.Status != "exited" || finished.ExitCode == nil || *finished.ExitCode != 0 {
			t.Fatalf("%s terminato con %q / %v", request.Kind, finished.Status, finished.ExitCode)
		}
	}
}
