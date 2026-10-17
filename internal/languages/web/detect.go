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
func (a scriptAdapter) DetectUnits(ctx context.Context, root string) ([]project.Unit, error) {
	manifests, err := findManifests(ctx, root)
	if err != nil {
		return nil, err
	}
	units := make([]project.Unit, 0, len(manifests))
	for _, manifest := range manifests {
		units = append(units, project.Unit{Language: ScriptID, Kind: UnitNode, Root: filepath.Dir(manifest), Name: manifestName(manifest), Manifest: manifest})
	}
	return units, nil
}

// DetectUnits riconosce il sito statico: index.html nella radice e nessun package.json.
func (a htmlAdapter) DetectUnits(_ context.Context, root string) ([]project.Unit, error) {
	index := filepath.Join(root, "index.html")
	if !isFile(index) || isFile(filepath.Join(root, "package.json")) {
		return nil, nil
	}
	return []project.Unit{{Language: HTMLID, Kind: UnitStatic, Root: root, Manifest: index}}, nil
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
