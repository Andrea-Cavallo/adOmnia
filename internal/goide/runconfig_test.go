package goide

import (
	"encoding/json"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func TestRunConfigurationValidationAndCrud(t *testing.T) {
	manager := NewRunConfigManager()
	session := SessionID("session-a")

	if _, err := manager.Save(session, RunConfiguration{Name: "  "}); err == nil {
		t.Fatal("una configurazione senza nome deve essere rifiutata")
	}
	if _, err := manager.Save(session, RunConfiguration{Name: "files", Kind: RunKindFiles}); err == nil {
		t.Fatal("una configurazione a lista file senza file deve essere rifiutata")
	}
	if _, err := manager.Save(session, RunConfiguration{Name: "files", Kind: RunKindFiles, Files: []string{"main.txt"}}); err == nil {
		t.Fatal("la lista file deve accettare solo sorgenti Go")
	}
	if _, err := manager.Save(session, RunConfiguration{
		Name: "dup", Environment: []EnvironmentEntry{{Key: "A", Value: "1"}, {Key: "A", Value: "2"}},
	}); err == nil {
		t.Fatal("le variabili duplicate devono essere rifiutate")
	}

	first, err := manager.Save(session, RunConfiguration{Name: "server"})
	if err != nil {
		t.Fatal(err)
	}
	if first.Kind != RunKindPackage || first.Target != "." {
		t.Fatalf("default di configurazione non applicati: %+v", first)
	}

	second, err := manager.Save(session, RunConfiguration{Name: "worker", Target: "./cmd/worker"})
	if err != nil {
		t.Fatal(err)
	}
	if second.Order != 1 {
		t.Fatalf("ordine atteso 1, ottenuto %d", second.Order)
	}

	copied, err := manager.Duplicate(session, first.ID)
	if err != nil {
		t.Fatal(err)
	}
	if copied.ID == first.ID {
		t.Fatal("la copia deve avere un identificatore proprio")
	}
	if copied.Name != "server copy" {
		t.Fatalf("nome della copia inatteso: %q", copied.Name)
	}

	if _, err := manager.Rename(session, copied.ID, "server staging"); err != nil {
		t.Fatal(err)
	}
	if _, err := manager.Reorder(session, []string{second.ID, copied.ID}); err == nil {
		t.Fatal("un riordino incompleto deve essere rifiutato")
	}
	reordered, err := manager.Reorder(session, []string{second.ID, copied.ID, first.ID})
	if err != nil {
		t.Fatal(err)
	}
	if reordered[0].ID != second.ID || reordered[2].ID != first.ID {
		t.Fatalf("ordine non applicato: %v", []string{string(reordered[0].ID), string(reordered[2].ID)})
	}

	if err := manager.Delete(session, second.ID); err != nil {
		t.Fatal(err)
	}
	remaining := manager.List(session)
	if len(remaining) != 2 {
		t.Fatalf("attese 2 configurazioni dopo la cancellazione, trovate %d", len(remaining))
	}
	for index, config := range remaining {
		if config.Order != index {
			t.Fatalf("ordinamento non ricompattato: %+v", remaining)
		}
	}
}

func TestRunConfigurationsAreIsolatedPerSessionAndRedactSecrets(t *testing.T) {
	manager := NewRunConfigManager()
	first, err := manager.Save("session-a", RunConfiguration{
		Name: "with secret",
		Environment: []EnvironmentEntry{
			{Key: "PUBLIC", Value: "visibile"},
			{Key: "TOKEN", Value: "super-segreto", Secret: true},
		},
	})
	if err != nil {
		t.Fatal(err)
	}
	if _, err := manager.Save("session-b", RunConfiguration{Name: "altra sessione"}); err != nil {
		t.Fatal(err)
	}

	if configs := manager.List("session-a"); len(configs) != 1 || configs[0].ID != first.ID {
		t.Fatalf("isolamento per sessione non rispettato: %+v", configs)
	}
	if _, err := manager.Get("session-b", first.ID); err == nil {
		t.Fatal("una sessione non deve leggere le configurazioni di un'altra")
	}

	snapshot := manager.Snapshot()
	encoded, err := json.Marshal(snapshot)
	if err != nil {
		t.Fatal(err)
	}
	if strings.Contains(string(encoded), "super-segreto") {
		t.Fatal("un valore segreto non deve finire nella persistenza")
	}
	if !strings.Contains(string(encoded), "visibile") {
		t.Fatal("i valori non segreti devono essere persistiti")
	}
	if !strings.Contains(string(encoded), "TOKEN") {
		t.Fatal("la chiave segreta deve restare dichiarata")
	}

	// La copia in memoria conserva il valore per la sessione corrente.
	live, err := manager.Get("session-a", first.ID)
	if err != nil {
		t.Fatal(err)
	}
	if live.Environment[1].Value != "super-segreto" {
		t.Fatal("il valore segreto deve restare disponibile in memoria")
	}
	if keys := live.RequiredSecrets(); len(keys) != 1 || keys[0] != "TOKEN" {
		t.Fatalf("segreti richiesti inattesi: %v", keys)
	}

	manager.CloseSession("session-a")
	if configs := manager.List("session-a"); len(configs) != 0 {
		t.Fatal("la chiusura della sessione deve rilasciarne le configurazioni")
	}
	if configs := manager.List("session-b"); len(configs) != 1 {
		t.Fatal("la chiusura di una sessione non deve toccare le altre")
	}
}

func TestConfiguredRunBuildsOrderedArgumentsAndDemandsSecrets(t *testing.T) {
	project := t.TempDir()
	writeFixtureFile(t, project, "go.mod", "module example.com/cfg\n\ngo 1.26\n")
	writeFixtureFile(t, project, "main.go", "package main\n\nfunc main() {}\n")
	writeFixtureFile(t, project, "helper.go", "package main\n")

	service := NewService(&memoryStore{}, nil)
	session, err := service.OpenProject(project)
	if err != nil {
		t.Fatal(err)
	}

	config, err := service.SaveRunConfiguration(string(session.ID), RunConfiguration{
		Name: "files", Kind: RunKindFiles, Files: []string{"main.go", "helper.go"},
		BuildTags:   []string{"integration"},
		Environment: []EnvironmentEntry{{Key: "TOKEN", Secret: true}},
	})
	if err != nil {
		t.Fatal(err)
	}

	if _, err := service.buildRunRequest(session, config, nil); err == nil {
		t.Fatal("un segreto mancante deve impedire l'avvio")
	}
	request, err := service.buildRunRequest(session, config, map[string]string{"TOKEN": "valore"})
	if err != nil {
		t.Fatal(err)
	}
	if request.Target != "main.go" {
		t.Fatalf("target atteso main.go, ottenuto %q", request.Target)
	}
	if len(request.ExtraTargets) != 1 || request.ExtraTargets[0] != "helper.go" {
		t.Fatalf("target aggiuntivi inattesi: %v", request.ExtraTargets)
	}
	if request.Environment["TOKEN"] != "valore" {
		t.Fatal("il valore segreto fornito a runtime deve raggiungere l'ambiente")
	}
}

func TestRunConfigurationPathsStayInsideProject(t *testing.T) {
	project := t.TempDir()
	writeFixtureFile(t, project, "go.mod", "module example.com/escape\n\ngo 1.26\n")

	service := NewService(&memoryStore{}, nil)
	session, err := service.OpenProject(project)
	if err != nil {
		t.Fatal(err)
	}
	if _, err := service.SaveRunConfiguration(string(session.ID), RunConfiguration{
		Name: "escape", Kind: RunKindFiles, Files: []string{"../outside.go"},
	}); err == nil {
		t.Fatal("un percorso fuori dalla radice del progetto deve essere rifiutato")
	}
}

func writeFixtureFile(t *testing.T, root, name, content string) {
	t.Helper()
	path := filepath.Join(root, filepath.FromSlash(name))
	if err := os.MkdirAll(filepath.Dir(path), 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(path, []byte(content), 0o644); err != nil {
		t.Fatal(err)
	}
}
