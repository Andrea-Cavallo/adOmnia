package goide

import (
	"errors"
	"strings"
	"sync"
	"testing"
	"time"
	"unicode/utf8"
)

func TestCompleteUTF8Prefix(t *testing.T) {
	cases := []struct {
		name string
		data []byte
		want int
	}{
		{"vuoto", nil, 0},
		{"ascii", []byte("abc"), 3},
		{"rune completa", []byte("aè"), 3},
		{"due byte, manca uno", []byte{'a', 0xC3}, 1},
		{"tre byte, manca uno", []byte{'a', 0xE2, 0x82}, 1},
		{"quattro byte, mancano due", []byte{'a', 0xF0, 0x9F}, 1},
		{"quattro byte completi", []byte("a😀"), 5},
		{"continuazione orfana non trattenuta", []byte{'a', 0x80}, 2},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			if got := completeUTF8Prefix(tc.data); got != tc.want {
				t.Fatalf("completeUTF8Prefix(%v) = %d, atteso %d", tc.data, got, tc.want)
			}
		})
	}
}

// collectRun raccoglie l'output di un'esecuzione fino a run.finished.
func collectRun(t *testing.T, events <-chan processEvent, runID RunID) ([]string, Execution) {
	t.Helper()
	var outputs []string
	deadline := time.After(10 * time.Second)
	for {
		select {
		case event := <-events:
			if event.execution.ID != runID {
				continue
			}
			if output, ok := event.payload.(ProcessOutput); ok {
				outputs = append(outputs, output.Text)
			}
			if event.eventType == "run.finished" {
				return outputs, event.execution
			}
		case <-deadline:
			t.Fatal("timeout in attesa di run.finished")
		}
	}
}

func TestProcessOutputTailIsNeverLost(t *testing.T) {
	manager, events := testProcessManager(t)
	execution, err := manager.Start(helperSpec("tail"))
	if err != nil {
		t.Fatal(err)
	}
	outputs, finished := collectRun(t, events, execution.ID)
	if !strings.HasSuffix(strings.Join(outputs, ""), "END") {
		t.Fatalf("l'ultimo output deve precedere run.finished, ricevuto: %q", outputs)
	}
	if finished.Status != "exited" {
		t.Fatalf("stato finale inatteso: %#v", finished)
	}
}

func TestProcessOutputKeepsSplitRuneIntact(t *testing.T) {
	manager, events := testProcessManager(t)
	execution, err := manager.Start(helperSpec("split-rune"))
	if err != nil {
		t.Fatal(err)
	}
	outputs, _ := collectRun(t, events, execution.ID)
	for _, text := range outputs {
		if !utf8.ValidString(text) {
			t.Fatalf("evento con UTF-8 spezzato: %q", text)
		}
	}
	if !strings.Contains(strings.Join(outputs, ""), "è") {
		t.Fatalf("carattere perso: %q", outputs)
	}
}

func TestProcessStartNeverExceedsLimitUnderConcurrency(t *testing.T) {
	manager, _ := testProcessManager(t)
	var wg sync.WaitGroup
	for range MaxConcurrentRuns * 2 {
		wg.Go(func() { _, _ = manager.Start(helperSpec("child")) })
	}
	wg.Wait()
	if active := len(manager.activeProcesses("")); active > MaxConcurrentRuns {
		t.Fatalf("processi attivi %d oltre il limite %d", active, MaxConcurrentRuns)
	}
}

func TestValidateRunTargetRejectsFlags(t *testing.T) {
	root := t.TempDir()
	for _, target := range []string{"-toolexec=calc", " -exec=x", "--"} {
		if err := validateRunTarget(root, root, target); err == nil {
			t.Fatalf("target %q interpretabile come flag accettato", target)
		}
	}
	if err := validateRunTarget(root, root, "./cmd/app"); err != nil {
		t.Fatalf("target relativo rifiutato: %v", err)
	}
}

func TestRecoveryKeyCaseSensitivityFollowsPlatform(t *testing.T) {
	same := recoveryKey("s", "Main.go") == recoveryKey("s", "main.go")
	if same != caseInsensitivePaths {
		t.Fatalf("Main.go e main.go condividono la chiave=%v, filesystem case-insensitive=%v", same, caseInsensitivePaths)
	}
	if recoveryKey("s", `pkg\a.go`) != recoveryKey("s", "pkg/a.go") && caseInsensitivePaths {
		t.Fatal("separatori diversi devono produrre la stessa chiave su Windows")
	}
}

func TestCorruptStateDoesNotBrickService(t *testing.T) {
	service := NewService(&memoryStore{data: []byte("{non json")}, nil)
	if _, err := service.ListSessions(); err != nil {
		t.Fatalf("uno stato corrotto non deve bloccare Go Studio: %v", err)
	}
}

type flakyStore struct {
	memoryStore
	failures int
}

func (s *flakyStore) Load() ([]byte, error) {
	if s.failures > 0 {
		s.failures--
		return nil, errors.New("store non pronto")
	}
	return s.memoryStore.Load()
}

func TestRestoreRetriesAfterTransientError(t *testing.T) {
	service := NewService(&flakyStore{failures: 1}, nil)
	if _, err := service.ListSessions(); err == nil {
		t.Fatal("atteso errore al primo caricamento")
	}
	if _, err := service.ListSessions(); err != nil {
		t.Fatalf("il secondo tentativo deve riuscire: %v", err)
	}
}

func TestRemoveRecentProjectDoesNotMutateReturnedSlice(t *testing.T) {
	service := NewService(&memoryStore{}, nil)
	first, second := t.TempDir(), t.TempDir()
	for _, path := range []string{first, second} {
		if _, err := service.OpenProject(path); err != nil {
			t.Fatal(err)
		}
	}
	listed, err := service.ListRecentProjects()
	if err != nil {
		t.Fatal(err)
	}
	snapshot := append([]RecentProject(nil), listed...)
	if err := service.RemoveRecentProject(listed[0].RealPath); err != nil {
		t.Fatal(err)
	}
	for index := range listed {
		if listed[index] != snapshot[index] {
			t.Fatalf("lo slice restituito è stato modificato in place: %#v", listed)
		}
	}
}

func TestReorderCompactsOrder(t *testing.T) {
	manager := NewRunConfigManager()
	a, _ := manager.Save("s", RunConfiguration{Name: "a"})
	b, _ := manager.Save("s", RunConfiguration{Name: "b"})
	ordered, err := manager.Reorder("s", []string{"ghost", b.ID, "ghost2", a.ID})
	if err != nil {
		t.Fatal(err)
	}
	for index, config := range ordered {
		if config.Order != index {
			t.Fatalf("ordine non compattato: %#v", ordered)
		}
	}
	if ordered[0].ID != b.ID {
		t.Fatalf("ordine non rispettato: %#v", ordered)
	}
}
