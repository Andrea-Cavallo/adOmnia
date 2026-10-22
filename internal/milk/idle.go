package milk

import "time"

const (
	idleLimit = 5 * time.Minute
	idleCheck = 30 * time.Second
)

// reapWhenIdle spegne l'agente dopo idleLimit senza turni né permessi in attesa: un
// processo ACP fermo occupa RAM per niente. Riparte da solo al prossimo Prompt.
func (m *Manager) reapWhenIdle(running *process) {
	ticker := time.NewTicker(idleCheck)
	defer ticker.Stop()
	for {
		select {
		case <-running.exited:
			return
		case <-ticker.C:
			if m.markIdle(running) {
				m.Stop()
				return
			}
		}
	}
}

func (m *Manager) markIdle(running *process) bool {
	m.mu.Lock()
	defer m.mu.Unlock()
	if m.current != running || len(m.turns) > 0 || len(m.ambient) > 0 || len(m.pending) > 0 || time.Since(m.lastUsed) < idleLimit {
		return false
	}
	m.idleStopped = true
	return true
}

// wakeIfIdle riavvia l'agente spento per inattività; chiamato all'inizio di ogni Prompt.
func (m *Manager) wakeIfIdle() error {
	m.mu.Lock()
	m.lastUsed = time.Now()
	idle := m.idleStopped
	m.idleStopped = false
	m.mu.Unlock()
	if !idle {
		return nil
	}
	m.Stop() // aspetta l'uscita se lo spegnimento è ancora in corso
	return m.Start()
}
