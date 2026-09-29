package goide

import (
	"errors"
	"fmt"
	"maps"
	"regexp"
	"sync"
)

// MainWindowID identifica la finestra principale di adOmnia, proprietaria
// implicita di ogni sessione che non è stata spostata in una finestra separata.
const MainWindowID = "main"

var windowIDPattern = regexp.MustCompile(`^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$`)

// ErrSessionInOtherWindow segnala che il progetto è aperto in modifica in
// un'altra finestra: i buffer non salvati vivono nel frontend di ciascuna
// finestra, quindi due finestre sulla stessa sessione si sovrascriverebbero.
var ErrSessionInOtherWindow = errors.New("il progetto è aperto in un'altra finestra")

// SessionWindow indica quale finestra possiede una sessione.
type SessionWindow struct {
	SessionID SessionID `json:"sessionId"`
	WindowID  string    `json:"windowId"`
	// PreviousWindowID è valorizzato negli eventi di passaggio di proprietà.
	PreviousWindowID string `json:"previousWindowId,omitempty"`
}

// windowRegistry registra le sessioni spostate in finestre separate. Una
// sessione assente dalla mappa appartiene alla finestra principale.
type windowRegistry struct {
	mu     sync.Mutex
	owners map[SessionID]string
}

func newWindowRegistry() *windowRegistry {
	return &windowRegistry{owners: make(map[SessionID]string)}
}

func (r *windowRegistry) owner(sessionID SessionID) string {
	r.mu.Lock()
	defer r.mu.Unlock()
	if owner, ok := r.owners[sessionID]; ok {
		return owner
	}
	return MainWindowID
}

// claim assegna la sessione alla finestra. Senza force fallisce se un'altra
// finestra la possiede già; restituisce il proprietario precedente.
func (r *windowRegistry) claim(sessionID SessionID, windowID string, force bool) (string, error) {
	r.mu.Lock()
	defer r.mu.Unlock()
	previous, ok := r.owners[sessionID]
	if !ok {
		previous = MainWindowID
	}
	if previous != windowID && !force {
		return previous, ErrSessionInOtherWindow
	}
	if windowID == MainWindowID {
		delete(r.owners, sessionID)
	} else {
		r.owners[sessionID] = windowID
	}
	return previous, nil
}

// releaseWindow restituisce alla finestra principale le sessioni della finestra chiusa.
func (r *windowRegistry) releaseWindow(windowID string) []SessionID {
	r.mu.Lock()
	defer r.mu.Unlock()
	released := make([]SessionID, 0, 1)
	for sessionID, owner := range r.owners {
		if owner == windowID {
			delete(r.owners, sessionID)
			released = append(released, sessionID)
		}
	}
	return released
}

func (r *windowRegistry) forget(sessionID SessionID) {
	r.mu.Lock()
	delete(r.owners, sessionID)
	r.mu.Unlock()
}

func (r *windowRegistry) snapshot() map[SessionID]string {
	r.mu.Lock()
	defer r.mu.Unlock()
	return maps.Clone(r.owners)
}

func validateWindowID(windowID string) error {
	if !windowIDPattern.MatchString(windowID) {
		return fmt.Errorf("identificativo di finestra non valido: %q", windowID)
	}
	return nil
}

// ClaimSessionWindow assegna la sessione alla finestra indicata. Senza force
// fallisce con ErrSessionInOtherWindow se il progetto è già aperto altrove;
// con force la proprietà passa alla nuova finestra e l'evento
// session.window-changed avvisa la precedente.
func (s *Service) ClaimSessionWindow(sessionID, windowID string, force bool) (SessionWindow, error) {
	session, err := s.session(sessionID)
	if err != nil {
		return SessionWindow{}, err
	}
	if err := validateWindowID(windowID); err != nil {
		return SessionWindow{}, err
	}
	previous, err := s.windows.claim(session.ID, windowID, force)
	if err != nil {
		return SessionWindow{SessionID: session.ID, WindowID: previous}, err
	}
	result := SessionWindow{SessionID: session.ID, WindowID: windowID}
	if previous != windowID {
		result.PreviousWindowID = previous
		s.emit("session.window-changed", session.ID, string(session.ID), result)
	}
	return result, nil
}

// ReleaseWindow restituisce alla finestra principale tutte le sessioni della
// finestra chiusa, così nessun progetto resta irraggiungibile.
func (s *Service) ReleaseWindow(windowID string) []SessionID {
	if windowID == MainWindowID {
		return nil
	}
	released := s.windows.releaseWindow(windowID)
	for _, sessionID := range released {
		s.emit("session.window-changed", sessionID, string(sessionID), SessionWindow{
			SessionID: sessionID, WindowID: MainWindowID, PreviousWindowID: windowID,
		})
	}
	return released
}

// SessionWindowOwner restituisce la finestra che possiede la sessione.
func (s *Service) SessionWindowOwner(sessionID string) (string, error) {
	session, err := s.session(sessionID)
	if err != nil {
		return "", err
	}
	return s.windows.owner(session.ID), nil
}

// ListSessionWindows elenca le sole sessioni spostate in finestre separate.
func (s *Service) ListSessionWindows() []SessionWindow {
	owners := s.windows.snapshot()
	result := make([]SessionWindow, 0, len(owners))
	for sessionID, windowID := range owners {
		result = append(result, SessionWindow{SessionID: sessionID, WindowID: windowID})
	}
	return result
}
