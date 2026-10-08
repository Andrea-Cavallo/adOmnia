package goide

import (
	"bufio"
	"fmt"
	"os"
	"os/exec"
	"slices"
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
// ripristino all'apertura deve essere percepito come immediato. Il p95 distingue una regressione
// persistente da un singolo picco di fsync/scheduling sul runner condiviso; il massimo resta nei log.
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
	var snapshots []time.Duration
	for round := 0; round < 5; round++ {
		for file := 0; file < killDirtyFiles; file++ {
			start := time.Now()
			if err := manager.Remember(SessionID([]string{"s", "t"}[file%2]), fmt.Sprintf("f%d.go", file), fmt.Sprintf("round %d\n%s", round, padding), ""); err != nil {
				t.Fatal(err)
			}
			elapsed := time.Since(start)
			slowest = max(slowest, elapsed)
			snapshots = append(snapshots, elapsed)
		}
	}
	if measured := recoveryLatencyP95(snapshots); measured > snapshotBudget {
		t.Fatalf("snapshot p95 %v oltre %v (massimo %v)", measured, snapshotBudget, slowest)
	}

	var restores []time.Duration
	for attempt := 0; attempt < 20; attempt++ {
		start := time.Now()
		restored := NewRecoveryManager(bboltRecoveryStore{})
		if err := restored.Load(); err != nil {
			t.Fatal(err)
		}
		entries := append(restored.List("s"), restored.List("t")...)
		restores = append(restores, time.Since(start))
		if len(entries) != killDirtyFiles {
			t.Fatalf("recuperati %d buffer su %d", len(entries), killDirtyFiles)
		}
		for _, entry := range entries {
			if entry.Content != "round 4\n"+padding || contentHash(entry.Content) != entry.SnapshotHash {
				t.Fatalf("snapshot di %s non integra", entry.RelativePath)
			}
		}
	}
	if measured := recoveryLatencyP95(restores); measured > restoreBudget {
		t.Fatalf("ripristino p95 %v oltre %v", measured, restoreBudget)
	}
	t.Logf("snapshot p95 %v (massimo %v), ripristino p95 %v", recoveryLatencyP95(snapshots), slowest, recoveryLatencyP95(restores))
}

// Nearest-rank p95: 50 snapshot e 20 ripristini, mantenendo il budget originale.
func recoveryLatencyP95(samples []time.Duration) time.Duration {
	ordered := slices.Clone(samples)
	slices.Sort(ordered)
	return ordered[(95*len(ordered)+99)/100-1]
}

func TestRecoveryLatencyP95DistinguishesOutliersFromSustainedSlowdown(t *testing.T) {
	samples := make([]time.Duration, 50)
	for index := range samples {
		samples[index] = 20 * time.Millisecond
	}
	samples[0] = 554730900 * time.Nanosecond // picco osservato sul runner Windows
	if got := recoveryLatencyP95(samples); got != 20*time.Millisecond {
		t.Fatalf("picco isolato altera p95: %v", got)
	}
	samples[1], samples[2] = time.Second, time.Second
	if got := recoveryLatencyP95(samples); got <= 500*time.Millisecond {
		t.Fatalf("rallentamento persistente non rilevato: %v", got)
	}
}
