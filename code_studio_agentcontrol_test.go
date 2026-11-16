package main

import (
	"context"
	"errors"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"github.com/Andrea-Cavallo/adOmnia/internal/codestudio"
	"github.com/Andrea-Cavallo/adOmnia/internal/ide/agentcontrol"
	"github.com/Andrea-Cavallo/adOmnia/internal/ide/agentreview"
)

func testAgentIDE(t *testing.T) *GoIDE {
	t.Helper()
	g := &GoIDE{service: codestudio.NewService(nil, nil), agentReview: agentreview.NewTracker()}
	t.Cleanup(g.service.Shutdown)
	return g
}

func TestAgentControlRoutesRejectUnknownSessions(t *testing.T) {
	g := testAgentIDE(t)
	router := g.agentControlRouter()
	for _, language := range []string{"go", "java", "python", "rust", "c", "cpp", "typescript", "javascript", ""} {
		t.Run(language, func(t *testing.T) {
			_, err := router.Operations["ide_debug_start"](context.Background(), "missing", map[string]any{"language": language, "sessionId": "missing"})
			if err == nil || !strings.Contains(err.Error(), "session") {
				t.Fatalf("expected session rejection, got %v", err)
			}
		})
	}
	_, err := router.Operations["ide_debug_start"](context.Background(), "missing", map[string]any{"language": "unknown"})
	if err == nil || !strings.Contains(err.Error(), "unsupported debugger") {
		t.Fatalf("unsupported language: %v", err)
	}
	for _, language := range []string{"go", "java"} {
		_, err := router.Operations["ide_debug_start"](context.Background(), "missing", map[string]any{"language": language, "sessionId": []string{"invalid"}})
		if err == nil {
			t.Fatal("malformed session ID accepted")
		}
	}
	for _, operation := range []string{"ide_open_file", "ide_test_start", "ide_test_status", "ide_debug"} {
		t.Run(operation, func(t *testing.T) {
			_, err := router.Operations[operation](context.Background(), "missing", map[string]any{"sessionId": "missing", "runId": "missing"})
			if err == nil {
				t.Fatalf("%s accepted a missing session/run", operation)
			}
		})
	}
	_, err = router.Operations["ide_database_query"](context.Background(), "missing", map[string]any{})
	if err == nil || !strings.Contains(err.Error(), "required") {
		t.Fatalf("empty query: %v", err)
	}
}

func TestAgentControlBridgeLifecycleAndEventFiltering(t *testing.T) {
	config := t.TempDir()
	t.Setenv("APPDATA", config)
	t.Setenv("XDG_CONFIG_HOME", config)
	g := testAgentIDE(t)
	g.startAgentControl()
	if g.agentControl == nil {
		t.Fatal("bridge did not start")
	}
	t.Cleanup(func() { _ = g.agentControl.Close() })
	directory, err := agentcontrol.Directory()
	if err != nil {
		t.Fatal(err)
	}
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()
	_, err = agentcontrol.Call(ctx, directory, agentcontrol.Request{Project: t.TempDir(), Operation: "ide_status"})
	if err == nil || !strings.Contains(err.Error(), "not open") {
		t.Fatalf("closed project accepted: %v", err)
	}
	if err := g.ServiceShutdown(); err != nil {
		t.Fatal(err)
	}
	files, err := os.ReadDir(directory)
	if err != nil || len(files) != 0 {
		t.Fatalf("discovery entry survived shutdown: %v %v", files, err)
	}
}

func TestAgentControlFiltersServiceEvents(t *testing.T) {
	g := testAgentIDE(t)
	router := g.agentControlRouter()
	ctx := context.Background()
	root := t.TempDir()
	session, err := g.service.OpenProject(root)
	if err != nil {
		t.Fatal(err)
	}
	for _, kind := range []string{"run.output", "debug.output", "run.finished", "document.saved"} {
		g.serviceListeners[len(g.serviceListeners)-1](codestudio.EventEnvelope{Type: kind, SessionID: session.ID})
	}
	value, err := router.Handle(ctx, agentcontrol.Request{Project: root, Operation: "ide_logs"})
	if err != nil {
		t.Fatal(err)
	}
	rows, ok := value.([]any)
	if !ok || len(rows) != 3 {
		t.Fatalf("expected only execution events, got %#v", value)
	}
}

func TestApplyAgentReviewSelectionBinding(t *testing.T) {
	root := t.TempDir()
	path := filepath.Join(root, "example.txt")
	write := func(content string) {
		t.Helper()
		if err := os.WriteFile(path, []byte(content), 0o600); err != nil {
			t.Fatal(err)
		}
	}
	g := testAgentIDE(t)
	write("before\n")
	end := g.agentReview.BeginTurn(root, "test agent")
	write("after\n")
	end()
	if err := g.ApplyAgentReviewSelection(root, "example.txt", "partial\n", "before\n", "stale\n", false, string(agentreview.StatusModified)); !errors.Is(err, agentreview.ErrStale) {
		t.Fatalf("stale disk accepted: %v", err)
	}
	if err := g.ApplyAgentReviewSelection(root, "example.txt", "partial\n", "before\n", "after\n", true, string(agentreview.StatusModified)); err != nil {
		t.Fatal(err)
	}
	disk, err := os.ReadFile(path)
	if err != nil || string(disk) != "after\n" {
		t.Fatalf("accept changed disk: %q %v", disk, err)
	}
	if err := g.ApplyAgentReviewSelection(root, "example.txt", "partial\n", "partial\n", "after\n", false, string(agentreview.StatusModified)); err != nil {
		t.Fatal(err)
	}
	disk, err = os.ReadFile(path)
	if err != nil || string(disk) != "partial\n" {
		t.Fatalf("reject did not preserve accepted text: %q %v", disk, err)
	}
	if len(g.AgentReview(root).Files) != 0 {
		t.Fatal("resolved review still pending")
	}
}
