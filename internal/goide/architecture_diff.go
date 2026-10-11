package goide

import (
	"errors"
	"os"
	"path/filepath"
	"sort"
	"strings"

	"adomnia/internal/git"
	"adomnia/internal/ide/graph"
	"adomnia/internal/languages/golang"
)

// ArchitectureDiff confronta l'architettura di oggi con quella di un commit o branch:
// stesse regole (quelle di oggi), violazioni nuove o risolte e import fra package cambiati.
type ArchitectureDiff struct {
	Base            string            `json:"base"`
	NewViolations   []graph.Violation `json:"newViolations"`
	FixedViolations []graph.Violation `json:"fixedViolations"`
	AddedImports    []string          `json:"addedImports"`
	RemovedImports  []string          `json:"removedImports"`
	Problems        []string          `json:"problems,omitempty"`
}

// analyzeArchitectureAt è AnalyzeArchitecture su un'altra copia dei sorgenti.
func (s *Service) analyzeArchitectureAt(sessionID, base string) (ArchitectureResult, error) {
	result := ArchitectureResult{}
	var texts *errorTexts
	problems, err := s.forEachGoModuleAt(sessionID, base, func(root string, module loadedGoModule) {
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
	result.Problems = problems
	return result, err
}

func packageImports(g *graph.Graph) map[string]bool {
	kinds := map[string]string{}
	for _, node := range g.Nodes {
		kinds[node.ID] = node.Kind
	}
	out := map[string]bool{}
	for _, edge := range g.Edges {
		if edge.Kind == graph.EdgeImports && kinds[edge.From] == graph.KindPackage && kinds[edge.To] == graph.KindPackage {
			out[strings.TrimPrefix(edge.From, "pkg:")+" → "+strings.TrimPrefix(edge.To, "pkg:")] = true
		}
	}
	return out
}

func violationKey(v graph.Violation) string { return v.Rule + "\x00" + v.Message }

// CompareArchitecture analizza ref in un worktree temporaneo (rimosso alla fine) e lo confronta con oggi.
func (s *Service) CompareArchitecture(sessionID, ref string) (ArchitectureDiff, error) {
	session, err := s.session(sessionID)
	if err != nil {
		return ArchitectureDiff{}, err
	}
	rules, _, err := graph.LoadRules(session.Project.RealPath)
	if err != nil {
		return ArchitectureDiff{}, err
	}
	current, _, err := s.workspaceGraph(sessionID, false)
	if err != nil {
		return ArchitectureDiff{}, err
	}
	base, err := s.analyzeRevision(sessionID, ref)
	if err != nil {
		return ArchitectureDiff{}, err
	}
	builder := golang.GraphFromArchitecture(base.Report)
	baseGraph := builder.Graph()
	baseReport := graph.NewIndex(&baseGraph).CheckDrift(rules, true)
	nowReport := current.index.CheckDrift(rules, true)

	diff := ArchitectureDiff{Base: ref, NewViolations: []graph.Violation{}, FixedViolations: []graph.Violation{}, AddedImports: []string{}, RemovedImports: []string{}, Problems: base.Problems}
	before := map[string]bool{}
	for _, v := range baseReport.Violations {
		before[violationKey(v)] = true
	}
	now := map[string]bool{}
	for _, v := range nowReport.Violations {
		now[violationKey(v)] = true
		if !before[violationKey(v)] {
			diff.NewViolations = append(diff.NewViolations, v)
		}
	}
	for _, v := range baseReport.Violations {
		if !now[violationKey(v)] {
			diff.FixedViolations = append(diff.FixedViolations, v)
		}
	}
	oldImports, newImports := packageImports(&baseGraph), packageImports(&current.graph)
	for edge := range newImports {
		if !oldImports[edge] {
			diff.AddedImports = append(diff.AddedImports, edge)
		}
	}
	for edge := range oldImports {
		if !newImports[edge] {
			diff.RemovedImports = append(diff.RemovedImports, edge)
		}
	}
	sort.Strings(diff.AddedImports)
	sort.Strings(diff.RemovedImports)
	return diff, nil
}

// revisionAnalysis è l'analisi di un'altra revisione; root è la sua copia (già rimossa al ritorno:
// i file non vanno più letti, i percorsi del report sono relativi).
type revisionAnalysis struct {
	ArchitectureResult
	root string
}

// withRevision mette ref in un worktree temporaneo, chiama visit con la cartella del progetto
// dentro quella revisione e rimuove il worktree prima di tornare.
func (s *Service) withRevision(sessionID, ref string, visit func(root string) error) error {
	session, paths, err := s.vcsPaths(sessionID)
	if err != nil {
		return err
	}
	if strings.TrimSpace(ref) == "" {
		return errors.New("choose a branch, tag or commit to compare with")
	}
	temp, err := os.MkdirTemp("", "adomnia-rev-")
	if err != nil {
		return err
	}
	worktree := filepath.Join(temp, "tree")
	defer func() {
		_ = git.RemoveWorktree(paths.repoRoot, worktree, true)
		_ = os.RemoveAll(temp)
	}()
	if err := git.AddDetachedWorktree(paths.repoRoot, worktree, ref); err != nil {
		return err
	}
	// Il progetto può essere una sottocartella del repository.
	sub, _ := filepath.Rel(paths.repoRoot, session.Project.RealPath)
	return visit(filepath.Join(worktree, sub))
}

// analyzeRevision analizza ref in un worktree temporaneo e lo rimuove prima di tornare.
func (s *Service) analyzeRevision(sessionID, ref string) (revisionAnalysis, error) {
	var analysis revisionAnalysis
	err := s.withRevision(sessionID, ref, func(root string) error {
		result, err := s.analyzeArchitectureAt(sessionID, root)
		analysis = revisionAnalysis{ArchitectureResult: result, root: root}
		return err
	})
	return analysis, err
}
