package goide

import (
	"encoding/json"
	"fmt"
	"strings"
	"testing"
)

// workspaceMemoryStore registra quali workspace vengono riscritti a ogni operazione.
type workspaceMemoryStore struct {
	legacy     []byte
	workspaces map[string][]byte
	writes     []string
}

func (s *workspaceMemoryStore) Load() ([]byte, error) { return s.legacy, nil }
func (s *workspaceMemoryStore) Save(data []byte) error {
	s.legacy = data
	return nil
}
func (s *workspaceMemoryStore) LoadWorkspaces() (map[string][]byte, error) { return s.workspaces, nil }
func (s *workspaceMemoryStore) SaveWorkspace(id string, data []byte) error {
	s.writes = append(s.writes, id)
	if len(data) == 0 {
		delete(s.workspaces, id)
	} else {
		s.workspaces[id] = data
	}
	return nil
}

// Con 10 buffer sporchi in un progetto, una modifica riscrive solo quel progetto: il costo di ogni
// snapshot non cresce con il lavoro non salvato degli altri workspace.
func TestRecoveryWritesOnlyTheTouchedWorkspace(t *testing.T) {
	store := &workspaceMemoryStore{workspaces: map[string][]byte{}}
	manager := NewRecoveryManager(store)
	manager.BindWorkspace("a", "ws-a")
	manager.BindWorkspace("b", "ws-b")
	big := strings.Repeat("y", 512*1024)
	for file := 0; file < 10; file++ {
		if err := manager.Remember("b", fmt.Sprintf("b%d.go", file), big, ""); err != nil {
			t.Fatal(err)
		}
	}
	store.writes = nil
	if err := manager.Remember("a", "main.go", "package main", ""); err != nil {
		t.Fatal(err)
	}
	if len(store.writes) != 1 || store.writes[0] != "ws-a" || len(store.workspaces["ws-a"]) > 4096 {
		t.Fatalf("scritture %v, ws-a %d byte", store.writes, len(store.workspaces["ws-a"]))
	}

	restored := NewRecoveryManager(&workspaceMemoryStore{workspaces: store.workspaces})
	if err := restored.Load(); err != nil {
		t.Fatal(err)
	}
	if len(restored.List("a")) != 1 || len(restored.List("b")) != 10 {
		t.Fatalf("recupero incompleto: a=%d b=%d", len(restored.List("a")), len(restored.List("b")))
	}

	if err := manager.Forget("a", "main.go"); err != nil {
		t.Fatal(err)
	}
	if _, kept := store.workspaces["ws-a"]; kept {
		t.Fatal("un workspace senza buffer deve sparire dallo store")
	}
}

// Lo store unico delle versioni precedenti migra nei workspace al primo avvio e poi si svuota.
func TestRecoveryMigratesLegacyStoreIntoWorkspaces(t *testing.T) {
	legacyManager := NewRecoveryManager(&memoryStore{})
	legacyManager.BindWorkspace("s", "ws-old")
	if err := legacyManager.Remember("s", "main.go", "package main // dirty", ""); err != nil {
		t.Fatal(err)
	}
	legacy, _ := json.Marshal(recoveryState{Version: RecoverySchemaVersion, Buffers: legacyManager.List("s")})

	store := &workspaceMemoryStore{legacy: legacy, workspaces: map[string][]byte{}}
	manager := NewRecoveryManager(store)
	if err := manager.Load(); err != nil {
		t.Fatal(err)
	}
	if len(store.legacy) != 0 || len(store.workspaces["ws-old"]) == 0 {
		t.Fatalf("migrazione incompleta: legacy %d byte, workspace %v", len(store.legacy), store.writes)
	}
	if entries := manager.List("s"); len(entries) != 1 || entries[0].Content != "package main // dirty" {
		t.Fatalf("buffer perso nella migrazione: %+v", entries)
	}
}
