package goide

import (
	"adomnia/internal/ide/language"
	"adomnia/internal/ide/process"
	"adomnia/internal/languages/golang"

	"encoding/json"
	"os"
	"os/exec"
	"path/filepath"
	"testing"
	"time"
)

// TestGoIDEManagedChildrenHelper è il processo figlio di prova per lo sweep.
func TestGoIDEManagedChildrenHelper(t *testing.T) {
	if os.Getenv("ADOMNIA_GOIDE_MANAGED_HELPER") != "1" {
		t.Skip("helper per i test di sweep")
	}
	time.Sleep(5 * time.Minute)
}

func spawnManagedHelper(t *testing.T) *exec.Cmd {
	t.Helper()
	command := exec.Command(os.Args[0], "-test.run=^TestGoIDEManagedChildrenHelper$", "-test.count=1")
	command.Env = append(os.Environ(), "ADOMNIA_GOIDE_MANAGED_HELPER=1")
	configureProcess(command, false)
	if err := command.Start(); err != nil {
		t.Fatalf("avvio helper: %v", err)
	}
	// Reap the child when the sweep kills it: an unreaped zombie still answers kill(pid, 0) and ps.
	go func() { _ = command.Wait() }()
	t.Cleanup(func() { _ = terminateProcessTreeByPID(command.Process.Pid) })
	return command
}

func writeRuntimeLock(t *testing.T, directory string, heartbeat time.Time) {
	t.Helper()
	data, err := json.Marshal(runtimeLockInfo{Instance: "previous", PID: 99999, StartedAt: heartbeat, Heartbeat: heartbeat})
	if err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(directory, runtimeLockFile), data, 0o600); err != nil {
		t.Fatal(err)
	}
}

func TestSweepOrphanChildrenRespectsRuntimeLock(t *testing.T) {
	directory := t.TempDir()
	child := spawnManagedHelper(t)
	registry := process.OpenRegistry(filepath.Join(directory, managedChildrenFile))
	registry.Add(child.Process.Pid, filepath.Base(os.Args[0]))

	// Heartbeat recente: un'altra istanza è viva e quei figli hanno un padrone.
	writeRuntimeLock(t, directory, time.Now())
	if killed := SweepOrphanChildren(directory); len(killed) != 0 {
		t.Fatalf("sweep inatteso con istanza viva: %v", killed)
	}
	if !processAlive(child.Process.Pid) {
		t.Fatal("il figlio di un'altra istanza non doveva essere terminato")
	}

	// Heartbeat fermo: la precedente istanza è morta, l'orfano va terminato.
	writeRuntimeLock(t, directory, time.Now().Add(-2*time.Minute))
	killed := SweepOrphanChildren(directory)
	if len(killed) != 1 || killed[0] != child.Process.Pid {
		t.Fatalf("orfani terminati inattesi: %v", killed)
	}
	deadline := time.Now().Add(5 * time.Second)
	for time.Now().Before(deadline) && processAlive(child.Process.Pid) {
		time.Sleep(50 * time.Millisecond)
	}
	if processAlive(child.Process.Pid) {
		t.Fatal("l'orfano è ancora vivo dopo lo sweep")
	}
}

func TestLSPRegistersAndReleasesManagedChild(t *testing.T) {
	registry := language.NewRegistry()
	_ = registry.Register(golang.New())
	manager := NewLSPManager(registry)
	t.Cleanup(manager.Shutdown)
	binary, err := os.Executable()
	if err != nil {
		t.Fatal(err)
	}
	root := t.TempDir()
	childRegistry := process.OpenRegistry(filepath.Join(t.TempDir(), "managed-children.json"))
	process.SetManagedRegistry(childRegistry)
	t.Cleanup(func() { process.SetManagedRegistry(nil) })

	session := Session{ID: "managed-child", Project: Project{Name: "managed", RootPath: root, RealPath: root}}
	options := LanguageServerOptions{Language: golang.ID, Name: "gopls", Binary: binary, Environment: append(os.Environ(), fakeGoplsEnv+"=1")}
	status, err := manager.Start(session, options)
	if err != nil {
		t.Fatal(err)
	}
	registered := false
	for _, child := range childRegistry.Children() {
		if child.PID == status.PID {
			registered = true
		}
	}
	if !registered {
		t.Fatalf("il server language non è tra i figli gestiti: %+v", childRegistry.Children())
	}

	manager.Stop(session.ID, golang.ID)
	deadline := time.Now().Add(5 * time.Second)
	for time.Now().Before(deadline) && len(childRegistry.Children()) > 0 {
		time.Sleep(50 * time.Millisecond)
	}
	if remaining := childRegistry.Children(); len(remaining) != 0 {
		t.Fatalf("figli non rilasciati dopo lo stop: %+v", remaining)
	}
}
