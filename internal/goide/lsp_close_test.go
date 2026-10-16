package goide

import (
	"os"
	"testing"
	"time"

	"adomnia/internal/languages/golang"
)

func TestCloseLanguageServerDuringCrashBackoff(t *testing.T) {
	manager := NewLSPManager(newLanguageRegistry())
	t.Cleanup(manager.Shutdown)
	binary, err := os.Executable()
	if err != nil {
		t.Fatal(err)
	}
	root := t.TempDir()
	session := Session{ID: "closing", Project: Project{Name: "closing", RootPath: root, RealPath: root}}
	status, err := manager.Start(session, LanguageServerOptions{Language: golang.ID, Binary: binary, Environment: append(os.Environ(), fakeGoplsEnv+"=1")})
	if err != nil {
		t.Fatal(err)
	}
	state, _ := manager.server(session.ID, golang.ID)
	state.mu.Lock()
	child := state.process
	state.mu.Unlock()
	if err := child.command.Process.Kill(); err != nil {
		t.Fatal(err)
	}
	select {
	case <-child.exited:
	case <-time.After(5 * time.Second):
		t.Fatal("crashed server did not exit")
	}
	manager.CloseSession(session.ID)
	time.Sleep(1500 * time.Millisecond)
	state.mu.Lock()
	defer state.mu.Unlock()
	if !state.closed || state.process != nil || state.launching || state.status.PID != 0 {
		t.Fatalf("closed server restarted after PID %d: %+v", status.PID, state.status)
	}
	if _, found := manager.server(session.ID, golang.ID); found {
		t.Fatal("closed session retained")
	}
}

func TestCrashRestartUsesLifecycleLock(t *testing.T) {
	manager := NewLSPManager(newLanguageRegistry())
	t.Cleanup(manager.Shutdown)
	binary, err := os.Executable()
	if err != nil {
		t.Fatal(err)
	}
	root := t.TempDir()
	session := Session{ID: "serialized", Project: Project{Name: "serialized", RootPath: root, RealPath: root}}
	_, err = manager.Start(session, LanguageServerOptions{Language: golang.ID, Binary: binary, Environment: append(os.Environ(), fakeGoplsEnv+"=1")})
	if err != nil {
		t.Fatal(err)
	}
	state, _ := manager.server(session.ID, golang.ID)
	state.lifecycle.Lock()
	// Simulate another lifecycle operation holding the lock during backoff.
	defer state.lifecycle.Unlock()
	state.mu.Lock()
	child := state.process
	state.mu.Unlock()
	if err := child.command.Process.Kill(); err != nil {
		t.Fatal(err)
	}
	select {
	case <-child.exited:
	case <-time.After(5 * time.Second):
		t.Fatal("crashed server did not exit")
	}
	time.Sleep(1500 * time.Millisecond)
	state.mu.Lock()
	defer state.mu.Unlock()
	if state.process != nil || state.launching {
		t.Fatal("crash restart bypassed lifecycle lock")
	}
	// Cancel before releasing the lifecycle lock so cleanup cannot race a restart.
	state.closed = true
	state.stopping = true
}
