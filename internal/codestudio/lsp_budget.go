package codestudio

import (
	"sync"
	"time"

	"github.com/Andrea-Cavallo/adOmnia/internal/activity"
	"github.com/Andrea-Cavallo/adOmnia/internal/resources"
)

const memoryBudgetSampleInterval = 10 * time.Second

type lspMemoryBudget struct {
	policy *resources.MemoryBudget
	wake   chan struct{}
	stop   chan struct{}
	done   chan struct{}
	once   sync.Once
}

// EnableMemoryBudget is called by the desktop composition root before sessions
// start. The controller samples only while at least one server is running.
func (s *Service) EnableMemoryBudget(target uint64) {
	if s.lsp.memoryBudget != nil || target == 0 {
		return
	}
	b := &lspMemoryBudget{policy: resources.NewMemoryBudget(target), wake: make(chan struct{}, 1), stop: make(chan struct{}), done: make(chan struct{})}
	s.lsp.memoryBudget = b
	go s.lsp.monitorMemoryBudget(b)
}

func (m *LSPManager) signalMemoryBudget() {
	if b := m.memoryBudget; b != nil {
		select {
		case b.wake <- struct{}{}:
		default:
		}
	}
}

func (m *LSPManager) stopMemoryBudget() {
	if b := m.memoryBudget; b != nil {
		b.once.Do(func() { close(b.stop) })
		<-b.done
	}
}

func (m *LSPManager) budgetStates() []*lspSession {
	m.mu.Lock()
	defer m.mu.Unlock()
	states := make([]*lspSession, 0, len(m.sessions))
	for _, state := range m.sessions {
		states = append(states, state)
	}
	return states
}

func (m *LSPManager) monitorMemoryBudget(b *lspMemoryBudget) {
	defer close(b.done)
	timer := time.NewTimer(memoryBudgetSampleInterval)
	timer.Stop()
	defer timer.Stop()
	var tick <-chan time.Time
	for {
		select {
		case <-b.stop:
			return
		case <-b.wake:
		case <-tick:
		}
		targets := []resources.Target{}
		for _, state := range m.budgetStates() {
			state.mu.Lock()
			if state.process != nil {
				targets = append(targets, resources.Target{PID: state.status.PID, Name: state.options.DisplayName(), Workspace: state.root})
			}
			state.mu.Unlock()
		}
		if len(targets) == 0 {
			timer.Stop()
			tick = nil
			continue
		}
		snapshot := resources.Sample(targets)
		select {
		case <-b.stop:
			return
		default:
		}
		if len(snapshot.Processes) > 0 && snapshot.Processes[0].RAM > 0 {
			m.enforceMemoryBudget(b.policy, snapshot, time.Now())
		}
		timer.Reset(memoryBudgetSampleInterval)
		tick = timer.C
	}
}

func (m *LSPManager) enforceMemoryBudget(policy *resources.MemoryBudget, sample resources.Snapshot, now time.Time) {
	bytes := make(map[int]uint64, len(sample.Processes))
	for _, usage := range sample.Processes {
		if usage.Error == "" {
			bytes[usage.PID] = usage.RAM
		}
	}
	states := m.budgetStates()
	candidates := make([]resources.BudgetCandidate, 0, len(states))
	owners := make(map[string]*lspSession, len(states))
	epochs := make(map[string]uint64, len(states))
	for _, state := range states {
		state.mu.Lock()
		id := lspActivityID(state)
		eligible := state.process != nil && state.synced == state.process && !state.closed && !state.stopping && !state.launching && !state.userInitiated
		if eligible {
			eligible = state.process.conn.PendingRequests() == 0
		}
		eligible = eligible && m.activity.State("code-studio:"+string(state.id)) != activity.Active
		candidates = append(candidates, resources.BudgetCandidate{ID: id, Bytes: bytes[state.status.PID], Eligible: eligible, InactiveSince: state.inactiveSince, StartedAt: state.startedAt})
		owners[id] = state
		epochs[id] = state.idleEpoch
		state.mu.Unlock()
	}
	selected := policy.Choose(now, sample.RAM, candidates)
	if selected == nil {
		return
	}
	state := owners[selected.ID]
	// Reuse the same lifecycle/visibility/pending-request guards as normal idle
	// suspension. No PID is killed directly by the budget policy.
	m.suspendIdle(state, epochs[selected.ID])
	state.mu.Lock()
	released := state.suspended && state.process == nil
	state.mu.Unlock()
	if released {
		policy.Released(now)
	}
}
