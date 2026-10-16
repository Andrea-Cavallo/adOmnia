package goide

import (
	"adomnia/internal/activity"
	"fmt"
	"time"
)

const languageServerIdleTimeout = activity.IdleAfter

// Only suspend servers with no tracked editors. Hidden/dirty editors and background
// editor services keep their server; reopening replays the tracked buffers.
func (m *LSPManager) armIdle(state *lspSession) {
	state.mu.Lock()
	defer state.mu.Unlock()
	if state.idleTimer != nil {
		state.idleTimer.Stop()
	}
	if state.userInitiated || len(state.documents) != 0 || state.process == nil || state.closed || state.stopping {
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
	if idle && !m.activity.CanSuspend("goide:"+string(state.id), activity.Resource{Kind: "language-server", Restorable: true, UserInitiated: state.userInitiated}, true) {
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
		m.activity.Released(lspActivityID(state))
	}
}

func lspActivityID(state *lspSession) string {
	return "lsp:" + string(state.id) + ":" + state.language
}

// SetActivityManager is called by the desktop composition root before starting sessions.
func (s *Service) SetActivityManager(manager *activity.Manager) {
	if manager != nil {
		s.lsp.activity = manager
	}
}

// ProtectLanguageServer records explicit user intent without launching a process.
// The pin survives automatic restarts and is cleared by an explicit stop/close.
func (s *Service) ProtectLanguageServer(sessionID, languageID string) error {
	session, err := s.session(sessionID)
	if err != nil {
		return err
	}
	if _, ok := s.lsp.languages.Get(languageID); !ok {
		return fmt.Errorf("unknown language")
	}
	state := s.lsp.ensure(session, languageID)
	state.mu.Lock()
	state.userInitiated = true
	state.mu.Unlock()
	return nil
}
