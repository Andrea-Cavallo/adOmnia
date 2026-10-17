package eclipsepde

import (
	"fmt"
	"path/filepath"
)

// ClasspathElement is one entry of the PDE compile classpath of a project.
type ClasspathElement struct {
	// Kind is "project" (workspace bundle), "bundle" (target jar/exploded) or
	// "library" (a bundle-internal jar from Bundle-ClassPath).
	Kind string
	// Path is the filesystem path or the workspace project name.
	Path string
	// From is the symbolic name of the bundle that contributed the entry.
	From string
	// Optional marks entries that came from optional requirements: PDE keeps
	// them out of the required compile classpath.
	Optional bool
}

// BuildClasspath reconstructs the PDE compile classpath of one project: the
// resolved Require-Bundle and Import-Package providers, expanded through
// Bundle-ClassPath and visibility:=reexport, workspace bundles first. It is the
// "coerente con il modello PDE, non un semplice classpath cumulativo di tutti i
// JAR" of spec section 8: only what the bundle actually requires is included.
//
// Errors are returned alongside the classpath so a caller can still show what
// resolved before the first failure.
func (r *Resolver) BuildClasspath(proj *EclipseProject) ([]ClasspathElement, []Problem) {
	var elements []ClasspathElement
	var problems []Problem
	if proj.Bundle == nil {
		problems = append(problems, Problem{
			Severity: "warning", Project: proj.Name,
			Message: "not an OSGi bundle: compile classpath falls back to .classpath libraries",
		})
		for _, e := range proj.ClasspathEntries {
			if e.Kind == "lib" {
				elements = append(elements, ClasspathElement{Kind: "library", Path: e.Path, From: proj.Name})
			}
		}
		return elements, problems
	}

	seen := map[string]bool{}
	for _, clause := range proj.Bundle.RequireBundle {
		req := requirementOf("Require-Bundle", clause)
		match, candidates, ok := r.Index.BestMatch(req.Name, req.Range, req.RangeOK)
		if !ok {
			problems = append(problems, missingProblem(proj.Name, req, candidates, []string{proj.Name}, clause.IsOptional()))
			continue
		}
		r.appendBundleElements(match, clause.IsOptional(), seen, &elements, &problems, proj.Name)
	}

	for _, clause := range proj.Bundle.ImportPackage {
		req := requirementOf("Import-Package", clause)
		providers := r.Index.ProvidersOf(req.Name)
		var chosen *Provider
		for i := len(providers) - 1; i >= 0; i-- {
			if !req.RangeOK || req.Range.Match(providers[i].ExportVersion) {
				chosen = &providers[i]
				break
			}
		}
		if chosen == nil {
			var candidates []string
			for _, p := range providers {
				candidates = append(candidates, p.ExportVersion.String()+" ("+p.Entry.Bundle.SymbolicName+")")
			}
			problems = append(problems, missingProblem(proj.Name, req, candidates, []string{proj.Name}, clause.IsOptional()))
			continue
		}
		r.appendBundleElements(chosen.Entry, clause.IsOptional(), seen, &elements, &problems, proj.Name)
	}
	return elements, problems
}

// appendBundleElements adds the classpath contribution of one resolved bundle:
// the bundle itself plus its Bundle-ClassPath libraries. The bundle's own
// visibility:=reexport clauses are followed transitively: their exports flow up
// through the requiring chain, which is what PDE puts on the compile classpath.
func (r *Resolver) appendBundleElements(entry *IndexedBundle, optional bool, seen map[string]bool, elements *[]ClasspathElement, problems *[]Problem, fromProject string) {
	key := entry.Bundle.SymbolicName + " " + entry.Bundle.Version.String()
	if seen[key] {
		return
	}
	seen[key] = true

	el := ClasspathElement{Kind: "bundle", Path: entry.Bundle.Location, From: entry.Bundle.SymbolicName, Optional: optional}
	if entry.Source == SourceWorkspace {
		el.Kind = "project"
		el.Path = entry.Bundle.SymbolicName
	}
	*elements = append(*elements, el)

	for _, cp := range entry.Bundle.BundleClassPath {
		if cp == "." {
			continue
		}
		*elements = append(*elements, ClasspathElement{
			Kind:     "library",
			Path:     filepath.Join(entry.Bundle.Location, filepath.FromSlash(cp)),
			From:     entry.Bundle.SymbolicName,
			Optional: optional,
		})
	}

	for _, clause := range entry.Bundle.RequireBundle {
		if !clause.IsReexport() {
			continue
		}
		sub := requirementOf("Require-Bundle", clause)
		match, candidates, ok := r.Index.BestMatch(sub.Name, sub.Range, sub.RangeOK)
		if !ok {
			*problems = append(*problems, missingProblem(fromProject, sub, candidates, []string{fromProject, entry.Bundle.SymbolicName}, clause.IsOptional()))
			continue
		}
		r.appendBundleElements(match, optional, seen, elements, problems, fromProject)
	}
}

func missingProblem(project string, req Requirement, candidates []string, chain []string, optional bool) Problem {
	severity := "error"
	prefix := "cannot resolve"
	if optional {
		severity = "warning"
		prefix = "optional requirement not satisfied"
	}
	return Problem{
		Severity: severity, Project: project,
		Message: fmt.Sprintf("%s %s (available: %s; chain: %s)",
			prefix, req.String(), joinOrNone(candidates), joinChain(chain)),
	}
}

func joinChain(chain []string) string {
	out := ""
	for i, c := range chain {
		if i > 0 {
			out += " → "
		}
		out += c
	}
	return out
}

func joinOrNone(values []string) string {
	if len(values) == 0 {
		return "none"
	}
	out := values[0]
	for _, v := range values[1:] {
		out += ", " + v
	}
	return out
}
