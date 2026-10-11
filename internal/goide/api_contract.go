package goide

import (
	"os"
	"path/filepath"

	"adomnia/internal/ide/apicontract"
	"adomnia/internal/languages/golang"
)

// APIContractReport confronta le route del codice con il contratto OpenAPI del progetto.
type APIContractReport struct {
	Contract   string              `json:"contract"`
	Operations int                 `json:"operations"`
	Documented int                 `json:"documented"`
	Issues     []apicontract.Issue `json:"issues"`
}

// APIContractDrift trova il primo OpenAPI del progetto e lo confronta con route e DTO del codice.
func (s *Service) APIContractDrift(sessionID string) (APIContractReport, error) {
	session, err := s.session(sessionID)
	if err != nil {
		return APIContractReport{}, err
	}
	result, err := s.AnalyzeArchitecture(sessionID)
	if err != nil {
		return APIContractReport{}, err
	}
	operations := golang.APIOperations(result.Report)
	report := APIContractReport{Operations: len(operations), Issues: []apicontract.Issue{}}
	report.Contract = apicontract.FindContract(session.Project.RealPath)
	if report.Contract == "" {
		return report, nil
	}
	data, err := os.ReadFile(filepath.Join(session.Project.RealPath, filepath.FromSlash(report.Contract)))
	if err != nil {
		return report, err
	}
	contract, err := apicontract.ParseContract(report.Contract, data)
	if err != nil {
		return report, err
	}
	report.Documented = len(contract.Operations)
	report.Issues = apicontract.CompareWithContract(operations, contract)
	return report, nil
}

// CompareAPI confronta route e DTO di oggi con quelli di un branch, tag o commit.
func (s *Service) CompareAPI(sessionID, ref string) ([]apicontract.Issue, error) {
	current, err := s.AnalyzeArchitecture(sessionID)
	if err != nil {
		return nil, err
	}
	base, err := s.analyzeRevision(sessionID, ref)
	if err != nil {
		return nil, err
	}
	return apicontract.CompareRevisions(golang.APIOperations(base.Report), golang.APIOperations(current.Report)), nil
}
