package goide

import (
	"adomnia/internal/ide/process"

	"encoding/json"
	"os"
	"path/filepath"
	"time"
)

const managedChildrenFile = "managed-children.json"

// SweepOrphanChildren installa il registro dei processi figli gestiti (gopls,
// debug adapter) e termina quelli lasciati vivi da un'istanza precedente: un
// crash di adOmnia non li riconduce e nessun altro se ne occupa (REFACTOR.md
// voci 2 e 14). Va chiamato prima di AcquireRuntimeLock, perché il lock
// dell'istanza precedente serve a capire se qualcuno li possiede ancora.
func SweepOrphanChildren(directory string) []int {
	registry := process.OpenRegistry(filepath.Join(directory, managedChildrenFile))
	process.SetManagedRegistry(registry)
	if anotherInstanceAlive(directory) {
		return nil
	}
	killed := registry.Sweep()
	pids := make([]int, 0, len(killed))
	for _, child := range killed {
		pids = append(pids, child.PID)
	}
	return pids
}

// anotherInstanceAlive è vero se il runtime lock dell'avvio precedente ha un
// heartbeat recente: un'altra istanza di adOmnia è viva e quei figli sono suoi.
func anotherInstanceAlive(directory string) bool {
	data, err := os.ReadFile(filepath.Join(directory, runtimeLockFile))
	if err != nil {
		return false
	}
	var previous runtimeLockInfo
	if json.Unmarshal(data, &previous) != nil {
		return false
	}
	return !previous.Heartbeat.IsZero() && time.Since(previous.Heartbeat) <= staleHeartbeatAfter
}

// registerManagedChild e releaseManagedChild registrano i figli nel registro
// condiviso (internal/ide/process): senza registro installato sono no-op.
func registerManagedChild(pid int, name string) { process.RegisterManagedChild(pid, name) }

func releaseManagedChild(pid int) { process.ReleaseManagedChild(pid) }
