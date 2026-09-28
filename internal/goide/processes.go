package goide

import (
	"context"
	"os/exec"
	"sync"
)

const (
	MaxConsoleBufferBytes  = 4 * 1024 * 1024
	MaxPendingOutputEvents = 256
)

type CommandSpec struct {
	Executable       string            `json:"executable"`
	Arguments        []string          `json:"arguments"`
	WorkingDirectory string            `json:"workingDirectory"`
	Environment      map[string]string `json:"environment,omitempty"`
}

type managedProcess struct {
	command *exec.Cmd
	cancel  context.CancelFunc
}

type ProcessManager struct {
	mu        sync.Mutex
	processes map[RunID]*managedProcess
}

func NewProcessManager() *ProcessManager {
	return &ProcessManager{processes: make(map[RunID]*managedProcess)}
}

// Shutdown interrompe tutte le esecuzioni di cui il manager mantiene l'ownership.
func (m *ProcessManager) Shutdown() {
	m.mu.Lock()
	items := make([]*managedProcess, 0, len(m.processes))
	for _, process := range m.processes {
		items = append(items, process)
	}
	m.processes = make(map[RunID]*managedProcess)
	m.mu.Unlock()
	for _, process := range items {
		process.cancel()
		_ = terminateProcessTree(process.command)
	}
}
