package codestudio

import "github.com/Andrea-Cavallo/adOmnia/internal/languages/golang"

// ListProfileFiles cerca i profili pprof (*.pprof) dentro il progetto, ignorando .git e node_modules.
func (s *Service) ListProfileFiles(sessionID string) ([]ProfileFile, error) {
	session, err := s.session(sessionID)
	if err != nil {
		return nil, err
	}
	return golang.ListProfileFiles(session.Project.RealPath)
}

// LoadProfile interpreta un file pprof del progetto. relativePath può essere relativo o assoluto,
// ma deve restare dentro il progetto.
func (s *Service) LoadProfile(sessionID, relativePath string) (ProfileReport, error) {
	session, err := s.session(sessionID)
	if err != nil {
		return ProfileReport{}, err
	}
	return golang.LoadProfile(session.Project.RealPath, relativePath)
}
