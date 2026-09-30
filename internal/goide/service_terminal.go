package goide

import (
	"fmt"
	"strings"
)

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
	environment, err := s.terminalEnvironment(session.ID, request.Environment)
	if err != nil {
		return TerminalSession{}, err
	}
	// La shell arriva solo da un profilo rilevato: la UI non può chiedere un eseguibile arbitrario.
	profile, err := resolveTerminalProfile(request.Profile)
	if err != nil {
		return TerminalSession{}, err
	}
	request.Shell, request.ShellArguments = profile.Shell, profile.Arguments
	if strings.TrimSpace(request.Name) == "" {
		request.Name = profile.Name
	}
	request.SessionID = session.ID
	request.WorkingDirectory = workingDirectory
	return s.terminal.Open(request, environment)
}

// terminalEnvironment dà alla shell lo stesso Go di Build e gopls (primo nel PATH)
// e dichiara un terminale a colori, così `go`, i test e i tool interattivi si
// comportano come in un terminale esterno.
func (s *Service) terminalEnvironment(sessionID SessionID, overrides map[string]string) ([]string, error) {
	environment, err := s.languageServerEnvironment(sessionID)
	if err != nil {
		return nil, err
	}
	if len(overrides) > 0 {
		merged, err := s.toolchain.Environment(sessionID, overrides)
		if err != nil {
			return nil, err
		}
		environment = mergeEnvironment(environment, merged)
	}
	return withDefaultEnvironment(environment, map[string]string{"TERM": "xterm-256color", "COLORTERM": "truecolor"}), nil
}

// mergeEnvironment applica le voci di overrides sopra base, per nome variabile.
func mergeEnvironment(base, overrides []string) []string {
	index := make(map[string]int, len(base))
	result := append([]string(nil), base...)
	for position, entry := range result {
		name, _, _ := strings.Cut(entry, "=")
		index[strings.ToUpper(name)] = position
	}
	for _, entry := range overrides {
		name, _, _ := strings.Cut(entry, "=")
		if position, ok := index[strings.ToUpper(name)]; ok {
			result[position] = entry
			continue
		}
		result = append(result, entry)
	}
	return result
}

// withDefaultEnvironment aggiunge le variabili indicate solo se l'ambiente non le definisce già.
func withDefaultEnvironment(environment []string, defaults map[string]string) []string {
	present := make(map[string]bool, len(environment))
	for _, entry := range environment {
		name, _, _ := strings.Cut(entry, "=")
		present[strings.ToUpper(name)] = true
	}
	for name, value := range defaults {
		if !present[name] {
			environment = append(environment, name+"="+value)
		}
	}
	return environment
}

// WriteTerminal inoltra l'input dell'utente alla shell indicata.
func (s *Service) WriteTerminal(terminalID, data string) error {
	return s.terminal.Write(TerminalID(terminalID), data)
}

// ResizeTerminal adegua il PTY alle dimensioni correnti del pannello.
func (s *Service) ResizeTerminal(terminalID string, columns, rows int) error {
	return s.terminal.Resize(TerminalID(terminalID), columns, rows)
}

// RenameTerminal cambia il nome mostrato nel tab del terminale.
func (s *Service) RenameTerminal(terminalID, name string) (TerminalSession, error) {
	return s.terminal.Rename(TerminalID(terminalID), name)
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
