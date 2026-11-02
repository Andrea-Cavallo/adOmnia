package codestudio

import (
	"context"
	"slices"
	"sync"
	"time"

	"github.com/Andrea-Cavallo/adOmnia/internal/ide/project"
)

// defaultDetectionWait è quanto l'apertura attende la detection: i progetti piccoli tornano già completi,
// quelli grandi mostrano subito l'albero e ricevono le unità con session.updated.
const productionDetectionWait = 100 * time.Millisecond

var defaultDetectionWait = productionDetectionWait

// awaitDetection avvia la detection di session e attende al massimo detectWait. Se la detection finisce dopo
// la risposta, late(id) viene chiamata una sola volta, con le unità già salvate nella sessione.
func (m *WorkspaceManager) awaitDetection(ctx context.Context, session Session, late func(SessionID)) Session {
	var mu sync.Mutex
	responded, finished := false, false
	done := make(chan Session, 1)
	go func() {
		units := detectUnits(ctx, m.languages, session.Project.RootPath, m.onDetected)
		updated, open := m.finishDetection(session.ID, units)
		if !open {
			updated = session
		}
		mu.Lock()
		finished = true
		notifyLate := responded
		mu.Unlock()
		if !notifyLate {
			done <- updated
			return
		}
		if open && late != nil {
			late(session.ID)
		}
	}()
	timer := time.NewTimer(m.detectWait)
	defer timer.Stop()
	select {
	case updated := <-done:
		return updated
	case <-timer.C:
	}
	mu.Lock()
	if finished {
		mu.Unlock()
		return <-done
	}
	responded = true
	mu.Unlock()
	return session
}

// finishDetection salva le unità nella sessione ancora aperta e chiude il suo contesto di detection.
func (m *WorkspaceManager) finishDetection(id SessionID, units []project.Unit) (Session, bool) {
	m.mu.Lock()
	defer m.mu.Unlock()
	if cancel, ok := m.detections[id]; ok {
		cancel()
		delete(m.detections, id)
	}
	session, ok := m.sessions[id]
	if !ok {
		return Session{}, false
	}
	session.Project.Units = units
	session.UpdatedAt = time.Now().UTC()
	m.sessions[id] = session
	return session, true
}

// CancelDetections ferma le detection ancora in corso (shutdown del servizio).
func (m *WorkspaceManager) CancelDetections() {
	m.mu.Lock()
	defer m.mu.Unlock()
	for id, cancel := range m.detections {
		cancel()
		delete(m.detections, id)
	}
}

// RedetectUnits refreshes the units of a restored session. Persisted units go stale when the project
// gains or loses a manifest (go.mod, pyproject.toml, pom.xml…) while adOmnia is closed, and a
// session restored at startup never ran detection. Reports whether the units changed.
func (m *WorkspaceManager) RedetectUnits(ctx context.Context, id SessionID) bool {
	m.mu.RLock()
	session, ok := m.sessions[id]
	m.mu.RUnlock()
	if !ok {
		return false
	}
	units := detectUnits(ctx, m.languages, session.Project.RootPath)
	if slices.Equal(units, session.Project.Units) {
		return false
	}
	_, open := m.finishDetection(id, units)
	return open
}
