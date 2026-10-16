package process

import (
	"os"
	"os/exec"
	"path/filepath"
	"testing"
	"time"
)

// TestManagedHelperSleep è il processo figlio di prova: si avvia solo quando il
// test padre lo invoca con la variabile d'ambiente dedicata.
func TestManagedHelperSleep(t *testing.T) {
	if os.Getenv("ADOMNIA_MANAGED_CHILD_HELPER") != "1" {
		t.Skip("helper per i test di sweep")
	}
	time.Sleep(5 * time.Minute)
}

func spawnHelper(t *testing.T) *exec.Cmd {
	t.Helper()
	command := exec.Command(os.Args[0], "-test.run=^TestManagedHelperSleep$", "-test.count=1")
	command.Env = append(os.Environ(), "ADOMNIA_MANAGED_CHILD_HELPER=1")
	Configure(command, false)
	if err := command.Start(); err != nil {
		t.Fatalf("avvio helper: %v", err)
	}
	// Reap the child when the sweep kills it: an unreaped zombie still answers kill(pid, 0) and ps.
	go func() { _ = command.Wait() }()
	t.Cleanup(func() { _ = TerminateTreeByPID(command.Process.Pid) })
	return command
}

func TestRegistryRoundTrip(t *testing.T) {
	path := filepath.Join(t.TempDir(), "managed-children.json")
	registry := OpenRegistry(path)
	registry.Add(11, "gopls")
	registry.Add(22, "dlv")
	registry.Add(22, "dlv") // duplicato ignorato

	reloaded := OpenRegistry(path)
	children := reloaded.Children()
	if len(children) != 2 || children[0].PID != 11 || children[1].PID != 22 {
		t.Fatalf("registro inatteso: %+v", children)
	}

	reloaded.Remove(11)
	if again := OpenRegistry(path); len(again.Children()) != 1 || again.Children()[0].PID != 22 {
		t.Fatalf("rimozione non persistita: %+v", again.Children())
	}
}

func TestSweepManagedChildrenSelection(t *testing.T) {
	killed := map[int]bool{}
	lookup := func(pid int) (string, bool) {
		switch pid {
		case 1:
			return "gopls", true // orfano vivo: va terminato
		case 2:
			return "chrome", true // PID riassegnato: va risparmiato
		default:
			return "", false // morto: solo dimenticato
		}
	}
	result := sweepManagedChildren([]ManagedChild{
		{PID: 1, Name: "gopls"},
		{PID: 2, Name: "gopls"},
		{PID: 3, Name: "gopls"},
	}, lookup, func(pid int) error {
		killed[pid] = true
		return nil
	})

	if len(result) != 1 || result[0].PID != 1 {
		t.Fatalf("terminati inattesi: %+v", result)
	}
	if !killed[1] || killed[2] || killed[3] {
		t.Fatalf("kill inattesi: %+v", killed)
	}
}

func TestSweepKillsOrphanAndSparesRecycledPID(t *testing.T) {
	orphan := spawnHelper(t)
	recycled := spawnHelper(t)

	path := filepath.Join(t.TempDir(), "managed-children.json")
	registry := OpenRegistry(path)
	registry.Add(orphan.Process.Pid, filepath.Base(os.Args[0]))
	// Stesso PID vivo, nome registrato diverso: simula un PID riassegnato.
	registry.Add(recycled.Process.Pid, "qualcosaltro")

	killed := registry.Sweep()
	if len(killed) != 1 || killed[0].PID != orphan.Process.Pid {
		t.Fatalf("terminati inattesi: %+v", killed)
	}
	if len(registry.Children()) != 0 {
		t.Fatalf("registro non svuotato: %+v", registry.Children())
	}

	deadline := time.Now().Add(5 * time.Second)
	for time.Now().Before(deadline) {
		if _, alive := lookupProcess(orphan.Process.Pid); !alive {
			break
		}
		time.Sleep(50 * time.Millisecond)
	}
	if _, alive := lookupProcess(orphan.Process.Pid); alive {
		t.Fatal("l'orfano è ancora vivo dopo lo sweep")
	}
	if _, alive := lookupProcess(recycled.Process.Pid); !alive {
		t.Fatal("il processo con nome diverso non doveva essere terminato")
	}
}
