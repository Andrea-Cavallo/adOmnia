package goide

import (
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"
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
	arguments, err := dependencyArguments(DependencyActionRequest{Action: "update", ModulePath: "example.com/direct", Version: "v1.3.0"}, root)
	if err != nil || len(arguments) != 2 || arguments[0] != "get" || arguments[1] != "example.com/direct@v1.3.0" {
		t.Fatalf("argomenti update inattesi: %#v, %v", arguments, err)
	}
	arguments, err = dependencyArguments(DependencyActionRequest{Action: "remove", ModulePath: "example.com/direct"}, root)
	if err != nil || arguments[1] != "example.com/direct@none" {
		t.Fatalf("argomenti remove inattesi: %#v, %v", arguments, err)
	}
	if _, err := dependencyArguments(DependencyActionRequest{Action: "add", ModulePath: "example.com/pkg; calc", Version: "latest"}, root); err == nil {
		t.Fatal("module path non sicuro accettato")
	}
}

func TestGoModQuickActionsReplaceWithLocalFolderAndDrop(t *testing.T) {
	workspace := t.TempDir()
	project := filepath.Join(workspace, "app")
	writeFixtureFile(t, project, "go.mod", "module example.com/app\n\ngo 1.22\n\nrequire example.com/lib v1.0.0\n")
	writeFixtureFile(t, workspace, "lib/go.mod", "module example.com/lib\n\ngo 1.22\n")
	writeFixtureFile(t, workspace, "notamodule/readme.txt", "x")

	recorder := &eventRecorder{}
	service := NewService(&memoryStore{}, recorder.record)
	t.Cleanup(service.Shutdown)
	session, err := service.OpenProject(project)
	if err != nil {
		t.Fatal(err)
	}
	if _, err := service.SetToolAuthorization(string(session.ID), true); err != nil {
		t.Fatal(err)
	}
	run := func(request DependencyActionRequest) Execution {
		t.Helper()
		request.SessionID, request.Confirmed = session.ID, true
		execution, err := service.StartDependencyAction(request)
		if err != nil {
			t.Fatal(err)
		}
		return recorder.waitFor(t, 60*time.Second, func(event EventEnvelope) bool {
			done, ok := event.Payload.(Execution)
			return ok && event.Type == "run.finished" && done.ID == execution.ID
		}).Payload.(Execution)
	}

	if _, err := dependencyArguments(DependencyActionRequest{Action: "replace", ModulePath: "example.com/lib", LocalPath: filepath.Join(workspace, "notamodule")}, project); err == nil {
		t.Fatal("una cartella senza go.mod non può sostituire un modulo")
	}
	if finished := run(DependencyActionRequest{Action: "replace", ModulePath: "example.com/lib", LocalPath: filepath.Join(workspace, "lib")}); finished.Status != "exited" {
		t.Fatalf("replace fallita: %+v", finished)
	}
	state, err := service.ListDependencies(string(session.ID), "")
	if err != nil {
		t.Fatal(err)
	}
	if len(state.Replacements) != 1 || state.Replacements[0].NewPath != "../lib" || !state.Replacements[0].Local {
		t.Fatalf("replace locale inattesa: %+v", state.Replacements)
	}
	if finished := run(DependencyActionRequest{Action: "dropreplace", ModulePath: "example.com/lib"}); finished.Status != "exited" {
		t.Fatalf("dropreplace fallita: %+v", finished)
	}
	if state, _ = service.ListDependencies(string(session.ID), ""); len(state.Replacements) != 0 {
		t.Fatalf("replace non rimossa: %+v", state.Replacements)
	}
	for action, want := range map[string]string{"updateall": "get -u ./...", "updatepatch": "get -u=patch ./...", "download": "mod download", "verify": "mod verify", "tidy": "mod tidy"} {
		arguments, err := dependencyArguments(DependencyActionRequest{Action: action}, project)
		if err != nil || strings.Join(arguments, " ") != want {
			t.Fatalf("%s: argomenti inattesi %v %v", action, arguments, err)
		}
	}
}
