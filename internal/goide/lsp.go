package goide

import "sync"

const MaxPendingLSPRequests = 128

type LSPManager struct {
	mu       sync.Mutex
	requests map[LSPRequestID]SessionID
}

func NewLSPManager() *LSPManager {
	return &LSPManager{requests: make(map[LSPRequestID]SessionID)}
}

// Shutdown dimentica le richieste pendenti; i processi LSP saranno posseduti da questo manager nelle fasi successive.
func (m *LSPManager) Shutdown() {
	m.mu.Lock()
	m.requests = make(map[LSPRequestID]SessionID)
	m.mu.Unlock()
}
