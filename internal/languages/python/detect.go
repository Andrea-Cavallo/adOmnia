package python

import (
	"context"
	"path/filepath"
	"sort"
	"strings"

	"adomnia/internal/ide/project"
)

func (l *Language) DetectUnits(ctx context.Context, root string) ([]project.Unit, error) {
	visitor := l.NewUnitsVisitor(root)
	err := project.WalkDirectories(ctx, root, project.MaxScanDirectories, visitor)
	units, _ := visitor.Units()
	return units, err
}

func (*Language) NewUnitsVisitor(root string) project.UnitsVisitor { return &unitsVisitor{} }

type unitsVisitor struct{ units []project.Unit }

func (v *unitsVisitor) VisitDirectory(visit project.DirectoryVisit) bool {
	if len(v.units) >= 100 || visit.Depth > 12 {
		return false
	}
	lower := strings.ToLower(visit.Name)
	switch lower {
	case ".venv", "venv", "env", "__pycache__", ".tox", ".nox", ".mypy_cache", ".pytest_cache", ".ruff_cache", "site-packages", ".eggs":
		return false
	}
	if strings.HasSuffix(lower, ".egg-info") || strings.HasSuffix(lower, ".dist-info") {
		return false
	}
	manifest := ""
	// Strong project markers have stable precedence. Do not parse or execute setup.py.
	for _, marker := range []string{"pyproject.toml", "setup.cfg", "setup.py", "requirements.txt", "manage.py"} {
		for _, name := range visit.Files {
			if name == marker {
				manifest = marker
				break
			}
		}
		if manifest != "" {
			break
		}
	}
	owned := false
	for _, unit := range v.units {
		rel, err := filepath.Rel(unit.Root, visit.Path)
		if err == nil && rel != ".." && !strings.HasPrefix(rel, ".."+string(filepath.Separator)) {
			owned = true
			break
		}
	}
	// An explicit manifest introduces a nested unit. Bare packages belong to their ancestor.
	if manifest == "" && !owned {
		for _, name := range visit.Files {
			if strings.EqualFold(filepath.Ext(name), ".py") {
				manifest = name
				break
			}
		}
	}
	if manifest != "" {
		kind := "python-project"
		if strings.EqualFold(filepath.Ext(manifest), ".py") && manifest != "setup.py" && manifest != "manage.py" {
			kind = "python-scripts"
		}
		name := filepath.Base(visit.Path)
		if manifest == "pyproject.toml" {
			if declared := readManifest(visit.Path).Name; declared != "" {
				name = declared
			}
		}
		v.units = append(v.units, project.Unit{Language: ID, Kind: kind, Root: visit.Path, Name: name, Manifest: filepath.Join(visit.Path, manifest)})
	}
	return true
}

func (v *unitsVisitor) Units() ([]project.Unit, error) {
	units := append([]project.Unit(nil), v.units...)
	sort.Slice(units, func(i, j int) bool { return units[i].Root < units[j].Root })
	return units, nil
}
