package codestudio

import (
	"context"
	"os"
	"testing"
	"time"

	"github.com/Andrea-Cavallo/adOmnia/internal/activity"
	"github.com/Andrea-Cavallo/adOmnia/internal/languages/golang"
	"github.com/Andrea-Cavallo/adOmnia/internal/resources"
)

func budgetServer(t *testing.T, manager *LSPManager, id string, now time.Time) (*lspSession, int) {
	t.Helper()
	binary, err := os.Executable()
	if err != nil {
		t.Fatal(err)
	}
	root := t.TempDir()
	t.Cleanup(func() { manager.CloseSession(SessionID(id)) })
	session := Session{ID: SessionID(id), Project: Project{Name: id, RootPath: root, RealPath: root}}
	status, err := manager.Start(session, LanguageServerOptions{Language: golang.ID, Binary: binary, Environment: append(os.Environ(), fakeGoplsEnv+"=1", "ADOMNIA_FAKE_LSP_SLOW=1")})
	if err != nil {
		t.Fatal(err)
	}
	state, _ := manager.server(session.ID, golang.ID)
	state.mu.Lock()
	state.startedAt = now.Add(-time.Hour)
	state.inactiveSince = now.Add(-time.Minute)
	state.mu.Unlock()
	return state, status.PID
}

func TestGlobalMemoryBudgetReclaimsOldestWithoutTouchingActiveOrPinned(t *testing.T) {
	manager := NewLSPManager(newLanguageRegistry())
	t.Cleanup(manager.Shutdown)
	now := time.Now()
	old, oldPID := budgetServer(t, manager, "old", now)
	_, warmPID := budgetServer(t, manager, "warm", now)
	_, activePID := budgetServer(t, manager, "active", now)
	pinned, pinnedPID := budgetServer(t, manager, "pinned", now)
	old.mu.Lock()
	old.inactiveSince = now.Add(-time.Hour)
	old.mu.Unlock()
	pinned.mu.Lock()
	pinned.userInitiated = true
	pinned.mu.Unlock()
	manager.activity.Report("detached", activity.Active, []string{"code-studio:active"})
	sample := resources.Snapshot{RAM: 1500, Processes: []resources.Usage{}}
	for _, pid := range []int{oldPID, warmPID, activePID, pinnedPID} {
		sample.Processes = append(sample.Processes, resources.Usage{PID: pid, RAM: 300})
	}
	policy := resources.NewMemoryBudget(1000)
	manager.enforceMemoryBudget(policy, sample, now)
	if manager.Status("old", golang.ID).PID != 0 {
		t.Fatal("oldest inactive process survived pressure")
	}
	for _, id := range []SessionID{"warm", "active", "pinned"} {
		if manager.Status(id, golang.ID).PID == 0 {
			t.Fatalf("%s was also terminated", id)
		}
	}
	manager.enforceMemoryBudget(policy, sample, now.Add(time.Second))
	if manager.Status("warm", golang.ID).PID != warmPID {
		t.Fatal("budget released multiple resources before resampling/cooldown")
	}
	manager.enforceMemoryBudget(policy, resources.Snapshot{RAM: 700}, now.Add(time.Minute))
	if policy.Status().Pressure || policy.Status().Released != 1 {
		t.Fatalf("budget did not recover: %+v", policy.Status())
	}
	// Wake still uses the existing preserved-overlay path.
	manager.activity.Report("main", activity.Active, []string{"code-studio:old"})
	deadline := time.Now().Add(5 * time.Second)
	for time.Now().Before(deadline) && manager.Status("old", golang.ID).State != LanguageServerReady {
		time.Sleep(10 * time.Millisecond)
	}
	if status := manager.Status("old", golang.ID); status.PID == 0 || status.PID == oldPID {
		t.Fatalf("budget victim failed to wake: %+v", status)
	}
}

func TestGlobalMemoryBudgetDefersBusyServer(t *testing.T) {
	manager := NewLSPManager(newLanguageRegistry())
	t.Cleanup(manager.Shutdown)
	now := time.Now()
	state, pid := budgetServer(t, manager, "busy", now)
	state.mu.Lock()
	conn := state.process.conn
	state.mu.Unlock()
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()
	done := make(chan error, 1)
	go func() { done <- conn.Call(ctx, "workspace/symbol", map[string]any{"query": "x"}, nil) }()
	deadline := time.Now().Add(time.Second)
	for conn.PendingRequests() == 0 && time.Now().Before(deadline) {
		time.Sleep(time.Millisecond)
	}
	if conn.PendingRequests() == 0 {
		t.Fatal("fixture did not start a request")
	}
	manager.enforceMemoryBudget(resources.NewMemoryBudget(1), resources.Snapshot{RAM: 1000, Processes: []resources.Usage{{PID: pid, RAM: 999}}}, now)
	if manager.Status("busy", golang.ID).PID != pid {
		t.Fatal("budget interrupted an in-flight operation")
	}
	if err := <-done; err != nil {
		t.Fatal(err)
	}
}

func TestMemoryBudgetMonitorStopsWithService(t *testing.T) {
	service := NewService(&memoryStore{}, nil)
	service.EnableMemoryBudget(1024 * resources.MiB)
	budget := service.lsp.memoryBudget
	service.Shutdown()
	service.Shutdown()
	select {
	case <-budget.done:
	default:
		t.Fatal("memory controller survived shutdown")
	}
}

func TestMemoryBudgetMonitorReleasesProcessWithoutVisibleResourcePanel(t *testing.T) {
	service := NewService(&memoryStore{}, nil)
	t.Cleanup(service.Shutdown)
	// Deliberately tiny target triggers pressure using a real process-tree sample.
	service.EnableMemoryBudget(1)
	state, pid := budgetServer(t, service.lsp, "background-budget", time.Now())
	state.mu.Lock()
	old := time.Now().Add(-time.Minute)
	state.inactiveSince, state.startedAt = old, old
	state.mu.Unlock()
	deadline := time.Now().Add(8 * time.Second)
	for time.Now().Before(deadline) {
		service.lsp.signalMemoryBudget()
		if service.lsp.Status("background-budget", golang.ID).PID == 0 && service.lsp.memoryBudget.policy.Status().Released == 1 {
			return
		}
		time.Sleep(25 * time.Millisecond)
	}
	t.Fatalf("controller did not release background PID %d: %+v", pid, service.lsp.memoryBudget.policy.Status())
}
