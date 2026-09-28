package goide

import (
	"strings"
	"testing"
	"time"
)

func TestLocalHistoryLimitsRetentionAndSecrets(t *testing.T) {
	store := &memoryStore{}
	history := NewLocalHistory(store)
	clock := time.Date(2026, 9, 1, 10, 0, 0, 0, time.UTC)
	history.now = func() time.Time { return clock }

	for index := 0; index < maxHistoryRevisionsByFile+5; index++ {
		clock = clock.Add(time.Minute)
		if err := history.Record("s1", "main.go", strings.Repeat("x", index+1), "Saved"); err != nil {
			t.Fatal(err)
		}
	}
	_ = history.Record("s1", "main.go", strings.Repeat("x", maxHistoryRevisionsByFile+5), "Saved")
	revisions, _ := history.List("s1", "main.go")
	if len(revisions) != maxHistoryRevisionsByFile {
		t.Fatalf("limite per file non applicato, né deduplica: %d", len(revisions))
	}
	if content, _ := history.Content("s1", "main.go", revisions[0].ID); len(content) != maxHistoryRevisionsByFile+5 {
		t.Fatalf("la prima versione deve essere la più recente: %d", len(content))
	}

	_ = history.Record("s1", ".env", "TOKEN=secret", "Saved")
	_ = history.Record("s1", "certs/server.key", "-----BEGIN", "Saved")
	if list, _ := history.List("s1", ".env"); len(list) != 0 {
		t.Fatal("i file con segreti non devono entrare nella local history")
	}
	if strings.Contains(string(store.data), "TOKEN=secret") {
		t.Fatal("segreto persistito")
	}

	// Oltre la ritenzione le versioni spariscono anche dallo store riletto.
	clock = clock.Add(historyRetention + time.Hour)
	reloaded := NewLocalHistory(store)
	reloaded.now = func() time.Time { return clock }
	if list, _ := reloaded.List("s1", "main.go"); len(list) != 0 {
		t.Fatalf("versioni scadute ancora disponibili: %d", len(list))
	}
}

func TestSaveRecordsOriginalAndSavedVersions(t *testing.T) {
	project := t.TempDir()
	writeFixtureFile(t, project, "go.mod", "module example.com/h\n\ngo 1.22\n")
	writeFixtureFile(t, project, "main.go", "package main\n// v0\n")
	service := NewService(&memoryStore{}, nil)
	t.Cleanup(service.Shutdown)
	session, err := service.OpenProject(project)
	if err != nil {
		t.Fatal(err)
	}
	document, err := service.OpenDocument(string(session.ID), "main.go")
	if err != nil {
		t.Fatal(err)
	}
	saved, err := service.SaveDocument(string(session.ID), string(document.Document.ID), "package main\n// v1\n", document.DiskToken, false)
	if err != nil {
		t.Fatal(err)
	}
	if _, err := service.SaveDocument(string(session.ID), string(document.Document.ID), "package main\n// v2\n", saved.DiskToken, false); err != nil {
		t.Fatal(err)
	}
	revisions, err := service.ListLocalHistory(string(session.ID), "main.go")
	if err != nil || len(revisions) != 3 || revisions[2].Label != "Before first save" {
		t.Fatalf("attese originale + due salvataggi: %+v %v", revisions, err)
	}
	original, _ := service.LocalHistoryContent(string(session.ID), "main.go", revisions[2].ID)
	if !strings.Contains(original, "// v0") {
		t.Fatalf("la versione originale deve essere quella su disco prima del salvataggio: %q", original)
	}
}
