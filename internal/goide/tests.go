package goide

import "sync"

type TestRun struct {
	ID        RunID     `json:"id"`
	SessionID SessionID `json:"sessionId"`
	Status    string    `json:"status"`
}

type TestManager struct {
	mu   sync.Mutex
	runs map[RunID]TestRun
}

func NewTestManager() *TestManager {
	return &TestManager{runs: make(map[RunID]TestRun)}
}
