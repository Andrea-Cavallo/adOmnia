package codestudio

import (
	"errors"

	"github.com/Andrea-Cavallo/adOmnia/internal/eclipsepde"
)

// JavaOsgiWorkspace elenca i bundle OSGi/PDE del progetto e come si risolvono sulla target platform attiva.
func (s *Service) JavaOsgiWorkspace(sessionID string) (*eclipsepde.WorkspaceReport, error) {
	session, err := s.session(sessionID)
	if err != nil {
		return nil, err
	}
	// Il percorso del target arriva da un file del progetto e porta a leggere fuori dal progetto.
	if session.Project.Authorization != AuthorizationPermitted {
		return nil, errors.New("explicitly authorize the tools for this project")
	}
	return eclipsepde.BuildReport(session.Project.RealPath)
}

// SetJavaOsgiTarget sceglie la target platform (cartella di bundle, installazione Eclipse o file .target).
// Il percorso può stare fuori dal progetto: Kepler di solito è installato altrove.
func (s *Service) SetJavaOsgiTarget(sessionID, path string) (*eclipsepde.WorkspaceReport, error) {
	session, err := s.session(sessionID)
	if err != nil {
		return nil, err
	}
	if session.Project.Authorization != AuthorizationPermitted {
		return nil, errors.New("explicitly authorize the tools for this project")
	}
	return eclipsepde.SetTarget(session.Project.RealPath, path)
}
