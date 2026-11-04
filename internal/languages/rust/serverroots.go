package rust

import (
	"path/filepath"
	"sort"

	"github.com/Andrea-Cavallo/adOmnia/internal/ide/project"
)

// ServerRoots implementa language.ServerRoots (RS-4.2): rust-analyzer serve un workspace Cargo, non
// il singolo crate che lo compone. Un server per crate caricherebbe N volte lo stesso grafo (metadata,
// proc-macro, build script, check) e su un workspace da 37 membri sono 37 processi rust-analyzer:
// il server si avvia quindi alla radice del workspace che contiene l'unità, e i crate che non
// appartengono a nessun workspace restano una radice a sé.
func (*Language) ServerRoots(projectRoot string, units []project.Unit) []string {
	workspaces := cargoWorkspaceRoots(units)
	seen := make(map[string]bool, len(units))
	roots := make([]string, 0, len(units))
	for _, unit := range units {
		if unit.Language != ID || unit.Root == "" {
			continue
		}
		root := enclosingWorkspace(filepath.Clean(unit.Root), workspaces)
		if seen[root] {
			continue
		}
		seen[root] = true
		roots = append(roots, root)
	}
	sort.Strings(roots)
	return roots
}

// cargoWorkspaceRoots sono le cartelle con un Cargo.toml che dichiara [workspace]: la radice è sia un
// workspace virtuale sia un package che è anche radice del workspace.
func cargoWorkspaceRoots(units []project.Unit) []string {
	workspaces := make([]string, 0, 2)
	for _, unit := range units {
		if unit.Language != ID || unit.Root == "" {
			continue
		}
		root := filepath.Clean(unit.Root)
		if readManifest(root).HasWorkspace {
			workspaces = append(workspaces, root)
		}
	}
	return workspaces
}

// enclosingWorkspace è il workspace che racchiude il crate, ossia quello più esterno dentro il
// progetto: un Cargo.toml annidato con il proprio `[workspace]` (una fuzz target, un esempio di
// plugin) non è un progetto indipendente, e serve un server solo — quello del workspace esterno — per
// non ricaricare lo stesso grafo una volta per sotto-cartella. Il crate fuori da ogni workspace resta
// una radice a sé.
func enclosingWorkspace(crateRoot string, workspaces []string) string {
	best, bestLength := crateRoot, -1
	for _, workspace := range workspaces {
		if project.EnsureWithin(workspace, crateRoot) != nil {
			continue
		}
		if bestLength >= 0 && len(workspace) >= bestLength {
			continue
		}
		best, bestLength = workspace, len(workspace)
	}
	return best
}
