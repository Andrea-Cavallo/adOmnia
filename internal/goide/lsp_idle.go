package goide

import "time"

const languageServerIdleTimeout = 5 * time.Minute

// Only suspend servers with no tracked editors. Hidden/dirty editors and background
// editor services keep their server; reopening replays the tracked buffers.
func (m *LSPManager) armIdle(state *lspSession) {
	state.mu.Lock()
	defer state.mu.Unlock()
	if state.idleTimer != nil {
		state.idleTimer.Stop()
	}
	if len(state.documents) != 0 || state.process == nil || state.closed || state.stopping {
		return
	}
	state.idleEpoch++
	epoch := state.idleEpoch
	state.idleTimer = time.AfterFunc(languageServerIdleTimeout, func() { m.suspendIdle(state, epoch) })
}

func (m *LSPManager) suspendIdle(state *lspSession, epoch uint64) {
	state.lifecycle.Lock()
	defer state.lifecycle.Unlock()
	state.mu.Lock()
	idle := state.idleEpoch == epoch && len(state.documents) == 0 && state.process != nil && !state.closed && !state.stopping
	if idle && state.process.conn.PendingRequests() > 0 {
		state.mu.Unlock()
		m.armIdle(state)
		return
	}
	if idle {
		state.suspended = true
	}
	state.mu.Unlock()
	if idle {
		m.stopLocked(state)
	}
}
