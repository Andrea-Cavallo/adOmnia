package codestudio

import (
	"sync"
	"time"
)

// defaultIndexWarmDelay sposta la costruzione dell'indice Quick Open fuori dal percorso dell'utente:
// parte dopo il watcher e dopo i primi secondi dall'apertura, così la prima ricerca trova l'indice pronto
// senza rubare CPU all'apertura. Zero o negativo la disattiva (test).
var defaultIndexWarmDelay = 2 * time.Second

// indexWarmer tiene un timer per sessione; chiusura e shutdown lo fermano prima che parta.
type indexWarmer struct {
	mu     sync.Mutex
	delay  time.Duration
	timers map[SessionID]*time.Timer
	closed bool
}

func newIndexWarmer() *indexWarmer {
	return &indexWarmer{delay: defaultIndexWarmDelay, timers: make(map[SessionID]*time.Timer)}
}

func (w *indexWarmer) schedule(id SessionID, build func()) {
	w.mu.Lock()
	defer w.mu.Unlock()
	if w.closed || w.delay <= 0 || w.timers[id] != nil {
		return
	}
	w.timers[id] = time.AfterFunc(w.delay, func() {
		w.mu.Lock()
		_, pending := w.timers[id]
		delete(w.timers, id)
		w.mu.Unlock()
		if pending {
			build()
		}
	})
}

func (w *indexWarmer) stop(id SessionID) {
	w.mu.Lock()
	defer w.mu.Unlock()
	if timer := w.timers[id]; timer != nil {
		timer.Stop()
		delete(w.timers, id)
	}
}

func (w *indexWarmer) stopAll() {
	w.mu.Lock()
	defer w.mu.Unlock()
	w.closed = true
	for id, timer := range w.timers {
		timer.Stop()
		delete(w.timers, id)
	}
}

// warmFileIndex prepara l'indice Quick Open della sessione in background, se è ancora aperta.
func (s *Service) warmFileIndex(id SessionID) {
	s.warmer.schedule(id, func() {
		session, err := s.workspace.GetSession(id)
		if err != nil {
			return
		}
		// Best effort: se fallisce, la prima ricerca ricostruisce e mostra l'errore.
		_, _ = s.documents.projectFiles(session.Project)
	})
}
