package collab

import (
	"bufio"
	jsonv1 "encoding/json"
	"fmt"
	"os"
	"os/exec"
	"strings"
	"testing"
	"time"

	"github.com/Andrea-Cavallo/adOmnia/internal/storage"
)

const collabKillChildEnv = "ADOMNIA_COLLAB_RECOVERY_KILL_CHILD"

func TestCollabRecoveryChildWritesSnapshots(t *testing.T) {
	directory := os.Getenv(collabKillChildEnv)
	if directory == "" {
		t.Skip("solo come processo figlio di TestKillDuringCollabSnapshotsKeepsConsistentState")
	}
	if err := storage.Open(directory); err != nil {
		t.Fatal(err)
	}
	host := NewPersistentManager(nil)
	if _, err := host.Host("127.0.0.1", 0, "Alice"); err != nil {
		t.Fatal(err)
	}
	padding := strings.Repeat("x", 64*1024)
	for round := 0; ; round++ {
		payload := jsonv1.RawMessage(fmt.Sprintf(`{"name":"round-%d","children":[],"padding":%q}`, round, padding))
		if _, err := host.Share(ShareCollection, "kill-test", payload); err != nil {
			t.Fatal(err)
		}
		if round == 0 {
			fmt.Println("ready")
		}
	}
}

func TestKillDuringCollabSnapshotsKeepsConsistentState(t *testing.T) {
	if testing.Short() {
		t.Skip("avvia processi figli")
	}
	if os.Getenv(collabKillChildEnv) != "" {
		t.Skip("processo figlio")
	}
	for attempt, delay := range []time.Duration{0, 37 * time.Millisecond, 113 * time.Millisecond} {
		directory := t.TempDir()
		child := exec.Command(os.Args[0], "-test.run=^TestCollabRecoveryChildWritesSnapshots$", "-test.count=1")
		child.Env = append(os.Environ(), collabKillChildEnv+"="+directory)
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
		restored := NewPersistentManager(nil)
		restored.Restore()
		status := restored.Status()
		restored.mu.Lock()
		seq, replay := restored.seq, append([]Event(nil), restored.replay...)
		restored.mu.Unlock()
		if status.RecoveryError != "" || !status.RecoveryPending || seq == 0 || len(replay) == 0 {
			t.Fatalf("tentativo %d: recovery incoerente: %+v seq=%d replay=%d", attempt, status, seq, len(replay))
		}
		for _, event := range replay {
			if event.Seq > seq {
				t.Fatalf("tentativo %d: replay %d oltre la snapshot %d", attempt, event.Seq, seq)
			}
		}
		if _, err := decodeSessionCert(restored.certPEM, restored.keyPEM, restored.fp); err != nil {
			t.Fatalf("tentativo %d: certificato illeggibile: %v", attempt, err)
		}
		restored.Stop()
		storage.Close()
	}
}
