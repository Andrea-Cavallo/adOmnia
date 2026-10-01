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

// bboltRecoveryStore è lo stesso store dell'app (goide_bindings.go): bucket goide, chiave dedicata.
type bboltRecoveryStore struct{}

func (bboltRecoveryStore) Load() ([]byte, error) { return storage.Get("goide", "recovery-kill-test") }
func (bboltRecoveryStore) Save(data []byte) error {
	return storage.Put("goide", "recovery-kill-test", data)
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
	padding := strings.Repeat("x", 64*1024) // snapshot grandi: la scrittura dura abbastanza da essere interrotta
	for round := 0; ; round++ {
		for file := 0; file < killDirtyFiles; file++ {
			if err := manager.Remember("s", fmt.Sprintf("f%d.go", file), fmt.Sprintf("round %d\n%s", round, padding), ""); err != nil {
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
		entries := manager.List("s")
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
