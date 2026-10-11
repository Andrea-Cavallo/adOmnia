package goide

import (
	"adomnia/internal/ide/language"
	"adomnia/internal/languages/golang"
	"os"
	"path/filepath"
	"testing"
)

func TestIdleLanguageServerResumesAndReusesProcess(t *testing.T) {
	registry := language.NewRegistry()
	_ = registry.Register(golang.New())
	manager := NewLSPManager(registry)
	binary, err := os.Executable()
	if err != nil {
		t.Fatal(err)
	}
	root := t.TempDir()
	t.Cleanup(manager.Shutdown)
	session := Session{ID: "idle", Project: Project{Name: "idle", RootPath: root, RealPath: root}}
	options := LanguageServerOptions{Language: golang.ID, Name: "gopls", Binary: binary, Environment: append(os.Environ(), fakeGoplsEnv+"=1")}
	first, err := manager.Start(session, options)
	if err != nil {
		t.Fatal(err)
	}
	again, err := manager.Start(session, options)
	if err != nil || first.PID != again.PID {
		t.Fatalf("duplicate process: %v %+v", err, again)
	}
	state, _ := manager.server(session.ID, golang.ID)
	document := Document{ID: "main", Path: filepath.Join(root, "main.go"), URI: fileURI(filepath.Join(root, "main.go"))}
	manager.TrackDocument(session, document, "package main", false)
	state.mu.Lock()
	epoch := state.idleEpoch
	state.mu.Unlock()
	manager.suspendIdle(state, epoch)
	if manager.Status(session.ID, golang.ID).PID != first.PID {
		t.Fatal("open editor was suspended")
	}
	manager.UntrackDocument(session.ID, document.ID)
	state.mu.Lock()
	epoch = state.idleEpoch
	state.mu.Unlock()
	manager.suspendIdle(state, epoch-1)
	if manager.Status(session.ID, golang.ID).PID != first.PID {
		t.Fatal("stale timer suspended server")
	}
	manager.suspendIdle(state, epoch)
	if manager.Status(session.ID, golang.ID).PID != 0 {
		t.Fatal("idle process survived")
	}
	manager.TrackDocument(session, document, "package main", false)
	resumed := manager.Status(session.ID, golang.ID)
	if resumed.State != LanguageServerReady || resumed.PID == 0 || resumed.PID == first.PID {
		t.Fatalf("did not resume: %+v", resumed)
	}
	manager.Stop(session.ID, golang.ID)
	manager.UntrackDocument(session.ID, document.ID)
	manager.TrackDocument(session, document, "package main", false)
	if manager.Status(session.ID, golang.ID).PID != 0 {
		t.Fatal("manual stop resumed automatically")
	}

}
