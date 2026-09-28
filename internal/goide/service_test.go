package goide

import (
	"os"
	"path/filepath"
	"strings"
	"sync"
	"testing"
)

type memoryStore struct {
	mu   sync.Mutex
	data []byte
}

func (s *memoryStore) Load() ([]byte, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	return append([]byte(nil), s.data...), nil
}

func (s *memoryStore) Save(data []byte) error {
	s.mu.Lock()
	s.data = append([]byte(nil), data...)
	s.mu.Unlock()
	return nil
}

func TestServicePersistsAuthorizationWithoutExecutingProject(t *testing.T) {
	root := t.TempDir()
	marker := filepath.Join(root, "must-not-exist")
	if err := os.WriteFile(filepath.Join(root, "go.mod"), []byte("module example.test/service\n"), 0o600); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(root, "main.go"), []byte("package main\n// execution would create must-not-exist\n"), 0o600); err != nil {
		t.Fatal(err)
	}

	store := &memoryStore{}
	var events []EventEnvelope
	service := NewService(store, func(event EventEnvelope) { events = append(events, event) })
	t.Cleanup(service.Shutdown)
	session, err := service.OpenProject(root)
	if err != nil {
		t.Fatal(err)
	}
	if _, err := os.Stat(marker); !os.IsNotExist(err) {
		t.Fatalf("opening the project produced an unexpected marker: %v", err)
	}
	if len(events) != 1 || events[0].Type != "session.opened" || events[0].SessionID != session.ID || events[0].Sequence != 1 {
		t.Fatalf("unexpected open event: %#v", events)
	}

	authorized, err := service.SetToolAuthorization(string(session.ID), true)
	if err != nil {
		t.Fatal(err)
	}
	if authorized.Project.Authorization != AuthorizationPermitted {
		t.Fatalf("authorization = %q", authorized.Project.Authorization)
	}
	if len(events) != 2 || events[1].Sequence != 2 || events[1].SessionID != session.ID {
		t.Fatalf("unexpected authorization event: %#v", events)
	}

	restored := NewService(store, nil)
	t.Cleanup(restored.Shutdown)
	sessions, err := restored.ListSessions()
	if err != nil {
		t.Fatal(err)
	}
	if len(sessions) != 1 || sessions[0].Project.Authorization != AuthorizationPermitted {
		t.Fatalf("unexpected restored sessions: %#v", sessions)
	}
}

func TestPersistenceRejectsFutureSchema(t *testing.T) {
	store := &memoryStore{data: []byte(`{"version":999,"sessions":[]}`)}
	service := NewService(store, nil)
	t.Cleanup(service.Shutdown)
	if _, err := service.ListSessions(); err == nil {
		t.Fatal("expected future schema to be rejected")
	}
}

func TestRunPathsStayInsideProjectAndMetadataOmitsSensitiveValues(t *testing.T) {
	root := t.TempDir()
	service := NewService(&memoryStore{}, nil)
	t.Cleanup(service.Shutdown)
	session, err := service.OpenProject(root)
	if err != nil {
		t.Fatal(err)
	}
	if _, err = service.SetToolAuthorization(string(session.ID), true); err != nil {
		t.Fatal(err)
	}
	if _, err = service.StartRun(RunRequest{SessionID: session.ID, Kind: "build", Target: "../outside"}); err == nil {
		t.Fatal("target esterno accettato")
	}
	if _, err = service.StartRun(RunRequest{SessionID: session.ID, Kind: "build", Target: ".", GoArguments: []string{"-o", "../outside.exe"}}); err == nil {
		t.Fatal("output esterno accettato")
	}
	execution, err := service.StartRun(RunRequest{
		SessionID: session.ID, Kind: "run", Target: ".",
		ProgramArguments: []string{"--token", "secret-value"},
		Environment:      map[string]string{"PRIVATE_TOKEN": "secret-value"},
	})
	if err != nil {
		t.Fatal(err)
	}
	if strings.Contains(execution.Command, "secret-value") || !strings.Contains(execution.Command, "<2 program args>") {
		t.Fatalf("metadati comando non sicuri: %q", execution.Command)
	}
}
