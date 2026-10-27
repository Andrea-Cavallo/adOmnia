package codestudio

import (
	"fmt"
	"io"
	"os"
	"os/exec"
	"strings"
	"testing"
	"time"

	"github.com/Andrea-Cavallo/adOmnia/internal/ide/lsp"
	"github.com/Andrea-Cavallo/adOmnia/internal/languages/golang"
)

func TestStopLanguageServerWhenTreeKillFails(t *testing.T) {
	manager := NewLSPManager(newLanguageRegistry())
	command := exec.Command(os.Args[0], "-test.run=^TestGoIDEManagedChildrenHelper$")
	command.Env = append(os.Environ(), "ADOMNIA_GOIDE_MANAGED_HELPER=1")
	configureProcess(command, false)
	if err := command.Start(); err != nil {
		t.Fatal(err)
	}
	exited := make(chan struct{})
	go func() { _ = command.Wait(); close(exited) }()
	t.Cleanup(func() { _ = command.Process.Kill(); <-exited })
	original := terminateProcessTree
	terminateProcessTree = func(*exec.Cmd) error { return fmt.Errorf("injected tree kill failure") }
	t.Cleanup(func() { terminateProcessTree = original })
	conn := lsp.NewConn(strings.NewReader(""), io.Discard, nil)
	conn.Run() // Closed transport: shutdown cannot stop the sleeping child.
	state := &lspSession{process: &serverProcess{command: command, stdin: nopWriteCloser{io.Discard}, conn: conn, exited: exited}}
	done := make(chan struct{})
	go func() { manager.stopLocked(state); close(done) }()
	select {
	case <-done:
	case <-time.After(3 * shutdownTimeout):
		_ = command.Process.Kill()
		<-done
		t.Fatal("stop hung after tree termination failed")
	}
	select {
	case <-exited:
	default:
		t.Fatal("direct child survived fallback")
	}
	if !strings.Contains(strings.Join(state.log, "\n"), "injected tree kill failure") {
		t.Fatal("termination error was lost")
	}
}

type nopWriteCloser struct{ io.Writer }

func (nopWriteCloser) Close() error { return nil }

func TestStopLanguageServerBoundsFinalWait(t *testing.T) {
	manager := NewLSPManager(newLanguageRegistry())
	original := terminateProcessTree
	terminateProcessTree = func(*exec.Cmd) error { return nil }
	t.Cleanup(func() { terminateProcessTree = original })
	exited := make(chan struct{})
	conn := lsp.NewConn(strings.NewReader(""), io.Discard, nil)
	conn.Run()
	state := &lspSession{process: &serverProcess{command: &exec.Cmd{}, stdin: nopWriteCloser{io.Discard}, conn: conn, exited: exited}}
	done := make(chan struct{})
	go func() { manager.stopLocked(state); close(done) }()
	select {
	case <-done:
		close(exited)
	case <-time.After(3 * shutdownTimeout):
		close(exited)
		<-done
		t.Fatal("stop waited indefinitely for process exit")
	}
	if state.status.State != LanguageServerCrashed {
		t.Fatalf("unconfirmed exit reported as %s", state.status.State)
	}
}

func TestStopLanguageServerWhenProtocolWriteBlocks(t *testing.T) {
	manager := NewLSPManager(newLanguageRegistry())
	reader, writer := io.Pipe()
	defer reader.Close()
	defer writer.Close()
	exited := make(chan struct{})
	close(exited)
	// No reader consumes shutdown: the protocol write must be interrupted by closing stdin.
	conn := lsp.NewConn(strings.NewReader(""), writer, nil)
	state := &lspSession{process: &serverProcess{command: &exec.Cmd{}, stdin: writer, conn: conn, exited: exited}}
	done := make(chan struct{})
	go func() { manager.stopLocked(state); close(done) }()
	select {
	case <-done:
	case <-time.After(3 * shutdownTimeout):
		_ = writer.Close()
		<-done
		t.Fatal("shutdown blocked on an unread protocol pipe")
	}
}

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
