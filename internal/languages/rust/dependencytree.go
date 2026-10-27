package rust

import (
	"os"
	"path/filepath"
	"sort"
	"strings"

	"github.com/Andrea-Cavallo/adOmnia/internal/ide/toml"
)

// Stato di un nodo dell'albero.
const (
	CargoTreeResolved  = "resolved"
	CargoTreeDuplicate = "duplicate" // stessa crate, più versioni nel lock
)

// CargoTreeNode è una riga dell'albero in ordine di apparizione: Depth 0 è un crate locale
// (workspace member). La vista è la stessa di dependencytree.go (Java): una lista piatta con la
// profondità, da cui il frontend ricostruisce l'albero.
type CargoTreeNode struct {
	Depth   int    `json:"depth"`
	Name    string `json:"name"`
	Version string `json:"version"`
	Status  string `json:"status"`
}

type cargoPackage struct {
	name         string
	version      string
	source       string
	dependencies []string
}

// CargoLockTree legge il Cargo.lock (formato TOML stabile, offline, nessuna esecuzione) e restituisce
// l'albero delle dipendenze con i duplicati di versione evidenziati (RS-8.2). I root sono i crate
// senza `source`, cioè i membri locali del workspace. `cargo tree` resta l'azione esplicita per la
// risoluzione esatta (Cargo.lock non dice quale versione usa un nome duplicato).
func CargoLockTree(projectRoot string) ([]CargoTreeNode, error) {
	data, err := os.ReadFile(filepath.Join(projectRoot, "Cargo.lock"))
	if err != nil {
		return nil, err
	}
	return parseCargoLockTree(data), nil
}

func parseCargoLockTree(data []byte) []CargoTreeNode {
	var packages []cargoPackage
	byName := map[string][]cargoPackage{}
	for _, entry := range toml.Tables(toml.Parse(data), "package") {
		pkg := cargoPackage{
			name:         toml.String(entry, "name"),
			version:      toml.String(entry, "version"),
			source:       toml.String(entry, "source"),
			dependencies: toml.Strings(entry, "dependencies"),
		}
		if pkg.name == "" || pkg.version == "" {
			continue
		}
		packages = append(packages, pkg)
		byName[pkg.name] = append(byName[pkg.name], pkg)
	}
	duplicate := map[string]bool{}
	for name, list := range byName {
		duplicate[name] = len(list) > 1
	}
	var roots []cargoPackage
	for _, pkg := range packages {
		if pkg.source == "" {
			roots = append(roots, pkg)
		}
	}
	sort.Slice(roots, func(i, j int) bool { return roots[i].name < roots[j].name })

	var tree []CargoTreeNode
	visited := map[string]bool{}
	var walk func(pkg cargoPackage, depth int)
	walk = func(pkg cargoPackage, depth int) {
		status := CargoTreeResolved
		if duplicate[pkg.name] {
			status = CargoTreeDuplicate
		}
		tree = append(tree, CargoTreeNode{Depth: depth, Name: pkg.name, Version: pkg.version, Status: status})
		key := pkg.name + "@" + pkg.version
		if visited[key] {
			return
		}
		visited[key] = true
		for _, dep := range pkg.dependencies {
			name := depName(dep)
			if list := byName[name]; len(list) > 0 {
				walk(list[0], depth+1)
			}
		}
	}
	for _, pkg := range roots {
		walk(pkg, 0)
	}
	// Le versioni duplicate non raggiunte (la risoluzione prende sempre la prima) restano visibili
	// in coda, marcate duplicate: sono proprio quelle da evidenziare (RS-8.2).
	for _, pkg := range packages {
		if visited[pkg.name+"@"+pkg.version] {
			continue
		}
		status := CargoTreeResolved
		if duplicate[pkg.name] {
			status = CargoTreeDuplicate
		}
		tree = append(tree, CargoTreeNode{Depth: 0, Name: pkg.name, Version: pkg.version, Status: status})
	}
	return tree
}

// depName toglie la versione da una voce dipendenza `"serde 1.0.100"` (Cargo.lock v1/v2) → `serde`.
func depName(entry string) string {
	if space := strings.IndexByte(entry, ' '); space > 0 {
		return entry[:space]
	}
	return entry
}
