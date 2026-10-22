package codestudio

import (
	"adomnia/internal/activity"
	"adomnia/internal/ide/language"
	"adomnia/internal/languages/golang"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"
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
	_, _ = manager.activity.Report("detached", activity.Active, []string{"code-studio:" + string(session.ID)})
	state.mu.Lock()
	activeEpoch := state.idleEpoch
	state.mu.Unlock()
	manager.suspendIdle(state, activeEpoch)
	if manager.Status(session.ID, golang.ID).PID != first.PID {
		t.Fatal("visible workspace was suspended")
	}
	_, _ = manager.activity.Report("detached", activity.Background, nil)
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
	_, _ = manager.activity.Report("main", activity.Active, []string{"code-studio:" + string(session.ID)})
	manager.TrackDocument(session, document, "package main", false)
	state.mu.Lock()
	epoch := state.idleEpoch
	state.mu.Unlock()
	manager.suspendIdle(state, epoch)
	if manager.Status(session.ID, golang.ID).PID != first.PID {
		t.Fatal("open editor was suspended")
	}
	manager.UntrackDocument(session.ID, document.ID)
	_, _ = manager.activity.Report("main", activity.Background, nil)
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
	if manager.activity.State("code-studio:"+string(session.ID)) != activity.Suspended {
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

func TestHibernateLanguageServerReplaysDirtyBuffersOnWindowReturn(t *testing.T) {
	manager := NewLSPManager(newLanguageRegistry())
	t.Cleanup(manager.Shutdown)
	root := t.TempDir()
	binary, err := os.Executable()
	if err != nil {
		t.Fatal(err)
	}
	session := Session{ID: "hibernate", Project: Project{Name: "hibernate", RootPath: root, RealPath: root}}
	options := LanguageServerOptions{Language: golang.ID, Binary: binary, Environment: append(os.Environ(), fakeGoplsEnv+"=1", "ADOMNIA_FAKE_LSP_LOG_BUFFERS=1")}
	_, _ = manager.activity.Report("main", activity.Active, []string{"code-studio:hibernate"})
	first, err := manager.Start(session, options)
	if err != nil {
		t.Fatal(err)
	}
	doc := Document{ID: "dirty", Path: filepath.Join(root, "main.go"), URI: fileURI(filepath.Join(root, "main.go"))}
	manager.TrackDocument(session, doc, "package main", false)
	if err := manager.UpdateDocument(session.ID, doc.ID, 7, "package main // unsaved"); err != nil {
		t.Fatal(err)
	}
	state, _ := manager.server(session.ID, golang.ID)
	_, _ = manager.activity.Report("main", activity.Background, nil)
	state.mu.Lock()
	epoch := state.idleEpoch
	inactiveSince := state.inactiveSince
	state.mu.Unlock()
	if inactiveSince.IsZero() {
		t.Fatal("open buffer kept the project marked active")
	}
	// Unrelated window reports must not reset this project's inactivity.
	_, _ = manager.activity.Report("other", activity.Active, []string{"collections"})
	state.mu.Lock()
	same := state.idleEpoch == epoch && state.inactiveSince.Equal(inactiveSince)
	state.mu.Unlock()
	if !same {
		t.Fatal("unrelated activity reset inactivity")
	}
	manager.suspendIdle(state, epoch)
	if status := manager.Status(session.ID, golang.ID); status.PID != 0 {
		t.Fatalf("server survived hibernation: %+v", status)
	}
	// Background buffer updates are retained without waking a process.
	if err := manager.UpdateDocument(session.ID, doc.ID, 8, "package main // latest"); err != nil {
		t.Fatal(err)
	}
	if manager.Status(session.ID, golang.ID).PID != 0 {
		t.Fatal("background edit woke server")
	}
	_, _ = manager.activity.Report("detached", activity.Active, []string{"code-studio:hibernate"})
	deadline := time.Now().Add(5 * time.Second)
	for time.Now().Before(deadline) {
		status := manager.Status(session.ID, golang.ID)
		log := strings.Join(manager.Log(session.ID, golang.ID), "\n")
		if status.State == LanguageServerReady && status.PID != first.PID && strings.Contains(log, "BUFFER 8 package main // latest") {
			break
		}
		time.Sleep(10 * time.Millisecond)
	}
	if log := strings.Join(manager.Log(session.ID, golang.ID), "\n"); !strings.Contains(log, "BUFFER 8 package main // latest") {
		t.Fatalf("dirty buffer not replayed: %s", log)
	}
	manager.Stop(session.ID, golang.ID)
	_, _ = manager.activity.Report("detached", activity.Active, []string{"code-studio:hibernate"})
	state.lifecycle.Lock()
	state.lifecycle.Unlock() //nolint:staticcheck // deliberate barrier: waits for an in-flight lifecycle operation
	if manager.Status(session.ID, golang.ID).PID != 0 {
		t.Fatal("activity overrode manual stop")
	}
	// Close may race an already queued wake; it must still reap the process and
	// remove the state, and later window reports cannot recreate it.
	if _, err := manager.Start(session, options); err != nil {
		t.Fatal(err)
	}
	_, _ = manager.activity.Report("detached", activity.Background, nil)
	state.mu.Lock()
	epoch = state.idleEpoch
	state.mu.Unlock()
	manager.suspendIdle(state, epoch)
	_, _ = manager.activity.Report("detached", activity.Active, []string{"code-studio:hibernate"})
	manager.CloseSession(session.ID)
	_, _ = manager.activity.Report("detached", activity.Active, []string{"code-studio:hibernate"})
	state.lifecycle.Lock()
	state.mu.Lock()
	closed := state.closed && state.process == nil
	state.mu.Unlock()
	state.lifecycle.Unlock()
	if !closed {
		t.Fatal("queued wake revived a closed session")
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
