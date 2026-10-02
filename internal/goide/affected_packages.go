package goide

import (
	"fmt"
	"path/filepath"
	"sort"
	"strings"
	"time"
)

const affectedPackagesTimeout = 2 * time.Minute

// affectedListFormat: import path, cartella, import, import dei test interni ed esterni.
const affectedListFormat = `{{.ImportPath}}|{{.Dir}}|{{join .Imports " "}}|{{join .TestImports " "}}|{{join .XTestImports " "}}`

// AffectedTestPackages espande i package indicati (pattern relativi al modulo, es. "./api") con
// quelli del modulo che li importano, anche transitivamente, e con quelli i cui test li importano:
// sono i package da ritestare dopo una modifica. Usa `go list`, senza rete.
func (s *Service) AffectedTestPackages(sessionID, moduleDirectory string, packages []string) ([]string, error) {
	session, err := s.session(sessionID)
	if err != nil {
		return nil, err
	}
	if session.Project.Authorization != AuthorizationPermitted {
		return nil, fmt.Errorf("autorizza esplicitamente gli strumenti per questo progetto")
	}
	directory, err := s.documents.resolveDirectory(session.Project, moduleDirectory)
	if err != nil {
		return nil, err
	}
	for _, pattern := range packages {
		if err := validateRunTarget(session.Project.RealPath, directory, pattern); err != nil {
			return nil, err
		}
	}
	output, err := s.runModuleCommand(session.ID, directory, affectedPackagesTimeout, "list", "-e", "-f", affectedListFormat, "./...")
	if err != nil {
		return nil, err
	}
	return affectedPackages(directory, output, packages), nil
}

type listedPackage struct {
	importPath, directory string
	imports, testImports  []string
}

func parseAffectedList(output string) []listedPackage {
	listed := []listedPackage{}
	for _, line := range strings.Split(output, "\n") {
		fields := strings.Split(strings.TrimRight(line, "\r"), "|")
		if len(fields) != 5 || fields[0] == "" || fields[1] == "" {
			continue // avvisi di go list su stderr
		}
		listed = append(listed, listedPackage{
			importPath: fields[0], directory: fields[1], imports: strings.Fields(fields[2]),
			testImports: append(strings.Fields(fields[3]), strings.Fields(fields[4])...),
		})
	}
	return listed
}

// affectedPackages è pura: propaga attraverso gli import normali, poi aggiunge i package i cui test
// importano un package coinvolto (un import di test non coinvolge chi importa quel package).
func affectedPackages(moduleDirectory, output string, patterns []string) []string {
	listed := parseAffectedList(output)
	byDirectory := map[string]string{}
	importers := map[string][]string{}
	for _, pkg := range listed {
		byDirectory[filepath.Clean(pkg.directory)] = pkg.importPath
		for _, imported := range pkg.imports {
			importers[imported] = append(importers[imported], pkg.importPath)
		}
	}
	affected := map[string]bool{}
	queue := []string{}
	for _, pattern := range patterns {
		if importPath, ok := byDirectory[filepath.Clean(filepath.Join(moduleDirectory, filepath.FromSlash(pattern)))]; ok && !affected[importPath] {
			affected[importPath] = true
			queue = append(queue, importPath)
		}
	}
	for len(queue) > 0 {
		current := queue[0]
		queue = queue[1:]
		for _, importer := range importers[current] {
			if !affected[importer] {
				affected[importer] = true
				queue = append(queue, importer)
			}
		}
	}
	result := map[string]bool{}
	for _, pattern := range patterns {
		result[pattern] = true
	}
	for _, pkg := range listed {
		include := affected[pkg.importPath]
		for _, imported := range pkg.testImports {
			include = include || affected[imported]
		}
		if !include {
			continue
		}
		if relative, err := filepath.Rel(moduleDirectory, pkg.directory); err == nil && !strings.HasPrefix(relative, "..") {
			if relative = filepath.ToSlash(relative); relative == "." {
				result["."] = true
			} else {
				result["./"+relative] = true
			}
		}
	}
	ordered := make([]string, 0, len(result))
	for pattern := range result {
		ordered = append(ordered, pattern)
	}
	sort.Strings(ordered)
	return ordered
}
