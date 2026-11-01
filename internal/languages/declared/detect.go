package declared

import (
	"context"
	"path/filepath"
	"sort"
	"strings"

	"github.com/Andrea-Cavallo/adOmnia/internal/ide/project"
)

// UnitProject is the kind of a unit found by a row's manifest (CMakeLists.txt, *.csproj, composer.json…).
const UnitProject = "project"

const (
	maxUnits = 100
	maxDepth = 12
)

// recursiveManifests describe the subdirectories of their own project (add_subdirectory, recursive
// make): only the outermost one is a unit.
var recursiveManifests = map[string]bool{"cmakelists.txt": true, "meson.build": true}

// Rows without manifests find nothing and LimitCapabilities reports no ProjectDetection for them.
func (a adapter) DetectUnits(ctx context.Context, root string) ([]project.Unit, error) {
	visitor := a.NewUnitsVisitor(root)
	if err := project.WalkDirectories(ctx, root, project.MaxScanDirectories, visitor); err != nil {
		return nil, err
	}
	return visitor.Units()
}

func (a adapter) NewUnitsVisitor(string) project.UnitsVisitor {
	return &unitsVisitor{definition: a.definition}
}

type unitsVisitor struct {
	definition
	units []project.Unit
}

// manifest is the first file of files that matches one of the row's patterns (case-insensitive).
func (d definition) manifest(files []string) (string, string) {
	for _, pattern := range d.manifests {
		for _, name := range files {
			if matched, _ := filepath.Match(pattern, strings.ToLower(name)); matched {
				return name, pattern
			}
		}
	}
	return "", ""
}

func (v *unitsVisitor) VisitDirectory(visit project.DirectoryVisit) bool {
	if len(v.manifests) == 0 || len(v.units) >= maxUnits || visit.Depth > maxDepth {
		return false
	}
	name, pattern := v.manifest(visit.Files)
	if name == "" {
		return true
	}
	if recursiveManifests[pattern] {
		for _, unit := range v.units {
			if strings.EqualFold(filepath.Base(unit.Manifest), name) && project.EnsureWithin(unit.Root, visit.Path) == nil {
				return true
			}
		}
	}
	v.units = append(v.units, project.Unit{Language: v.id, Kind: UnitProject, Root: visit.Path,
		Name: filepath.Base(visit.Path), Manifest: filepath.Join(visit.Path, name)})
	return true
}

func (v *unitsVisitor) Units() ([]project.Unit, error) {
	units := append([]project.Unit(nil), v.units...)
	sort.Slice(units, func(i, j int) bool { return units[i].Root < units[j].Root })
	return units, nil
}
