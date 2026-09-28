package goide

import "sync"

type DebugManager struct {
	mu       sync.Mutex
	sessions map[DebugSessionID]SessionID
}

func NewDebugManager() *DebugManager {
	return &DebugManager{sessions: make(map[DebugSessionID]SessionID)}
}

// Shutdown rilascia il registro delle sessioni debug possedute dal manager.
func (m *DebugManager) Shutdown() {
	m.mu.Lock()
	m.sessions = make(map[DebugSessionID]SessionID)
	m.mu.Unlock()
}
