package codestudio

import (
	"fmt"
	"github.com/Andrea-Cavallo/adOmnia/internal/activity"
	"time"
)

// armIdle records when an inactive project's language server became eligible for release.
// There is no timer: going idle never stops the server, because a restart repeats the
// whole workspace load (gopls "Setting up workspace"). Only the global memory budget
// (lsp_budget.go) hibernates the longest-inactive server, and only under memory pressure.
// Buffers and versions survive that suspension and are replayed on resume.
func (m *LSPManager) armIdle(state *lspSession) {
	state.mu.Lock()
	defer state.mu.Unlock()
	if !state.inactiveSince.IsZero() || state.userInitiated || state.process == nil || state.closed || state.stopping {
		return
	}
	if !m.activity.CanSuspend("code-studio:"+string(state.id), activity.Resource{Kind: "language-server", Restorable: true, UserInitiated: state.userInitiated}, true) {
		return
	}
	state.inactiveSince = time.Now()
	state.idleEpoch++
}

func (m *LSPManager) suspendIdle(state *lspSession, epoch uint64) {
	state.lifecycle.Lock()
	defer state.lifecycle.Unlock()
	state.mu.Lock()
	if state.idleEpoch != epoch {
		state.mu.Unlock()
		return
	}
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
	inactiveSince := state.inactiveSince
	if idle {
		state.suspended = true
	}
	state.mu.Unlock()
	if idle {
		inactive := "inactive project"
		if !inactiveSince.IsZero() {
			inactive = "project inactive for " + round(time.Since(inactiveSince)).String()
		}
		m.trace(state, "stopping to free memory (%s); returning to it reloads the workspace", inactive)
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
	id := "lsp:" + string(state.id) + ":" + state.language
	if state.unit != "" {
		id += ":" + state.unit
	}
	return id
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
	if err := m.launch(state, launchReasonResume); err != nil {
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
