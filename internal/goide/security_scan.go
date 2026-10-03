package goide

import (
	"adomnia/internal/ide/security"
	"adomnia/internal/languages/golang"
)

// Alias della facciata: le binding Wails e il frontend vedono i tipi del core tramite goide.
type (
	SecurityReport  = security.Report
	SecurityFinding = security.Finding
)

// securityAnalyzers compone lo scanner: i segreti valgono per ogni file, le regole statiche arrivano dagli adapter.
func securityAnalyzers() []security.Analyzer {
	return []security.Analyzer{security.SecretsAnalyzer{}, golang.SecurityAnalyzer{}}
}

// SecurityScan analizza i file del progetto offline: segreti, TLS, crypto, injection, permessi.
// Legge soltanto i file, non avvia processi e non usa la rete.
func (s *Service) SecurityScan(sessionID string) (security.Report, error) {
	session, err := s.session(sessionID)
	if err != nil {
		return security.Report{}, err
	}
	return security.Scan(session.Project.RealPath, securityAnalyzers()...)
}

// SuppressSecurityFinding accetta un finding con una motivazione scritta in .adomnia/security.json.
func (s *Service) SuppressSecurityFinding(sessionID string, finding security.Finding, reason string) error {
	session, err := s.session(sessionID)
	if err != nil {
		return err
	}
	return security.Suppress(session.Project.RealPath, finding, reason)
}

// UnsuppressSecurityFinding toglie una soppressione registrata dal pannello.
func (s *Service) UnsuppressSecurityFinding(sessionID, fingerprint string) error {
	session, err := s.session(sessionID)
	if err != nil {
		return err
	}
	return security.Unsuppress(session.Project.RealPath, fingerprint)
}

// SaveSecurityBaseline rianalizza il progetto e accetta i finding attuali: poi si vedono solo i nuovi.
func (s *Service) SaveSecurityBaseline(sessionID string) (int, error) {
	report, err := s.SecurityScan(sessionID)
	if err != nil {
		return 0, err
	}
	return security.SaveBaseline(report.Root, report.Findings)
}

// ClearSecurityBaseline rimuove la baseline di sicurezza del progetto.
func (s *Service) ClearSecurityBaseline(sessionID string) error {
	session, err := s.session(sessionID)
	if err != nil {
		return err
	}
	return security.ClearBaseline(session.Project.RealPath)
}
