package codestudio

import (
	"encoding/json/v2"
	"os"
	"path/filepath"
	"sync"
	"testing"
	"time"
)

// memorySessionViewStore aggiunge chiavi per sessione al memoryStore.
type memorySessionViewStore struct {
	memoryStore
	mu        sync.Mutex
	views     map[SessionID][]byte
	viewSaves int
}

func (s *memorySessionViewStore) LoadSessionViews() (map[SessionID][]byte, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	views := make(map[SessionID][]byte, len(s.views))
	for id, data := range s.views {
		views[id] = append([]byte(nil), data...)
	}
	return views, nil
}

func (s *memorySessionViewStore) SaveSessionView(sessionID SessionID, data []byte) error {
	s.mu.Lock()
	defer s.mu.Unlock()
	if s.views == nil {
		s.views = make(map[SessionID][]byte)
	}
	s.views[sessionID] = append([]byte(nil), data...)
	s.viewSaves++
	return nil
}

func (s *memorySessionViewStore) DeleteSessionView(sessionID SessionID) error {
	s.mu.Lock()
	defer s.mu.Unlock()
	delete(s.views, sessionID)
	return nil
}

func openViewProject(t *testing.T, service *Service) Session {
	t.Helper()
	root := t.TempDir()
	if err := os.WriteFile(filepath.Join(root, "go.mod"), []byte("module example.test/views\n"), 0o600); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(root, "main.go"), []byte("package main\n"), 0o600); err != nil {
		t.Fatal(err)
	}
	session, err := service.OpenProject(root)
	if err != nil {
		t.Fatal(err)
	}
	return session
}

func TestSaveSessionViewWritesOnlyItsOwnKey(t *testing.T) {
	store := &memorySessionViewStore{}
	service := NewService(store, nil)
	t.Cleanup(service.Shutdown)
	session := openViewProject(t, service)

	stateBefore, err := store.Load()
	if err != nil {
		t.Fatal(err)
	}
	view := SessionView{OpenPaths: []string{"main.go"}, ActivePath: "main.go"}
	if err := service.SaveSessionView(string(session.ID), view); err != nil {
		t.Fatal(err)
	}
	stateAfter, err := store.Load()
	if err != nil {
		t.Fatal(err)
	}
	if string(stateBefore) != string(stateAfter) {
		t.Fatal("saving one session view rewrote the complete state snapshot")
	}
	store.mu.Lock()
	saved, ok := store.views[session.ID]
	saves := store.viewSaves
	store.mu.Unlock()
	if !ok || saves != 1 {
		t.Fatalf("per-session key not written: %v saves", saves)
	}
	var restored SessionView
	if err := json.Unmarshal(saved, &restored); err != nil {
		t.Fatal(err)
	}
	if len(restored.OpenPaths) != 1 || restored.OpenPaths[0] != "main.go" {
		t.Fatalf("persisted view = %#v", restored)
	}

	// A new service restores the per-session layout over the mirrored snapshot.
	restoredService := NewService(store, nil)
	t.Cleanup(restoredService.Shutdown)
	got, err := restoredService.GetSessionView(string(session.ID))
	if err != nil {
		t.Fatal(err)
	}
	if got.ActivePath != "main.go" {
		t.Fatalf("restored view = %#v", got)
	}

	if err := restoredService.CloseSession(string(session.ID)); err != nil {
		t.Fatal(err)
	}
	store.mu.Lock()
	_, exists := store.views[session.ID]
	store.mu.Unlock()
	if exists {
		t.Fatal("closed session kept its persisted layout")
	}
}

func TestSaveSessionViewFallsBackToTheStateSnapshot(t *testing.T) {
	store := &memoryStore{}
	service := NewService(store, nil)
	t.Cleanup(service.Shutdown)
	session := openViewProject(t, service)

	stateBefore, err := store.Load()
	if err != nil {
		t.Fatal(err)
	}
	if err := service.SaveSessionView(string(session.ID), SessionView{ActivePath: "main.go"}); err != nil {
		t.Fatal(err)
	}
	stateAfter, err := store.Load()
	if err != nil {
		t.Fatal(err)
	}
	if string(stateBefore) == string(stateAfter) {
		t.Fatal("a store without per-session keys must persist the view in the state snapshot")
	}
	var state persistedState
	if err := json.Unmarshal(stateAfter, &state); err != nil {
		t.Fatal(err)
	}
	if state.SessionUI[session.ID].ActivePath != "main.go" {
		t.Fatalf("mirrored view = %#v", state.SessionUI)
	}
}

func TestRecentAvailabilityIsCachedAndBounded(t *testing.T) {
	service := NewService(&memoryStore{}, nil)
	t.Cleanup(service.Shutdown)
	previousTTL := recentCheckTTL
	t.Cleanup(func() { recentCheckTTL = previousTTL })
	recentCheckTTL = time.Minute

	root := t.TempDir()
	if !service.recentAvailability(root) {
		t.Fatal("existing directory reported unavailable")
	}
	if err := os.RemoveAll(root); err != nil {
		t.Fatal(err)
	}
	if !service.recentAvailability(root) {
		t.Fatal("availability must stay cached until the TTL expires")
	}

	recentCheckTTL = 0
	if service.recentAvailability(root) {
		t.Fatal("expired cache entry must be re-checked")
	}

	for index := range maxRecentProjects + 5 {
		service.recentAvailability(filepath.Join(root, "gone", string(rune('a'+index%26)), string(rune('a'+index/26))))
	}
	service.recentChecks.mu.Lock()
	size := len(service.recentChecks.known)
	service.recentChecks.mu.Unlock()
	if size > maxRecentProjects {
		t.Fatalf("availability cache holds %d entries, want at most %d", size, maxRecentProjects)
	}
}
