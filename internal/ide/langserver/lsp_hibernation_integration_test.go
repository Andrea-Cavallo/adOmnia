package langserver

import (
	"context"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"github.com/Andrea-Cavallo/adOmnia/internal/activity"
	"github.com/Andrea-Cavallo/adOmnia/internal/ide/lsp"
	"github.com/Andrea-Cavallo/adOmnia/internal/resources"
	"github.com/shirou/gopsutil/v4/process"
)

func TestHibernateRealGoplsRestoresUnsavedOverlay(t *testing.T) {
	testHibernateRealGopls(t, false)
}

func TestGlobalBudgetRealGoplsRestoresUnsavedOverlay(t *testing.T) {
	testHibernateRealGopls(t, true)
}

func testHibernateRealGopls(t *testing.T, budgetPressure bool) {
	binary := findGoplsForTest(t)
	root := t.TempDir()
	writeFixtureFile(t, root, "go.mod", "module example.test/hibernate\n\ngo 1.26\n")
	writeFixtureFile(t, root, "main.go", "package main\nconst HibernateMarker = 1\nfunc main() {}\n")
	manager := NewLSPManager(newLanguageRegistry())
	t.Cleanup(manager.Shutdown)
	session := Session{ID: "real-hibernate", Project: Project{Name: "hibernate", RootPath: root, RealPath: root}}
	manager.activity.Report("main", activity.Active, []string{"code-studio:real-hibernate"})
	options := goplsSpec(binary, os.Environ(), 0)
	status, err := manager.Start(session, options)
	if err != nil {
		t.Fatal(err)
	}
	p, err := process.NewProcess(int32(status.PID))
	if err != nil {
		t.Fatal(err)
	}
	path := filepath.Join(root, "main.go")
	doc := Document{ID: "main", Path: path, URI: lsp.FileURI(path)}
	text := "package main\nconst HibernateMarker = \"unsaved-overlay\"\nfunc main() {}\n"
	manager.TrackDocument(session, doc, text, false)
	ctx, cancel := context.WithTimeout(context.Background(), time.Minute)
	defer cancel()
	if _, err := manager.Hover(ctx, session.ID, doc.ID, 2, 9); err != nil {
		t.Fatal(err)
	}
	memory, err := p.MemoryInfo()
	if err != nil {
		t.Fatal(err)
	}
	state, _ := manager.server(session.ID, goID)
	manager.activity.Report("main", activity.Background, nil)
	state.mu.Lock()
	epoch := state.idleEpoch
	state.mu.Unlock()
	if budgetPressure {
		sample := resources.Sample([]resources.Target{{PID: status.PID, Name: "gopls"}})
		now := time.Now()
		// Advance residency/inactivity at the owner seam without a 30 s test sleep.
		state.mu.Lock()
		state.inactiveSince, state.startedAt = now.Add(-time.Minute), now.Add(-time.Minute)
		state.mu.Unlock()
		policy := resources.NewMemoryBudget(max(1, sample.RAM/2))
		manager.enforceMemoryBudget(policy, sample, now)
		if policy.Status().Released != 1 {
			t.Fatalf("real process not selected under pressure: %+v", policy.Status())
		}
	} else {
		manager.suspendIdle(state, epoch)
	}
	if running, _ := p.IsRunning(); running {
		t.Fatal("real gopls survived hibernation")
	}
	manager.activity.Report("main", activity.Active, []string{"code-studio:real-hibernate"})
	deadline := time.Now().Add(30 * time.Second)
	for time.Now().Before(deadline) && manager.Status(session.ID, goID).State != LanguageServerReady {
		time.Sleep(10 * time.Millisecond)
	}
	resumed := manager.Status(session.ID, goID)
	if resumed.State != LanguageServerReady || resumed.PID == status.PID {
		t.Fatalf("gopls failed to wake: %+v", resumed)
	}
	hover, err := manager.Hover(ctx, session.ID, doc.ID, 2, 9)
	if err != nil || !strings.Contains(hover.Markdown, "unsaved-overlay") {
		t.Fatalf("overlay not restored: %v %+v", err, hover)
	}
	t.Logf("hibernated PID=%d resident=%.1f MiB; resumed PID=%d with unsaved overlay", status.PID, float64(memory.RSS)/(1<<20), resumed.PID)
}
