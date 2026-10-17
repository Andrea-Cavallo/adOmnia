package codestudio

import (
	"adomnia/internal/activity"
	"fmt"
	"time"
)

const languageServerIdleTimeout = activity.IdleAfter

// Buffers and versions survive suspension and are replayed on resume. Open tabs
// therefore do not pin an inactive project's language server.
func (m *LSPManager) armIdle(state *lspSession) {
	state.mu.Lock()
	defer state.mu.Unlock()
	if state.idleTimer != nil || state.userInitiated || state.process == nil || state.closed || state.stopping {
		return
	}
	if !m.activity.CanSuspend("code-studio:"+string(state.id), activity.Resource{Kind: "language-server", Restorable: true, UserInitiated: state.userInitiated}, true) {
		return
	}
	if state.inactiveSince.IsZero() {
		state.inactiveSince = time.Now()
	}
	state.idleEpoch++
	epoch := state.idleEpoch
	state.idleTimer = time.AfterFunc(languageServerIdleTimeout, func() { m.suspendIdle(state, epoch) })
}

func (m *LSPManager) suspendIdle(state *lspSession, epoch uint64) {
	state.lifecycle.Lock()
	defer state.lifecycle.Unlock()
	state.mu.Lock()
	if state.idleEpoch != epoch {
		state.mu.Unlock()
		return
	}
	if state.idleTimer != nil {
		state.idleTimer.Stop()
	}
	state.idleTimer = nil
	idle := state.process != nil && !state.closed && !state.stopping
	if idle && state.process.conn.PendingRequests() > 0 {
		state.mu.Unlock()
		m.armIdle(state)
		return
	}
	if idle && !m.activity.CanSuspend("code-studio:"+string(state.id), activity.Resource{Kind: "language-server", Restorable: true, UserInitiated: state.userInitiated}, true) {
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
		state.mu.Lock()
		exited := state.process == nil
		state.mu.Unlock()
		if exited {
			m.activity.Released(lspActivityID(state))
			// Visibility may have returned while stopLocked was waiting for exit.
			if m.activity.State("code-studio:"+string(state.id)) == activity.Active {
				go m.resumeIdle(state)
			}
		}
	}
}

func lspActivityID(state *lspSession) string {
	return "lsp:" + string(state.id) + ":" + state.language
}

func (m *LSPManager) setActivityManager(manager *activity.Manager) {
	if m.unsubscribeActivity != nil {
		m.unsubscribeActivity()
	}
	m.activity = manager
	m.unsubscribeActivity = manager.Subscribe(m.reconcileActivity)
}

func (m *LSPManager) reconcileActivity() {
	m.mu.Lock()
	states := make([]*lspSession, 0, len(m.sessions))
	for _, state := range m.sessions {
		states = append(states, state)
	}
	m.mu.Unlock()
	for _, state := range states {
		if m.activity.State("code-studio:"+string(state.id)) == activity.Active {
			state.mu.Lock()
			state.inactiveSince = time.Time{}
			if state.idleTimer != nil {
				state.idleTimer.Stop()
				state.idleTimer = nil
			}
			state.idleEpoch++
			resume := state.suspended && !state.closed && state.process == nil
			state.mu.Unlock()
			if resume {
				go m.resumeIdle(state)
			}
		} else {
			m.armIdle(state)
		}
	}
}

func (m *LSPManager) resumeIdle(state *lspSession) {
	m.resumeSuspended(state, false)
}

func (m *LSPManager) resumeSuspended(state *lspSession, documentOpened bool) {
	state.lifecycle.Lock()
	defer state.lifecycle.Unlock()
	state.mu.Lock()
	if !state.suspended || state.closed || state.process != nil || state.launching || (!documentOpened && m.activity.State("code-studio:"+string(state.id)) != activity.Active) {
		state.mu.Unlock()
		return
	}
	state.suspended, state.stopping, state.launching = false, false, true
	state.restartEpoch++
	state.status.State = LanguageServerStarting
	state.status.Error = ""
	state.mu.Unlock()
	m.activity.Track(lspActivityID(state), "code-studio:"+string(state.id))
	m.publishStatus(state)
	if err := m.launch(state); err != nil {
		m.setState(state, LanguageServerCrashed, err.Error())
	}
	m.armIdle(state)
}

// SetActivityManager is called by the desktop composition root before starting sessions.
func (s *Service) SetActivityManager(manager *activity.Manager) {
	if manager != nil {
		s.lsp.setActivityManager(manager)
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
