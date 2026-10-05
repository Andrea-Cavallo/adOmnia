package goide

import (
	"path/filepath"

	"adomnia/internal/languages/golang"
	"adomnia/internal/protodoc"
)

// DocumentationReport è la documentazione del progetto: package Go (go/doc), simboli esportati
// senza documentazione (con lo stub da inserire) e file .proto. Solo lettura e parsing: nessun processo.
type DocumentationReport struct {
	Packages []golang.PackageDoc    `json:"packages"`
	Problems []ErrorHandlingFinding `json:"problems"`
	Protos   []protodoc.File        `json:"protos"`
}

// Documentation legge la documentazione di tutti i package Go e dei file .proto del progetto.
func (s *Service) Documentation(sessionID string) (DocumentationReport, error) {
	session, err := s.session(sessionID)
	if err != nil {
		return DocumentationReport{}, err
	}
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
			// Gli stub diventano finding come quelli dell'analisi errori: stesso fix con un clic.
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
