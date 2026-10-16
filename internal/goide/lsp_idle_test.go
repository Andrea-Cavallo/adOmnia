package goide

import (
	"adomnia/internal/activity"
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
	// An active detached window must prevent suspension of its workspace.
	manager.activity.Report("detached", activity.Active, []string{"goide:" + string(session.ID)})
	state.mu.Lock()
	activeEpoch := state.idleEpoch
	state.mu.Unlock()
	manager.suspendIdle(state, activeEpoch)
	if manager.Status(session.ID, golang.ID).PID != first.PID {
		t.Fatal("visible workspace was suspended")
	}
	manager.activity.Report("detached", activity.Background, nil)
	// Explicit starts are protected even with no open editor.
	state.mu.Lock()
	state.userInitiated = true
	activeEpoch = state.idleEpoch
	state.mu.Unlock()
	manager.suspendIdle(state, activeEpoch)
	if manager.Status(session.ID, golang.ID).PID != first.PID {
		t.Fatal("explicit server was suspended")
	}
	restarted, restartErr := manager.Restart(session, options)
	if restartErr != nil || restarted.PID == 0 {
		t.Fatalf("restart explicit server: %v", restartErr)
	}
	first = restarted
	state.mu.Lock()
	pinnedAfterRestart := state.userInitiated
	state.mu.Unlock()
	if !pinnedAfterRestart {
		t.Fatal("automatic restart lost explicit intent")
	}
	state.mu.Lock()
	state.userInitiated = false
	state.mu.Unlock()

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
	if manager.activity.State("goide:"+string(session.ID)) != activity.Suspended {
		t.Fatal("released server not reported Suspended")
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

func TestUserLanguageServerEntryPointsPinBeforeLaunch(t *testing.T) {
	root := t.TempDir()
	writeFixtureFile(t, root, "go.mod", "module example.test/intent\n\ngo 1.26\n")
	service := NewService(&memoryStore{}, nil)
	t.Cleanup(service.Shutdown)
	session, err := service.OpenProject(root)
	if err != nil {
		t.Fatal(err)
	}
	// Tool authorization is deliberately absent: no external process can launch.
	if _, err := service.StartLanguageServerFromUser(string(session.ID), LanguageServerSettings{}); err == nil {
		t.Fatal("untrusted tools launched")
	}
	state, ok := service.lsp.server(session.ID, golang.ID)
	if !ok {
		t.Fatal("explicit intent was not registered")
	}
	state.mu.Lock()
	pinned := state.userInitiated
	state.mu.Unlock()
	if !pinned {
		t.Fatal("user start was not protected")
	}
	service.lsp.Stop(session.ID, golang.ID)
	state.mu.Lock()
	pinned = state.userInitiated
	state.mu.Unlock()
	if pinned {
		t.Fatal("stop did not clear explicit intent")
	}
	if _, err := service.RestartLanguageServerFromUser(string(session.ID), LanguageServerSettings{}); err == nil {
		t.Fatal("untrusted restart launched tools")
	}
	state.mu.Lock()
	pinned = state.userInitiated
	state.mu.Unlock()
	if !pinned {
		t.Fatal("user restart was not protected")
	}
}
