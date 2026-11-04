package codestudio

import (
	"path/filepath"

	"github.com/Andrea-Cavallo/adOmnia/internal/ide/graph"
	"github.com/Andrea-Cavallo/adOmnia/internal/languages/golang"
	"github.com/Andrea-Cavallo/adOmnia/internal/protodoc"
)

// DocumentationReport is the project documentation: Go packages (go/doc), exported symbols without
// a doc comment (with the stub to insert) and .proto files. Read and parse only: no process.
type DocumentationReport struct {
	Packages []golang.PackageDoc    `json:"packages"`
	Problems []ErrorHandlingFinding `json:"problems"`
	Protos   []protodoc.File        `json:"protos"`
}

// documentationSource selects the files the documentation reads: Go packages and .proto files.
func documentationSource(rel string) bool { return isGoSource(rel) || isProtoSource(rel) }

// Documentation reads the documentation of every Go package and .proto file, reusing the result
// until those files change: the Docs panel used to re-read and re-parse the whole project on every
// open.
func (s *Service) Documentation(sessionID string) (DocumentationReport, error) {
	session, err := s.session(sessionID)
	if err != nil {
		return DocumentationReport{}, err
	}
	generation, watchedFully := s.sourceGeneration(sessionID)
	return s.analysis.documentation.load(analysisRequest[DocumentationReport]{
		sessionID:    sessionID,
		generation:   generation,
		watchedFully: watchedFully,
		fingerprint: func() (string, error) {
			return graph.Fingerprint(session.Project.RealPath, documentationSource)
		},
		build: func() (DocumentationReport, error) { return s.documentation(session) },
	})
}

// documentation is the parse itself, without the cache.
func (s *Service) documentation(session Session) (DocumentationReport, error) {
	root := session.Project.RealPath
	texts := newErrorTexts(root)
	resolve := func(path string, offset int) (string, int, int) {
		if _, err := texts.read(path); err != nil {
			return "", 0, 0
		}
		location := texts.location(path, offset)
		return location.RelativePath, location.Line, location.Column
	}
	report := DocumentationReport{Packages: golang.PackageDocs(root, func(dir string) string { return packageImportPath(root, dir) }), Problems: []ErrorHandlingFinding{}, Protos: protodoc.Collect(root)}
	for index := range report.Packages {
		pkg := &report.Packages[index]
		for _, problem := range pkg.Problems {
			kind := "doc-format"
			if problem.Fix != nil {
				kind = "doc-missing"
			}
			// Stubs become findings like the error analysis ones: the same fix with one click.
			analysis := golang.ErrorReport{Findings: []golang.ErrorFinding{{Kind: kind, Severity: "info", Message: problem.Problem, Function: pkg.Name + "." + problem.Name, Path: problem.Site.Path, Offset: problem.Site.Offset, End: problem.Site.Offset, Fix: problem.Fix}}}
			if _, err := texts.read(problem.Site.Path); err != nil {
				continue
			}
			var converted ErrorHandlingReport
			texts.merge(&converted, analysis)
			report.Problems = append(report.Problems, converted.Findings...)
		}
		pkg.Problems = []golang.DocProblem{}
		pkg.Resolve(resolve)
		pkg.Dir = filepath.ToSlash(relativeOrDot(root, pkg.Dir))
	}
	return report, nil
}
