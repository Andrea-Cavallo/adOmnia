package goide

import "sync"

const MaxTerminalScrollbackLines = 10_000

type TerminalManager struct {
	mu        sync.Mutex
	terminals map[TerminalID]SessionID
}

func NewTerminalManager() *TerminalManager {
	return &TerminalManager{terminals: make(map[TerminalID]SessionID)}
}

// Shutdown rilascia il registro dei terminali posseduti dal manager.
func (m *TerminalManager) Shutdown() {
	m.mu.Lock()
	m.terminals = make(map[TerminalID]SessionID)
	m.mu.Unlock()
}
