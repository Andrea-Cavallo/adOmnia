package goide

import (
	"sync"
	"sync/atomic"
	"time"
)

type Service struct {
	workspace   *WorkspaceManager
	documents   *DocumentManager
	toolchain   *ToolchainManager
	processes   *ProcessManager
	lsp         *LSPManager
	terminal    *TerminalManager
	debug       *DebugManager
	tests       *TestManager
	persistence *Persistence
	restoreOnce sync.Once
	restoreErr  error
	eventMu     sync.RWMutex
	eventSink   func(EventEnvelope)
	sequence    atomic.Uint64
}

func NewService(store Store, eventSink func(EventEnvelope)) *Service {
	return &Service{
		workspace:   NewWorkspaceManager(),
		documents:   NewDocumentManager(),
		toolchain:   NewToolchainManager(),
		processes:   NewProcessManager(),
		lsp:         NewLSPManager(),
		terminal:    NewTerminalManager(),
		debug:       NewDebugManager(),
		tests:       NewTestManager(),
		persistence: NewPersistence(store),
		eventSink:   eventSink,
	}
}

// GetCapabilities dichiara soltanto le capacità realmente disponibili nello stato corrente.
func (s *Service) GetCapabilities() Capabilities {
	return Capabilities{
		SchemaVersion:    1,
		ProjectOpen:      true,
		MultipleSessions: true,
	}
}

// OpenProject apre una sessione non autorizzata all'esecuzione e non avvia alcuno strumento.
func (s *Service) OpenProject(path string) (Session, error) {
	if err := s.restore(); err != nil {
		return Session{}, err
	}
	session, err := s.workspace.OpenProject(path)
	if err != nil {
		return Session{}, err
	}
	if err := s.persistence.SaveSessions(s.workspace.ListSessions()); err != nil {
		return Session{}, err
	}
	s.emit("session.opened", session.ID, string(session.ID), session)
	return session, nil
}

// ListSessions restituisce le sessioni ripristinate e attualmente aperte.
func (s *Service) ListSessions() ([]Session, error) {
	if err := s.restore(); err != nil {
		return nil, err
	}
	return s.workspace.ListSessions(), nil
}

// SetToolAuthorization registra un consenso esplicito senza avviare processi.
func (s *Service) SetToolAuthorization(id string, allowed bool) (Session, error) {
	if err := s.restore(); err != nil {
		return Session{}, err
	}
	session, err := s.workspace.SetToolAuthorization(SessionID(id), allowed)
	if err != nil {
		return Session{}, err
	}
	if err := s.persistence.SaveSessions(s.workspace.ListSessions()); err != nil {
		return Session{}, err
	}
	s.emit("session.authorization-changed", session.ID, string(session.ID), map[string]any{"authorization": session.Project.Authorization})
	return session, nil
}

// CloseSession chiude soltanto la sessione indicata e persiste il nuovo elenco.
func (s *Service) CloseSession(id string) error {
	if err := s.restore(); err != nil {
		return err
	}
	if !s.workspace.CloseSession(SessionID(id)) {
		return nil
	}
	if err := s.persistence.SaveSessions(s.workspace.ListSessions()); err != nil {
		return err
	}
	s.emit("session.closed", SessionID(id), id, nil)
	return nil
}

// Shutdown arresta le risorse possedute dal dominio in ordine sicuro.
func (s *Service) Shutdown() {
	s.debug.Shutdown()
	s.terminal.Shutdown()
	s.lsp.Shutdown()
	s.processes.Shutdown()
}

func (s *Service) restore() error {
	s.restoreOnce.Do(func() {
		sessions, err := s.persistence.LoadSessions()
		if err != nil {
			s.restoreErr = err
			return
		}
		s.workspace.ReplaceSessions(sessions)
	})
	return s.restoreErr
}

func (s *Service) emit(eventType string, sessionID SessionID, resourceID string, payload any) {
	s.eventMu.RLock()
	sink := s.eventSink
	s.eventMu.RUnlock()
	if sink == nil {
		return
	}
	sink(EventEnvelope{
		Version:    1,
		Type:       eventType,
		SessionID:  sessionID,
		ResourceID: resourceID,
		Sequence:   s.sequence.Add(1),
		Timestamp:  time.Now().UTC(),
		Payload:    payload,
	})
}
