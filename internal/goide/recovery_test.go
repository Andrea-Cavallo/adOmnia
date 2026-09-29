package goide

import (
	"encoding/json"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func TestPersistenceMigratesSchemaV2ToV3(t *testing.T) {
	legacy := `{
		"version": 2,
		"sessions": [{"id":"s1","project":{"id":"p1","name":"legacy","rootPath":"/tmp/legacy","realPath":"/tmp/legacy","modules":[],"authorization":"opened"}}],
		"recent": [{"name":"legacy","rootPath":"/tmp/legacy","realPath":"/tmp/legacy","available":true}]
	}`
	store := &memoryStore{data: []byte(legacy)}
	state, err := NewPersistence(store).LoadState()
	if err != nil {
		t.Fatal(err)
	}
	if state.Version != PersistenceSchemaVersion {
		t.Fatalf("versione attesa %d, ottenuta %d", PersistenceSchemaVersion, state.Version)
	}
	if len(state.Sessions) != 1 || len(state.Recent) != 1 {
		t.Fatalf("migrazione ha perso dati: %+v", state)
	}
	if state.RunConfigs != nil {
		t.Fatal("uno schema v2 non deve inventare configurazioni Run")
	}
	if state.SessionUI == nil {
		t.Fatal("la mappa dello stato UI deve essere inizializzata dopo la migrazione")
	}
}

func TestPersistenceRoundTripsConfigsAndViews(t *testing.T) {
	store := &memoryStore{}
	persistence := NewPersistence(store)
	err := persistence.SaveState(persistedState{
		Sessions:   []Session{{ID: "s1"}},
		RunConfigs: []RunConfiguration{{ID: "c1", SessionID: "s1", Name: "run", Kind: RunKindPackage, Target: "."}},
		SessionUI: map[SessionID]SessionView{
			"s1": {OpenPaths: []string{"main.go"}, ActivePath: "main.go", BottomOpen: true, ProjectWidth: 260},
		},
	})
	if err != nil {
		t.Fatal(err)
	}
	state, err := persistence.LoadState()
	if err != nil {
		t.Fatal(err)
	}
	if len(state.RunConfigs) != 1 || state.RunConfigs[0].Name != "run" {
		t.Fatalf("configurazioni non ripristinate: %+v", state.RunConfigs)
	}
	view := state.SessionUI["s1"]
	if view.ActivePath != "main.go" || !view.BottomOpen || view.ProjectWidth != 260 {
		t.Fatalf("layout non ripristinato: %+v", view)
	}
}

func TestRecoveryStoreKeepsBuffersOutOfSessionState(t *testing.T) {
	store := &memoryStore{}
	manager := NewRecoveryManager(store)
	if err := manager.Load(); err != nil {
		t.Fatal(err)
	}
	if err := manager.Remember("s1", "main.go", "package main // lavoro non salvato", "token-1"); err != nil {
		t.Fatal(err)
	}
	if err := manager.Remember("s2", "other.go", "package other", "token-2"); err != nil {
		t.Fatal(err)
	}

	restored := NewRecoveryManager(&memoryStore{data: store.data})
	if err := restored.Load(); err != nil {
		t.Fatal(err)
	}
	entries := restored.List("s1")
	if len(entries) != 1 || !strings.Contains(entries[0].Content, "non salvato") {
		t.Fatalf("buffer non ripristinato: %+v", entries)
	}
	if len(restored.List("s2")) != 1 {
		t.Fatal("i buffer delle altre sessioni devono sopravvivere")
	}

	if err := restored.ForgetSession("s1"); err != nil {
		t.Fatal(err)
	}
	if len(restored.List("s1")) != 0 {
		t.Fatal("ForgetSession deve svuotare la sola sessione indicata")
	}
	if len(restored.List("s2")) != 1 {
		t.Fatal("ForgetSession non deve toccare le altre sessioni")
	}
}

func TestRecoveryRejectsOversizedBufferAndSurvivesCorruptStore(t *testing.T) {
	manager := NewRecoveryManager(&memoryStore{})
	if err := manager.Load(); err != nil {
		t.Fatal(err)
	}
	oversized := strings.Repeat("x", MaxRecoveredBufferBytes+1)
	if err := manager.Remember("s1", "big.go", oversized, ""); err == nil {
		t.Fatal("un buffer oltre il limite deve essere rifiutato")
	}

	corrupt := NewRecoveryManager(&memoryStore{data: []byte("{non json")})
	if err := corrupt.Load(); err != nil {
		t.Fatalf("uno store di recupero illeggibile non deve impedire l'avvio: %v", err)
	}
	if len(corrupt.List("s1")) != 0 {
		t.Fatal("uno store illeggibile deve ripartire vuoto")
	}
}

func TestRecoveredBuffersReportDiskChangeAndMissingFiles(t *testing.T) {
	project := t.TempDir()
	writeFixtureFile(t, project, "go.mod", "module example.com/recovery\n\ngo 1.26\n")
	writeFixtureFile(t, project, "main.go", "package main\n")

	service := NewService(&memoryStore{}, nil)
	if err := service.ConfigureRecoveryStore(&memoryStore{}); err != nil {
		t.Fatal(err)
	}
	session, err := service.OpenProject(project)
	if err != nil {
		t.Fatal(err)
	}
	document, err := service.OpenDocument(string(session.ID), "main.go")
	if err != nil {
		t.Fatal(err)
	}
	if err := service.RememberBuffer(string(session.ID), "main.go", "package main // modificato", document.DiskToken); err != nil {
		t.Fatal(err)
	}

	buffers, err := service.ListRecoveredBuffers(string(session.ID))
	if err != nil {
		t.Fatal(err)
	}
	if len(buffers) != 1 || buffers[0].DiskChanged || buffers[0].Missing {
		t.Fatalf("stato del buffer inatteso prima della modifica esterna: %+v", buffers)
	}

	writeFixtureFile(t, project, "main.go", "package main // cambiato da fuori\n")
	buffers, err = service.ListRecoveredBuffers(string(session.ID))
	if err != nil {
		t.Fatal(err)
	}
	if len(buffers) != 1 || !buffers[0].DiskChanged {
		t.Fatalf("la modifica esterna deve essere segnalata: %+v", buffers)
	}

	if err := os.Remove(filepath.Join(project, "main.go")); err != nil {
		t.Fatal(err)
	}
	buffers, err = service.ListRecoveredBuffers(string(session.ID))
	if err != nil {
		t.Fatal(err)
	}
	if len(buffers) != 1 || !buffers[0].Missing {
		t.Fatalf("un file sparito deve essere segnalato come mancante: %+v", buffers)
	}

	if err := service.ForgetBuffer(string(session.ID), "main.go"); err != nil {
		t.Fatal(err)
	}
	if buffers, _ = service.ListRecoveredBuffers(string(session.ID)); len(buffers) != 0 {
		t.Fatal("un buffer dimenticato non deve più essere proposto")
	}
}

func TestPruneMissingSessionsKeepsAvailableOnes(t *testing.T) {
	alive := t.TempDir()
	writeFixtureFile(t, alive, "go.mod", "module example.com/alive\n\ngo 1.26\n")
	doomed := t.TempDir()
	writeFixtureFile(t, doomed, "go.mod", "module example.com/doomed\n\ngo 1.26\n")

	service := NewService(&memoryStore{}, nil)
	if _, err := service.OpenProject(alive); err != nil {
		t.Fatal(err)
	}
	doomedSession, err := service.OpenProject(doomed)
	if err != nil {
		t.Fatal(err)
	}
	if err := os.RemoveAll(doomed); err != nil {
		t.Skipf("impossibile rimuovere la cartella di prova: %v", err)
	}

	sessions, err := service.PruneMissingSessions()
	if err != nil {
		t.Fatal(err)
	}
	if len(sessions) != 1 {
		t.Fatalf("attesa una sola sessione superstite, trovate %d", len(sessions))
	}
	if sessions[0].ID == doomedSession.ID {
		t.Fatal("la sessione con cartella mancante doveva essere rimossa")
	}
	recent, err := service.ListRecentProjects()
	if err != nil {
		t.Fatal(err)
	}
	if len(recent) != 2 {
		t.Fatalf("i progetti recenti non devono essere persi: %+v", recent)
	}
}

func TestSessionViewPersistsTabsWithoutFileContent(t *testing.T) {
	project := t.TempDir()
	writeFixtureFile(t, project, "go.mod", "module example.com/view\n\ngo 1.26\n")
	writeFixtureFile(t, project, "main.go", "package main // contenuto riservato\n")

	store := &memoryStore{}
	service := NewService(store, nil)
	session, err := service.OpenProject(project)
	if err != nil {
		t.Fatal(err)
	}
	view := SessionView{OpenPaths: []string{"main.go", "main.go", "go.mod"}, ActivePath: "main.go", BottomOpen: true}
	if err := service.SaveSessionView(string(session.ID), view); err != nil {
		t.Fatal(err)
	}
	stored, err := service.GetSessionView(string(session.ID))
	if err != nil {
		t.Fatal(err)
	}
	if len(stored.OpenPaths) != 2 {
		t.Fatalf("i percorsi duplicati devono essere compattati: %+v", stored.OpenPaths)
	}
	if strings.Contains(string(store.data), "contenuto riservato") {
		t.Fatal("il contenuto dei file non deve finire nello stato di sessione")
	}

	var decoded persistedState
	if err := json.Unmarshal(store.data, &decoded); err != nil {
		t.Fatal(err)
	}
	if decoded.SessionUI[session.ID].ActivePath != "main.go" {
		t.Fatalf("stato UI non persistito: %+v", decoded.SessionUI)
	}
}

func TestBreakpointsPersistAcrossRestartAndViewSaves(t *testing.T) {
	project := t.TempDir()
	writeFixtureFile(t, project, "go.mod", "module example.com/bp\n\ngo 1.26\n")
	writeFixtureFile(t, project, "main.go", "package main\n\nfunc main() {\n\tprintln(1)\n}\n")

	store := &memoryStore{}
	service := NewService(store, nil)
	session, err := service.OpenProject(project)
	if err != nil {
		t.Fatal(err)
	}
	if _, err := service.SetBreakpoints(string(session.ID), "main.go", []int{4, 4, 3}); err != nil {
		t.Fatal(err)
	}
	// Il frontend salva il layout senza breakpoint: non deve cancellarli.
	if err := service.SaveSessionView(string(session.ID), SessionView{ActivePath: "main.go"}); err != nil {
		t.Fatal(err)
	}

	restarted := NewService(store, nil)
	defer restarted.Shutdown()
	saved, err := restarted.ListBreakpoints(string(session.ID))
	if err != nil {
		t.Fatal(err)
	}
	if len(saved) != 1 || saved[0].RelativePath != "main.go" || len(saved[0].Breakpoints) != 2 || saved[0].Breakpoints[0].Line != 3 {
		t.Fatalf("breakpoint non ripristinati: %+v", saved)
	}
	if _, err := restarted.SetBreakpoints(string(session.ID), "main.go", nil); err != nil {
		t.Fatal(err)
	}
	if saved, _ := restarted.ListBreakpoints(string(session.ID)); len(saved) != 0 {
		t.Fatalf("i breakpoint rimossi devono sparire: %+v", saved)
	}
}

func TestFindSessionsForPathDetectsNestedProjectConflict(t *testing.T) {
	root := t.TempDir()
	nested := filepath.Join(root, "services", "api")
	writeFixtureFile(t, root, "go.mod", "module example.com/root\n\ngo 1.26\n")
	writeFixtureFile(t, root, "services/api/go.mod", "module example.com/api\n\ngo 1.26\n")
	writeFixtureFile(t, root, "services/api/main.go", "package main\n")

	service := NewService(&memoryStore{}, nil)
	rootSession, err := service.OpenProject(root)
	if err != nil {
		t.Fatal(err)
	}
	nestedSession, err := service.OpenProject(nested)
	if err != nil {
		t.Fatal(err)
	}

	matches, err := service.FindSessionsForPath(string(rootSession.ID), "services/api/main.go")
	if err != nil {
		t.Fatal(err)
	}
	if len(matches) != 1 || matches[0].ID != nestedSession.ID {
		t.Fatalf("conflitto tra progetto padre e modulo annidato non rilevato: %+v", matches)
	}
}
