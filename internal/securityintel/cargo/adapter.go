// Package cargo è l'adapter Rust (crates.io) di adOmnia Security Intelligence.
//
// Risolve le dipendenze dal solo Cargo.lock (formato TOML stabile, offline, nessuna
// esecuzione): ogni package con origine registry (crates.io) è un componente. Le
// dipendenze path/git e i membri del workspace non sono pacchetti pubblicati: non hanno
// advisory su crates.io e non vengono inviati al motore. Nessuna rete in rilevamento e
// risoluzione: la scansione OSV parte solo su azione.
package cargo

import (
	"context"
	"os"
	"path/filepath"
	"sort"
	"strings"

	"adomnia/internal/ide/toml"
	"adomnia/internal/securityintel"
)

// Adapter è l'adapter Rust (crates.io) di adOmnia Security Intelligence.
type Adapter struct{}

// New crea l'adapter cargo.
func New() *Adapter { return &Adapter{} }

// Ecosystem implementa securityintel.EcosystemAdapter.
func (*Adapter) Ecosystem() securityintel.Ecosystem { return securityintel.EcosystemCargo }

// Discover implementa securityintel.EcosystemAdapter. Trova i Cargo.toml che hanno un
// Cargo.lock accanto (la radice di un workspace o un crate singolo): i membri di un
// workspace non hanno un lock proprio, quindi non sono target separati.
func (*Adapter) Discover(ctx context.Context, root string) ([]securityintel.Target, error) {
	var targets []securityintel.Target
	visited := 0
	err := filepath.WalkDir(root, func(path string, entry os.DirEntry, walkErr error) error {
		if walkErr != nil {
			if entry != nil && entry.IsDir() {
				return filepath.SkipDir
			}
			return nil
		}
		if !entry.IsDir() {
			return nil
		}
		if path != root && skipDirectory(entry.Name()) {
			return filepath.SkipDir
		}
		visited++
		if visited > 4_000 || len(targets) >= 200 {
			return filepath.SkipAll
		}
		manifest := filepath.Join(path, "Cargo.toml")
		if !isFile(manifest) || !isFile(filepath.Join(path, "Cargo.lock")) {
			return nil
		}
		targets = append(targets, securityintel.Target{
			Ecosystem: securityintel.EcosystemCargo,
			Root:      path,
			Manifest:  manifest,
			Name:      packageName(manifest),
		})
		return nil
	})
	sort.SliceStable(targets, func(i, j int) bool { return targets[i].Root < targets[j].Root })
	return targets, err
}

// skipDirectory dice se una cartella va saltata dalla scoperta.
func skipDirectory(name string) bool {
	switch strings.ToLower(name) {
	case ".git", ".idea", ".vscode", "node_modules", "vendor", "target", ".cargo", "build", "dist", ".rustup":
		return true
	}
	return false
}

func isFile(path string) bool {
	info, err := os.Stat(path)
	return err == nil && !info.IsDir()
}

// packageName legge il nome del package dal Cargo.toml ("" se workspace virtuale).
func packageName(path string) string {
	data, err := os.ReadFile(path)
	if err != nil {
		return ""
	}
	return toml.String(toml.Parse(data), "package", "name")
}

// Resolve implementa securityintel.EcosystemAdapter. Legge il Cargo.lock e ne estrae i
// package crates.io: nome + versione dal lock, origine direct/transitive dalle
// dipendenze dichiarate nel Cargo.toml. Mai `cargo`, mai rete.
func (*Adapter) Resolve(ctx context.Context, target securityintel.Target, options securityintel.ResolveOptions) (securityintel.Resolution, error) {
	lockPath := filepath.Join(filepath.Dir(target.Manifest), "Cargo.lock")
	data, err := os.ReadFile(lockPath)
	if err != nil {
		return securityintel.Resolution{}, err
	}
	direct := directDependencies(target.Manifest)
	resolution := securityintel.Resolution{}
	for _, pkg := range toml.Tables(toml.Parse(data), "package") {
		name := toml.String(pkg, "name")
		version := toml.String(pkg, "version")
		source := toml.String(pkg, "source")
		if name == "" || version == "" || !strings.HasPrefix(source, "registry+") {
			continue // path/git/workspace member: non è un pacchetto crates.io
		}
		origin := securityintel.OriginTransitive
		if direct[name] {
			origin = securityintel.OriginDeclared
		}
		resolution.Components = append(resolution.Components, securityintel.Component{
			Ecosystem: securityintel.EcosystemCargo,
			Name:      name,
			Version:   version,
			Scope:     securityintel.ScopeCompile,
			Origin:    origin,
			Exposure:  securityintel.ExposureRuntime,
			Manifest:  target.Manifest,
			Direct:    direct[name],
		})
		if len(resolution.Components) >= options.MaxComponents {
			break
		}
	}
	sort.SliceStable(resolution.Components, func(i, j int) bool {
		return resolution.Components[i].Name < resolution.Components[j].Name
	})
	return resolution, nil
}

// directDependencies sono i nomi delle dipendenze dichiarate nel Cargo.toml
// ([dependencies], [dev-dependencies], [build-dependencies]). Un workspace virtuale non ha
// [package]: si leggono anche i manifest dei membri, sennò tutte le loro dipendenze risulterebbero
// transitive (RS-8.3).
func directDependencies(manifestPath string) map[string]bool {
	direct := map[string]bool{}
	add := func(path string) {
		data, err := os.ReadFile(path)
		if err != nil {
			return
		}
		document := toml.Parse(data)
		for _, section := range []string{"dependencies", "dev-dependencies", "build-dependencies"} {
			for name := range toml.Table(document, section) {
				direct[name] = true
			}
		}
	}
	add(manifestPath)
	data, err := os.ReadFile(manifestPath)
	if err != nil {
		return direct
	}
	document := toml.Parse(data)
	if toml.Table(document, "package") != nil {
		return direct
	}
	root := filepath.Dir(manifestPath)
	for _, pattern := range toml.Strings(document, "workspace", "members") {
		for _, member := range workspaceMemberManifests(root, pattern) {
			add(member)
		}
	}
	// [workspace.dependencies] è ereditato dai membri: resta una dipendenza dichiarata.
	for name := range toml.Table(document, "workspace", "dependencies") {
		direct[name] = true
	}
	return direct
}

const maxWorkspaceMembers = 100

// workspaceMemberManifests espande un membro del workspace (`crates/*` o un percorso) nel suo
// Cargo.toml, con un limite sui glob.
func workspaceMemberManifests(root, pattern string) []string {
	manifest := func(dir string) string { return filepath.Join(dir, "Cargo.toml") }
	if !strings.ContainsAny(pattern, "*?[") {
		return []string{manifest(filepath.Join(root, filepath.FromSlash(pattern)))}
	}
	matches, err := filepath.Glob(filepath.Join(root, filepath.FromSlash(pattern)))
	if err != nil {
		return nil
	}
	if len(matches) > maxWorkspaceMembers {
		matches = matches[:maxWorkspaceMembers]
	}
	out := make([]string, 0, len(matches))
	for _, match := range matches {
		out = append(out, manifest(match))
	}
	return out
}
