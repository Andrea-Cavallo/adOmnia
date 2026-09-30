package goide

import "sync"

// DocumentObserver riceve il ciclo di vita dei documenti editabili, lo stesso che alimenta gopls.
// Serve a integrazioni opzionali (GitHub Copilot) senza che goide ne dipenda.
type DocumentObserver interface {
	DocumentOpened(session Session, document Document, text string)
	DocumentChanged(documentID DocumentID, version int, text string)
	DocumentSaved(documentID DocumentID)
	DocumentClosed(documentID DocumentID)
}

type observerSlot struct {
	mu       sync.RWMutex
	observer DocumentObserver
}

// SetDocumentObserver collega un osservatore ai documenti di tutte le sessioni; nil lo scollega.
func (s *Service) SetDocumentObserver(observer DocumentObserver) {
	s.documentObserver.mu.Lock()
	s.documentObserver.observer = observer
	s.documentObserver.mu.Unlock()
}

// observeDocuments chiama l'osservatore, se presente, fuori dal lock.
func (s *Service) observeDocuments(notify func(DocumentObserver)) {
	s.documentObserver.mu.RLock()
	observer := s.documentObserver.observer
	s.documentObserver.mu.RUnlock()
	if observer != nil {
		notify(observer)
	}
}
