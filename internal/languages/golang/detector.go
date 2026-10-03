package golang

import (
	"bufio"
	"context"
	"os"
	"path/filepath"
	"sort"
	"strings"

	"adomnia/internal/ide/project"
)

const (
	maxModuleScanDirectories = 4_000
	maxLooseGoDirectories    = 50
)

// DetectUnits trova i go.mod del progetto, il go.work in radice e le cartelle con file .go non
// coperte da alcun modulo. Ordine: moduli (per percorso), workspace, cartelle sciolte (per percorso).
func (*Language) DetectUnits(ctx context.Context, root string) ([]project.Unit, error) {
	modules, goDirectories, err := scanModules(ctx, root)
	if err != nil {
		return nil, err
	}
	units := make([]project.Unit, 0, len(modules)+1)
	for _, module := range modules {
		units = append(units, project.Unit{Language: ID, Kind: UnitModule, Root: filepath.Dir(module), Name: ReadModulePath(module), Manifest: module})
	}
	goWork := filepath.Join(root, "go.work")
	if info, statErr := os.Stat(goWork); statErr == nil && !info.IsDir() {
		units = append(units, project.Unit{Language: ID, Kind: UnitWorkspace, Root: root, Manifest: goWork})
	}
	for _, directory := range looseDirectories(root, modules, goDirectories) {
		units = append(units, project.Unit{Language: ID, Kind: UnitLoose, Root: directory})
	}
	return units, nil
}

// scanModules restituisce i go.mod (ordinati per cartella) e le cartelle che contengono file .go.
func scanModules(ctx context.Context, root string) ([]string, map[string]struct{}, error) {
	modules := make([]string, 0, 4)
	goDirectories := make(map[string]struct{})
	visited := 0
	err := filepath.WalkDir(root, func(path string, entry os.DirEntry, walkErr error) error {
		if ctx.Err() != nil {
			return ctx.Err()
		}
		if walkErr != nil {
			if entry != nil && entry.IsDir() {
				return filepath.SkipDir
			}
			return nil
		}
		if entry.IsDir() {
			if path != root && project.IgnoredDirectory(entry.Name()) {
				return filepath.SkipDir
			}
			visited++
			if visited > maxModuleScanDirectories {
				return filepath.SkipAll
			}
			return nil
		}
		name := entry.Name()
		if strings.EqualFold(name, "go.mod") {
			modules = append(modules, path)
			return nil
		}
		if strings.EqualFold(filepath.Ext(name), ".go") {
			goDirectories[filepath.Dir(path)] = struct{}{}
		}
		return nil
	})
	if ctx.Err() != nil {
		return nil, nil, ctx.Err()
	}
	if err != nil {
		return nil, nil, err
	}
	sort.Slice(modules, func(i, j int) bool { return filepath.Dir(modules[i]) < filepath.Dir(modules[j]) })
	return modules, goDirectories, nil
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
	file, err := os.Open(path)
	if err != nil {
		return ""
	}
	defer file.Close()
	scanner := bufio.NewScanner(file)
	for scanner.Scan() {
		line := strings.TrimSpace(scanner.Text())
		if strings.HasPrefix(line, "module ") {
			return strings.TrimSpace(strings.TrimPrefix(line, "module "))
		}
	}
	return ""
}
