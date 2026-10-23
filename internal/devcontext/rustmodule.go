package devcontext

import (
	"path"
	"strings"

	"adomnia/internal/ide/toml"
)

// detectCargoToml: ogni crate con `[package]` diventa un'entità module, come un go.mod, così i
// membri di un workspace Cargo entrano nel grafo dei moduli (archi da dipendenze path, riuso di
// internal/ide/graph). Un workspace virtuale (senza [package]) non è un modulo: lo sono i membri.
func detectCargoToml(rel string, data []byte) ([]Entity, error) {
	document := toml.Parse(data)
	pkg := toml.Table(document, "package")
	if pkg == nil {
		return nil, nil
	}
	name := toml.String(pkg, "name")
	if name == "" {
		return nil, nil
	}
	return []Entity{entity("module", name, name, ConfidenceCertain,
		map[string]string{"dir": path.Dir(rel), "language": "rust"}, Source{"cargotoml", rel, packageLine(data)})}, nil
}

// packageLine restituisce la riga 1-based dell'intestazione `[package]` (per navigare).
func packageLine(data []byte) int {
	for i, raw := range strings.Split(string(data), "\n") {
		if strings.TrimSpace(raw) == "[package]" {
			return i + 1
		}
	}
	return 1
}
