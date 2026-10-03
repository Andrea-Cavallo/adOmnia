// Package project contiene il modello di progetto dell'IDE, indipendente dal linguaggio.
//
// Un progetto aperto (una cartella) contiene zero o più Unit: le unità di build che i language
// adapter riconoscono (un go.mod, domani un pom.xml o un package.json). Un monorepo con backend Go,
// gateway Java e frontend TypeScript è un solo progetto con tre unità di tre linguaggi.
package project

import (
	"fmt"
	"path/filepath"
	"strings"
)

// Unit è un'unità di build riconosciuta da un language adapter dentro la cartella del progetto.
type Unit struct {
	// Language è l'ID del linguaggio che l'ha rilevata (es. "go").
	Language string `json:"language"`
	// Kind è il tipo di unità per quel linguaggio (es. "module", "workspace", "loose").
	Kind string `json:"kind"`
	// Root è la cartella dell'unità, assoluta.
	Root string `json:"root"`
	// Name è il nome logico (module path, artifactId, nome del pacchetto); può essere vuoto.
	Name string `json:"name,omitempty"`
	// Manifest è il file che definisce l'unità (es. "go.mod"), assoluto; vuoto se non c'è.
	Manifest string `json:"manifest,omitempty"`
}

// ignoredDirectories sono cartelle generate, di dipendenze o di editor che nessuna scansione visita.
var ignoredDirectories = map[string]struct{}{
	".git": {}, ".idea": {}, ".vscode": {}, "node_modules": {}, "vendor": {},
	"bin": {}, "build": {}, "dist": {}, "coverage": {}, ".cache": {},
}

// IgnoredDirectory dice se una cartella va saltata da indicizzazione e detection.
func IgnoredDirectory(name string) bool {
	_, ignored := ignoredDirectories[strings.ToLower(name)]
	return ignored
}

// EnsureWithin verifica che candidate sia root o un suo discendente (dopo Clean, senza seguire link).
func EnsureWithin(root, candidate string) error {
	rel, err := filepath.Rel(filepath.Clean(root), filepath.Clean(candidate))
	if err != nil {
		return fmt.Errorf("impossibile verificare il percorso: %w", err)
	}
	if rel == ".." || strings.HasPrefix(rel, ".."+string(filepath.Separator)) || filepath.IsAbs(rel) {
		return fmt.Errorf("il percorso richiesto è esterno al progetto")
	}
	return nil
}

// SamePath confronta due percorsi dopo Clean, senza distinguere maiuscole (come gli FS di Windows e macOS).
func SamePath(left, right string) bool {
	return strings.EqualFold(filepath.Clean(left), filepath.Clean(right))
}
