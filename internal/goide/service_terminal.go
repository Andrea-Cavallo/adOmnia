package goide

import "fmt"

// OpenTerminal apre una shell interattiva nella working directory del progetto.
// Richiede l'autorizzazione esplicita agli strumenti: aprire un progetto non
// basta a poter avviare processi.
func (s *Service) OpenTerminal(request TerminalRequest) (TerminalSession, error) {
	session, err := s.session(string(request.SessionID))
	if err != nil {
		return TerminalSession{}, err
	}
	if session.Project.Authorization != AuthorizationPermitted {
		return TerminalSession{}, fmt.Errorf("autorizza esplicitamente gli strumenti per questo progetto")
	}
	workingDirectory, err := s.documents.resolveDirectory(session.Project, request.WorkingDirectory)
	if err != nil {
		return TerminalSession{}, err
	}
	environment, err := s.toolchain.Environment(session.ID, request.Environment)
	if err != nil {
		return TerminalSession{}, err
	}
	request.SessionID = session.ID
	request.WorkingDirectory = workingDirectory
	return s.terminal.Open(request, environment)
}

// WriteTerminal inoltra l'input dell'utente alla shell indicata.
func (s *Service) WriteTerminal(terminalID, data string) error {
	return s.terminal.Write(TerminalID(terminalID), data)
}

// ResizeTerminal adegua il PTY alle dimensioni correnti del pannello.
func (s *Service) ResizeTerminal(terminalID string, columns, rows int) error {
	return s.terminal.Resize(TerminalID(terminalID), columns, rows)
}

// CloseTerminal termina shell e albero di processi del terminale indicato.
func (s *Service) CloseTerminal(terminalID string) error {
	return s.terminal.Close(TerminalID(terminalID))
}

// ListTerminals elenca i terminali della sola sessione indicata.
func (s *Service) ListTerminals(sessionID string) ([]TerminalSession, error) {
	session, err := s.session(sessionID)
	if err != nil {
		return nil, err
	}
	return s.terminal.List(session.ID), nil
}

// HasActiveTerminals indica se la sessione ha ancora shell vive.
func (s *Service) HasActiveTerminals(sessionID string) bool {
	return s.terminal.HasActiveSession(SessionID(sessionID))
}
