package golang

import (
	"context"
	"os"
	"path/filepath"
	"sort"
	"strings"

	"github.com/Andrea-Cavallo/adOmnia/internal/ide/project"
	"golang.org/x/mod/modfile"
)

const (
	maxLooseGoDirectories = 50
)

// DetectUnits trova i go.mod del progetto, il go.work in radice e le cartelle con file .go non
// coperte da alcun modulo. Ordine: moduli (per percorso), workspace, cartelle sciolte (per percorso).
// La scansione del disco è la stessa condivisa con gli altri linguaggi.
func (l *Language) DetectUnits(ctx context.Context, root string) ([]project.Unit, error) {
	visitor := l.NewUnitsVisitor(root)
	if err := project.WalkDirectories(ctx, root, project.MaxScanDirectories, visitor); err != nil {
		return nil, err
	}
	return visitor.Units()
}

// NewUnitsVisitor raccoglie moduli e cartelle .go da una scansione condivisa.
func (*Language) NewUnitsVisitor(root string) project.UnitsVisitor {
	return &unitsVisitor{root: root, goDirectories: make(map[string]struct{})}
}

// unitsVisitor è il visitor project detection del Go: un solo walk raccoglie i
// go.mod (per cartella) e le cartelle che contengono file .go.
type unitsVisitor struct {
	root          string
	modules       []string
	goDirectories map[string]struct{}
	rootGoWork    bool
}

func (v *unitsVisitor) VisitDirectory(visit project.DirectoryVisit) bool {
	for _, name := range visit.Files {
		if strings.EqualFold(name, "go.mod") {
			v.modules = append(v.modules, filepath.Join(visit.Path, name))
			continue
		}
		if visit.Depth == 0 && name == "go.work" {
			v.rootGoWork = true
			continue
		}
		if strings.EqualFold(filepath.Ext(name), ".go") {
			v.goDirectories[visit.Path] = struct{}{}
		}
	}
	// Il Go vive a ogni profondità: la discesa continua finché il walk ha budget.
	return true
}

func (v *unitsVisitor) Units() ([]project.Unit, error) {
	modules := append([]string(nil), v.modules...)
	sort.Slice(modules, func(i, j int) bool { return filepath.Dir(modules[i]) < filepath.Dir(modules[j]) })
	units := make([]project.Unit, 0, len(modules)+1)
	for _, module := range modules {
		units = append(units, project.Unit{Language: ID, Kind: UnitModule, Root: filepath.Dir(module), Name: ReadModulePath(module), Manifest: module})
	}
	if v.rootGoWork {
		goWork := filepath.Join(v.root, "go.work")
		units = append(units, project.Unit{Language: ID, Kind: UnitWorkspace, Root: v.root, Manifest: goWork})
	}
	for _, directory := range looseDirectories(v.root, modules, v.goDirectories) {
		units = append(units, project.Unit{Language: ID, Kind: UnitLoose, Root: directory})
	}
	return units, nil
}

// looseDirectories restituisce le cartelle .go fuori dai moduli, ordinate per percorso relativo e limitate.
func looseDirectories(root string, modules []string, goDirectories map[string]struct{}) []string {
	type loose struct{ abs, rel string }
	found := make([]loose, 0)
	for directory := range goDirectories {
		if insideAnyModule(directory, modules) {
			continue
		}
		rel, err := filepath.Rel(root, directory)
		if err != nil {
			continue
		}
		found = append(found, loose{abs: directory, rel: filepath.ToSlash(rel)})
	}
	sort.Slice(found, func(i, j int) bool { return found[i].rel < found[j].rel })
	if len(found) > maxLooseGoDirectories {
		found = found[:maxLooseGoDirectories]
	}
	result := make([]string, len(found))
	for index, item := range found {
		result[index] = item.abs
	}
	return result
}

func insideAnyModule(directory string, modules []string) bool {
	for _, module := range modules {
		if project.EnsureWithin(filepath.Dir(module), directory) == nil {
			return true
		}
	}
	return false
}

// ReadModulePath legge la direttiva module di un go.mod; vuoto se assente o illeggibile.
func ReadModulePath(path string) string {
	data, err := os.ReadFile(path)
	if err != nil {
		return ""
	}
	return modfile.ModulePath(data)
}
