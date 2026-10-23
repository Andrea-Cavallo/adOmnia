package rust

import (
	"os"
	"path/filepath"
	"sort"

	"adomnia/internal/ide/toml"
)

const maxManifestBytes = 2 << 20

// Manifest è ciò che serve del Cargo.toml di un'unità: una lettura statica (RS-1.2). Riusa il
// parser TOML condiviso con Python; un manifest malformato produce il sottoinsieme letto, senza
// bloccare le altre unità.
type Manifest struct {
	Path              string
	IsPackage         bool     // [package] presente
	Name              string   // [package].name
	DefaultRun        string   // [package].default-run
	HasWorkspace      bool     // [workspace] presente (anche su un package, che è anche radice del workspace)
	Members           []string // [workspace].members (pattern relativi, es. "crates/*")
	Exclude           []string // [workspace].exclude
	DefaultMembers    []string // [workspace].default-members
	WorkspaceDeps     bool     // [workspace.dependencies] presente (dipendenze ereditate)
	WorkspacePackage  bool     // [workspace.package] presente (metadati ereditati)
	Lib               bool
	LibName           string
	Bins              []string // nomi espliciti di [[bin]]
	Examples          []string // [[example]]
	Tests             []string // [[test]]
	Benches           []string // [[bench]]
	Features          []string // chiavi di [features]
	Dependencies      []string // [dependencies]
	DevDependencies   []string // [dev-dependencies]
	BuildDependencies []string // [build-dependencies]
	HasPatch          bool     // [patch] presente
}

// DefaultBinary è il binario implicito di un crate (`src/main.rs`, nome = package): "" se la
// cartella non è un package con quel file. Serve al ▶ del gutter, che non conosce il nome del crate.
func DefaultBinary(dir string) string {
	manifest := readManifest(dir)
	if manifest.IsPackage && manifest.DefaultRun != "" {
		return manifest.DefaultRun
	}
	if manifest.IsPackage && hasFile(filepath.Join(dir, "src", "main.rs")) {
		return manifest.Name
	}
	return ""
}

// readManifest legge il Cargo.toml dell'unità. Un manifest mancante o malformato non è un errore.
func readManifest(root string) Manifest {
	manifest := Manifest{Path: filepath.Join(root, "Cargo.toml")}
	data, err := readLimited(manifest.Path, maxManifestBytes)
	if err != nil {
		return manifest
	}
	document := toml.Parse(data)
	if pkg := toml.Table(document, "package"); pkg != nil {
		manifest.IsPackage = true
		manifest.Name = toml.String(pkg, "name")
		manifest.DefaultRun = toml.String(pkg, "default-run")
	}
	manifest.HasWorkspace = toml.Table(document, "workspace") != nil
	manifest.Members = toml.Strings(document, "workspace", "members")
	manifest.Exclude = toml.Strings(document, "workspace", "exclude")
	manifest.DefaultMembers = toml.Strings(document, "workspace", "default-members")
	manifest.WorkspaceDeps = toml.Table(document, "workspace", "dependencies") != nil
	manifest.WorkspacePackage = toml.Table(document, "workspace", "package") != nil
	if lib := toml.Table(document, "lib"); lib != nil {
		manifest.Lib = true
		manifest.LibName = toml.String(lib, "name")
	}
	manifest.Bins = tableNames(toml.Tables(document, "bin"))
	manifest.Examples = tableNames(toml.Tables(document, "example"))
	manifest.Tests = tableNames(toml.Tables(document, "test"))
	manifest.Benches = tableNames(toml.Tables(document, "bench"))
	if features := toml.Table(document, "features"); features != nil {
		for name := range features {
			manifest.Features = append(manifest.Features, name)
		}
		sort.Strings(manifest.Features)
	}
	manifest.Dependencies = tableKeys(toml.Table(document, "dependencies"))
	manifest.DevDependencies = tableKeys(toml.Table(document, "dev-dependencies"))
	manifest.BuildDependencies = tableKeys(toml.Table(document, "build-dependencies"))
	manifest.HasPatch = toml.Table(document, "patch") != nil
	return manifest
}

// tableNames estrae i nomi espliciti da un array di tabelle ([[bin]], [[example]]…). I target senza
// `name` (nome derivato dal path) restano impliciti e si risolvono per convenzione in RS-3.
func tableNames(tables []map[string]any) []string {
	var names []string
	for _, entry := range tables {
		if name := toml.String(entry, "name"); name != "" {
			names = append(names, name)
		}
	}
	return names
}

// tableKeys elenca le chiavi di una tabella (nomi di dipendenze), ordinate.
func tableKeys(table map[string]any) []string {
	keys := make([]string, 0, len(table))
	for key := range table {
		keys = append(keys, key)
	}
	sort.Strings(keys)
	return keys
}

// readLimited legge un file con un limite di dimensione.
func readLimited(path string, limit int64) ([]byte, error) {
	info, err := os.Stat(path)
	if err != nil {
		return nil, err
	}
	if info.Size() > limit {
		return nil, os.ErrInvalid
	}
	return os.ReadFile(path)
}
