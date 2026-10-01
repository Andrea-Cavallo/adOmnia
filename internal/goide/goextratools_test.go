package goide

import "testing"

func TestGoToolsAreDetectedInstalledAndRunSafely(t *testing.T) {
	project := t.TempDir()
	writeFixtureFile(t, project, "go.mod", "module example.com/tools\n\ngo 1.26\n")
	events := make(chan EventEnvelope, 1024)
	service := NewService(&memoryStore{}, func(event EventEnvelope) { events <- event })
	t.Cleanup(service.Shutdown)
	session, err := service.OpenProject(project)
	if err != nil {
		t.Fatal(err)
	}
	id := string(session.ID)
	if _, err := service.DetectGoTool(id, "../evil"); err == nil {
		t.Fatal("un nome di tool con percorso deve essere rifiutato")
	}
	if info, _ := service.DetectGoTool(id, "surely-not-installed-tool"); info.Available || info.Error == "" {
		t.Fatalf("tool inesistente: %+v", info)
	}
	for _, invalid := range []string{"golang.org/x/vuln/cmd/govulncheck", "x@latest; rm -rf", "../x@latest", "-flag@v1"} {
		if _, err := service.InstallGoModule(id, invalid, true); err == nil {
			t.Fatalf("modulo non valido accettato: %q", invalid)
		}
	}
	if _, err := service.InstallGoModule(id, "golang.org/x/tools/cmd/stringer@latest", false); err == nil {
		t.Fatal("l'installazione richiede conferma esplicita")
	}
	if _, err := service.RunGoTool(id, "go", []string{"version"}, ""); err == nil {
		t.Fatal("senza Trust nessun tool parte")
	}
	if _, err := service.SetToolAuthorization(id, true); err != nil {
		t.Fatal(err)
	}
	execution, err := service.RunGoTool(id, "go", []string{"version"}, "")
	if err != nil {
		t.Fatal(err)
	}
	finished := waitServiceEvent(t, events, func(event EventEnvelope) bool {
		next, ok := event.Payload.(Execution)
		return event.Type == "run.finished" && ok && next.ID == execution.ID
	}).Payload.(Execution)
	if finished.ExitCode == nil || *finished.ExitCode != 0 {
		t.Fatalf("tool terminato male: %+v", finished)
	}
}
