package codestudio

import "github.com/Andrea-Cavallo/adOmnia/internal/languages/golang"

// ListTraceFiles cerca i file di esecuzione trace (`trace.out`, `trace-*.out`, `*.trace`) dentro il progetto.
func (s *Service) ListTraceFiles(sessionID string) ([]ProfileFile, error) {
	session, err := s.session(sessionID)
	if err != nil {
		return nil, err
	}
	return golang.ListTraceFiles(session.Project.RealPath)
}

// LoadTrace interpreta un file trace del progetto in una timeline per il viewer.
func (s *Service) LoadTrace(sessionID, relativePath string) (TraceReport, error) {
	session, err := s.session(sessionID)
	if err != nil {
		return TraceReport{}, err
	}
	return golang.LoadTrace(session.Project.RealPath, relativePath)
}
