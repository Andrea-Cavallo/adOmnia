package rust

import (
	"context"
	"path/filepath"
	"runtime"
	"sort"
	"strings"

	"github.com/Andrea-Cavallo/adOmnia/internal/ide/project"
)

const (
	maxCargoUnits = 100
	maxCargoDepth = 12
)

// DetectUnits trova i Cargo.toml del progetto: ogni crate con [package] è un'unità cargo-package,
// la radice di un workspace virtuale (senza [package]) è un'unità cargo-workspace. La scansione del
// disco è la stessa condivisa con gli altri linguaggi.
func (l *Language) DetectUnits(ctx context.Context, root string) ([]project.Unit, error) {
	visitor := l.NewUnitsVisitor(root)
	if err := project.WalkDirectories(ctx, root, project.MaxScanDirectories, visitor); err != nil {
		return nil, err
	}
	return visitor.Units()
}

// NewUnitsVisitor raccoglie i Cargo.toml da una scansione condivisa.
func (*Language) NewUnitsVisitor(root string) project.UnitsVisitor {
	return &unitsVisitor{root: root}
}

// unitsVisitor è il visitor project detection del Rust: un solo walk raccoglie i manifest Cargo.
type unitsVisitor struct {
	root      string
	manifests []string // percorsi Cargo.toml trovati
}

func (v *unitsVisitor) VisitDirectory(visit project.DirectoryVisit) bool {
	if len(v.manifests) >= maxCargoUnits || visit.Depth > maxCargoDepth {
		return false
	}
	// target/ può pesare decine di GB; .cargo/registry e .rustup sono dipendenze o toolchain, mai
	// unità del progetto (RS-1.4). La lettura resta possibile senza processi.
	switch strings.ToLower(visit.Name) {
	case "target", ".cargo", ".rustup":
		return false
	}
	for _, name := range visit.Files {
		// Cargo riconosce solo `Cargo.toml`. Su Windows il filesystem è case-insensitive e
		// readManifest lo trova comunque; su Linux un `cargo.toml` non è un manifest e la
		// unità risulterebbe senza Cargo.toml.
		if name == "Cargo.toml" || (runtime.GOOS == "windows" && strings.EqualFold(name, "Cargo.toml")) {
			v.manifests = append(v.manifests, filepath.Join(visit.Path, name))
			break
		}
	}
	return true
}

func (v *unitsVisitor) Units() ([]project.Unit, error) {
	manifests := append([]string(nil), v.manifests...)
	sort.Strings(manifests)
	units := make([]project.Unit, 0, len(manifests))
	for _, manifestPath := range manifests {
		dir := filepath.Dir(manifestPath)
		manifest := readManifest(dir)
		switch {
		case manifest.IsPackage:
			units = append(units, project.Unit{Language: ID, Kind: UnitCargoPackage, Root: dir, Name: manifest.Name, Manifest: manifestPath})
		case manifest.HasWorkspace:
			// Workspace virtuale (nessun [package]): raggruppa i membri, che restano unità proprie.
			units = append(units, project.Unit{Language: ID, Kind: UnitCargoWorkspace, Root: dir, Name: filepath.Base(dir), Manifest: manifestPath})
		}
	}
	return units, nil
}
