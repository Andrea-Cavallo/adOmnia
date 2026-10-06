package goide

import (
	"bufio"
	"fmt"
	"os"
	"os/exec"
	"strings"
	"testing"
	"time"

	"adomnia/internal/storage"
)

const killChildEnv = "ADOMNIA_RECOVERY_KILL_CHILD"

// bboltRecoveryStore ricalca lo store dell'app (goide_bindings.go): bucket goide, una chiave per workspace.
type bboltRecoveryStore struct{}

const killTestPrefix = "kill-test/" + RecoveryWorkspacePrefix

func (bboltRecoveryStore) Load() ([]byte, error) { return nil, nil }
func (bboltRecoveryStore) Save([]byte) error     { return nil }
func (bboltRecoveryStore) LoadWorkspaces() (map[string][]byte, error) {
	keys, err := storage.List("goide", killTestPrefix)
	if err != nil {
		return nil, err
	}
	workspaces := map[string][]byte{}
	for _, key := range keys {
		if workspaces[strings.TrimPrefix(key, killTestPrefix)], err = storage.Get("goide", key); err != nil {
			return nil, err
		}
	}
	return workspaces, nil
}
func (bboltRecoveryStore) SaveWorkspace(workspaceID string, data []byte) error {
	if len(data) == 0 {
		return storage.Delete("goide", killTestPrefix+workspaceID)
	}
	return storage.Put("goide", killTestPrefix+workspaceID, data)
}

const killDirtyFiles = 10

// TestRecoveryChildWritesSnapshots è il processo figlio: riscrive di continuo 10 buffer finché non viene ucciso.
func TestRecoveryChildWritesSnapshots(t *testing.T) {
	directory := os.Getenv(killChildEnv)
	if directory == "" {
		t.Skip("solo come processo figlio di TestKillDuringSnapshotWritesKeepsEveryBuffer")
	}
	if err := storage.Open(directory); err != nil {
		t.Fatal(err)
	}
	manager := NewRecoveryManager(bboltRecoveryStore{})
	manager.BindWorkspace("s", "ws-a")
	manager.BindWorkspace("t", "ws-b")
	padding := strings.Repeat("x", 64*1024) // snapshot grandi: la scrittura dura abbastanza da essere interrotta
	for round := 0; ; round++ {
		for file := 0; file < killDirtyFiles; file++ {
			if err := manager.Remember(SessionID([]string{"s", "t"}[file%2]), fmt.Sprintf("f%d.go", file), fmt.Sprintf("round %d\n%s", round, padding), ""); err != nil {
				t.Fatal(err)
			}
		}
		if round == 0 {
			fmt.Println("ready")
		}
	}
}

// Kill reale (SIGKILL / TerminateProcess) mentre un altro processo scrive snapshot: ogni volta tutti i
// buffer devono restare recuperabili e integri, cioè vale l'ultima snapshot completa prima del kill.
func TestKillDuringSnapshotWritesKeepsEveryBuffer(t *testing.T) {
	if testing.Short() {
		t.Skip("avvia processi figli")
	}
	if os.Getenv(killChildEnv) != "" {
		t.Skip("processo figlio")
	}
	directory := t.TempDir()
	for attempt, delay := range []time.Duration{0, 37 * time.Millisecond, 113 * time.Millisecond} {
		child := exec.Command(os.Args[0], "-test.run=^TestRecoveryChildWritesSnapshots$", "-test.count=1")
		child.Env = append(os.Environ(), killChildEnv+"="+directory)
		stdout, err := child.StdoutPipe()
		if err != nil {
			t.Fatal(err)
		}
		if err := child.Start(); err != nil {
			t.Fatal(err)
		}
		ready := make(chan bool, 1)
		go func() {
			scanner := bufio.NewScanner(stdout)
			for scanner.Scan() {
				if scanner.Text() == "ready" {
					ready <- true
					return
				}
			}
			ready <- false
		}()
		select {
		case ok := <-ready:
			if !ok {
				t.Fatalf("tentativo %d: il figlio è uscito prima di scrivere", attempt)
			}
		case <-time.After(30 * time.Second):
			_ = child.Process.Kill()
			t.Fatalf("tentativo %d: il figlio non ha scritto le snapshot", attempt)
		}
		time.Sleep(delay)
		if err := child.Process.Kill(); err != nil {
			t.Fatal(err)
		}
		_ = child.Wait()

		if err := storage.Open(directory); err != nil {
			t.Fatalf("tentativo %d: store illeggibile dopo il kill: %v", attempt, err)
		}
		manager := NewRecoveryManager(bboltRecoveryStore{})
		loadErr := manager.Load()
		entries := append(manager.List("s"), manager.List("t")...)
		storage.Close()
		if loadErr != nil {
			t.Fatalf("tentativo %d: %v", attempt, loadErr)
		}
		if len(entries) != killDirtyFiles {
			t.Fatalf("tentativo %d: recuperati %d buffer su %d", attempt, len(entries), killDirtyFiles)
		}
		for _, entry := range entries {
			if !strings.HasPrefix(entry.Content, "round ") || contentHash(entry.Content) != entry.SnapshotHash {
				t.Fatalf("tentativo %d: snapshot di %s non integra", attempt, entry.RelativePath)
			}
		}
	}
}

// Responsività con 10 file dirty sullo store reale (bbolt): ogni snapshot gira via IPC asincrono dopo
// 750 ms di pausa nella digitazione, quindi deve chiudersi prima del debounce successivo; il
// ripristino all'apertura deve essere percepito come immediato. I budget lasciano margine ai runner CI
// con fsync lento (locale ~13 ms, Linux CI fino a ~160 ms): falliscono solo su una regressione reale.
func TestRecoveryLatencyWithTenDirtyFiles(t *testing.T) {
	if testing.Short() {
		t.Skip("misura su disco")
	}
	const (
		snapshotBudget = 500 * time.Millisecond
		restoreBudget  = 500 * time.Millisecond
	)
	if err := storage.Open(t.TempDir()); err != nil {
		t.Fatal(err)
	}
	defer storage.Close()
	manager := NewRecoveryManager(bboltRecoveryStore{})
	manager.BindWorkspace("s", "ws-a")
	manager.BindWorkspace("t", "ws-b")
	padding := strings.Repeat("x", 64*1024)
	var slowest time.Duration
	for round := 0; round < 5; round++ {
		for file := 0; file < killDirtyFiles; file++ {
			start := time.Now()
			if err := manager.Remember(SessionID([]string{"s", "t"}[file%2]), fmt.Sprintf("f%d.go", file), fmt.Sprintf("round %d\n%s", round, padding), ""); err != nil {
				t.Fatal(err)
			}
			slowest = max(slowest, time.Since(start))
		}
	}
	if slowest > snapshotBudget {
		t.Fatalf("snapshot più lenta %v oltre %v", slowest, snapshotBudget)
	}

	start := time.Now()
	restored := NewRecoveryManager(bboltRecoveryStore{})
	if err := restored.Load(); err != nil {
		t.Fatal(err)
	}
	entries := append(restored.List("s"), restored.List("t")...)
	elapsed := time.Since(start)
	if len(entries) != killDirtyFiles {
		t.Fatalf("recuperati %d buffer su %d", len(entries), killDirtyFiles)
	}
	if elapsed > restoreBudget {
		t.Fatalf("ripristino in %v oltre %v", elapsed, restoreBudget)
	}
	t.Logf("snapshot più lenta %v, ripristino di %d buffer in %v", slowest, killDirtyFiles, elapsed)
}
