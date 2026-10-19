package web

import (
	"context"
	"encoding/json"
	"os"
	"path/filepath"
	"sort"

	"adomnia/internal/ide/project"
)

const (
	maxScanDirectories = 4_000
	maxScanDepth       = 4
	maxNodeUnits       = 50
)

// DetectUnits trova i package.json del progetto (radice, app in sottocartelle, monorepo) saltando
// node_modules e le cartelle generate. Non esegue nulla.
// La scansione del disco è la stessa condivisa con gli altri linguaggi.
func (a scriptAdapter) DetectUnits(ctx context.Context, root string) ([]project.Unit, error) {
	visitor := a.NewUnitsVisitor(root)
	walkErr := project.WalkDirectories(ctx, root, project.MaxScanDirectories, visitor)
	units, err := visitor.Units()
	if err != nil {
		return units, err
	}
	return units, walkErr
}

// NewUnitsVisitor raccoglie i package.json da una scansione condivisa.
func (scriptAdapter) NewUnitsVisitor(root string) project.UnitsVisitor {
	return &manifestsVisitor{root: root}
}

// DetectUnits riconosce il sito statico: index.html nella radice e nessun package.json.
func (a htmlAdapter) DetectUnits(ctx context.Context, root string) ([]project.Unit, error) {
	visitor := a.NewUnitsVisitor(root)
	if err := project.WalkDirectories(ctx, root, project.MaxScanDirectories, visitor); err != nil {
		return nil, err
	}
	return visitor.Units()
}

// NewUnitsVisitor riconosce il sito statico dalla sola radice del progetto.
func (htmlAdapter) NewUnitsVisitor(root string) project.UnitsVisitor {
	return &staticSiteVisitor{root: root}
}

// manifestsVisitor è il visitor di rilevamento dei progetti Node.
type manifestsVisitor struct {
	root      string
	manifests []string
	visited   int
	done      bool
}

func (v *manifestsVisitor) VisitDirectory(visit project.DirectoryVisit) bool {
	if v.done || visit.Depth > maxScanDepth {
		return false
	}
	v.visited++
	if v.visited > maxScanDirectories {
		v.done = true
		return false
	}
	for _, name := range visit.Files {
		if name == "package.json" && len(v.manifests) < maxNodeUnits {
			v.manifests = append(v.manifests, filepath.Join(visit.Path, name))
		}
	}
	return true
}

func (v *manifestsVisitor) Units() ([]project.Unit, error) {
	manifests := append([]string(nil), v.manifests...)
	sort.SliceStable(manifests, func(i, j int) bool {
		if di, dj := depth(v.root, manifests[i]), depth(v.root, manifests[j]); di != dj {
			return di < dj
		}
		return manifests[i] < manifests[j]
	})
	units := make([]project.Unit, 0, len(manifests))
	for _, manifest := range manifests {
		units = append(units, project.Unit{Language: ScriptID, Kind: UnitNode, Root: filepath.Dir(manifest), Name: manifestName(manifest), Manifest: manifest})
	}
	return units, nil
}

// staticSiteVisitor riconosce il sito statico dalla radice del progetto.
type staticSiteVisitor struct {
	root  string
	units []project.Unit
}

func (v *staticSiteVisitor) VisitDirectory(visit project.DirectoryVisit) bool {
	if visit.Depth > 0 {
		return false
	}
	hasIndex, hasPackage := false, false
	for _, name := range visit.Files {
		if name == "index.html" {
			hasIndex = true
		}
		if name == "package.json" {
			hasPackage = true
		}
	}
	if hasIndex && !hasPackage {
		v.units = append(v.units, project.Unit{Language: HTMLID, Kind: UnitStatic, Root: v.root, Manifest: filepath.Join(v.root, "index.html")})
	}
	return false
}

func (v *staticSiteVisitor) Units() ([]project.Unit, error) {
	return append([]project.Unit(nil), v.units...), nil
}

// findManifests cammina l'albero fino a maxScanDepth livelli, ordinando per percorso (la radice per prima).
func findManifests(ctx context.Context, root string) ([]string, error) {
	manifests := make([]string, 0, 4)
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
			if path != root && (project.IgnoredDirectory(entry.Name()) || depth(root, path) > maxScanDepth) {
				return filepath.SkipDir
			}
			visited++
			if visited > maxScanDirectories {
				return filepath.SkipAll
			}
			return nil
		}
		if entry.Name() == "package.json" && len(manifests) < maxNodeUnits {
			manifests = append(manifests, path)
		}
		return nil
	})
	sort.SliceStable(manifests, func(i, j int) bool {
		if di, dj := depth(root, manifests[i]), depth(root, manifests[j]); di != dj {
			return di < dj
		}
		return manifests[i] < manifests[j]
	})
	return manifests, err
}

func depth(root, path string) int {
	relative, err := filepath.Rel(root, path)
	if err != nil || relative == "." {
		return 0
	}
	count := 1
	for _, character := range relative {
		if character == filepath.Separator {
			count++
		}
	}
	return count
}

func manifestName(path string) string {
	data, err := os.ReadFile(path)
	if err != nil {
		return ""
	}
	var manifest struct {
		Name string `json:"name"`
	}
	if json.Unmarshal(data, &manifest) != nil {
		return ""
	}
	return manifest.Name
}

// Targets elenca i progetti avviabili sotto root: ogni package.json e, per il sito statico, la radice.
// Un progetto senza script di sviluppo resta in elenco: l'IDE lo propone come sito statico se ha un index.html.
func Targets(ctx context.Context, root string) ([]Info, error) {
	manifests, err := findManifests(ctx, root)
	if err != nil {
		return nil, err
	}
	infos := make([]Info, 0, len(manifests)+1)
	for _, manifest := range manifests {
		info, inspectErr := Inspect(root, filepath.Dir(manifest))
		if inspectErr != nil && info.Manifest == "" {
			continue
		}
		infos = append(infos, info)
	}
	if len(infos) == 0 && isFile(filepath.Join(root, "index.html")) {
		info, _ := Inspect(root, root)
		infos = append(infos, info)
	}
	SortInfos(infos)
	return infos, nil
}
