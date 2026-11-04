package codestudio

import (
	"github.com/Andrea-Cavallo/adOmnia/internal/ide/graph"
	"github.com/Andrea-Cavallo/adOmnia/internal/languages/golang"
)

// ArchitectureReport is the project architecture model (packages, calls, modules, interfaces,
// entry points and services), computed by the Go adapter.
type ArchitectureReport = golang.ArchitectureReport

// ArchitectureResult pairs the report with the module loading problems.
type ArchitectureResult struct {
	Report   ArchitectureReport `json:"report"`
	Problems []string           `json:"problems"`
	Modules  int                `json:"modules"`
}

// architectureCacheVersion is part of the fingerprint: changing the computation must not reuse an
// in-memory result built by the previous one.
const architectureCacheVersion = "1"

// AnalyzeArchitecture loads every module with go/packages (authorized project) and builds the
// model, reusing the result until the Go sources change. `go list` plus type checking costs
// seconds, and four callers ask for it: Architecture Explorer, API Contract, Memory Model and the
// workspace graph. Without the cache each panel paid for the same load.
func (s *Service) AnalyzeArchitecture(sessionID string) (ArchitectureResult, error) {
	session, err := s.session(sessionID)
	if err != nil {
		return ArchitectureResult{}, err
	}
	generation, watchedFully := s.sourceGeneration(sessionID)
	return s.analysis.architecture.load(analysisRequest[ArchitectureResult]{
		sessionID:    sessionID,
		generation:   generation,
		watchedFully: watchedFully,
		fingerprint: func() (string, error) {
			fingerprint, err := graph.Fingerprint(session.Project.RealPath, isGoSource)
			if err != nil {
				return "", err
			}
			return architectureCacheVersion + ":" + fingerprint, nil
		},
		build: func() (ArchitectureResult, error) { return s.analyzeArchitecture(sessionID) },
	})
}

// analyzeArchitecture is the computation itself, without the cache.
func (s *Service) analyzeArchitecture(sessionID string) (ArchitectureResult, error) {
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
