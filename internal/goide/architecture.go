package goide

import (
	"adomnia/internal/languages/golang"
)

// ArchitectureReport è il modello dell'architettura del progetto (package, chiamate, moduli,
// interfacce, entry point e servizi), calcolato dall'adapter Go.
type ArchitectureReport = golang.ArchitectureReport

// ArchitectureResult accompagna il report con i problemi di caricamento dei moduli.
type ArchitectureResult struct {
	Report   ArchitectureReport `json:"report"`
	Problems []string           `json:"problems"`
	Modules  int                `json:"modules"`
}

// AnalyzeArchitecture carica ogni modulo con go/packages (progetto autorizzato) e ne costruisce il modello.
func (s *Service) AnalyzeArchitecture(sessionID string) (ArchitectureResult, error) {
	result := ArchitectureResult{}
	var texts *errorTexts
	problems, err := s.forEachGoModule(sessionID, func(root string, module loadedGoModule) {
		if texts == nil {
			texts = newErrorTexts(root)
		}
		report := golang.AnalyzeArchitecture(module.fset, module.packages, texts.read)
		report.Resolve(func(path string, offset int) (string, int, int) {
			if _, err := texts.read(path); err != nil {
				return "", 0, 0
			}
			location := texts.location(path, offset)
			return location.RelativePath, location.Line, location.Column
		})
		if result.Modules == 0 {
			result.Report = report
		} else {
			result.Report.Merge(report)
		}
		result.Modules++
	})
	if err != nil {
		return ArchitectureResult{}, err
	}
	result.Problems = problems
	return result, nil
}
