package python

import (
	"os"
	"path/filepath"
	"strings"

	"adomnia/internal/ide/toml"
)

// Manifest è ciò che serve del pyproject.toml e degli altri indizi Python di un'unità.
// È una lettura statica: mai eseguire setup.py né importare il progetto (PY-1.2).
type Manifest struct {
	Path            string
	Name            string
	RequiresPython  string
	Scripts         map[string]string // [project.scripts]: nome console → entry point
	Dependencies    []string
	DevDependencies []string
	PytestPaths     []string // [tool.pytest.ini_options] testpaths
	UvWorkspace     []string // [tool.uv.workspace] members
	Poetry          bool
	BuildBackend    string
}

const maxManifestBytes = 2 << 20

// readManifest legge pyproject.toml e requirements*.txt dell'unità. Un manifest malformato o
// mancante non è un errore: restituisce ciò che si è letto.
func readManifest(root string) Manifest {
	manifest := Manifest{Path: filepath.Join(root, "pyproject.toml"), Scripts: map[string]string{}}
	if data, err := readLimited(manifest.Path, maxManifestBytes); err == nil {
		document := toml.Parse(data)
		manifest.Name = toml.String(document, "project", "name")
		manifest.RequiresPython = toml.String(document, "project", "requires-python")
		manifest.BuildBackend = toml.String(document, "build-system", "build-backend")
		if scripts := toml.Table(document, "project", "scripts"); len(scripts) > 0 {
			for name, entry := range scripts {
				if text, ok := entry.(string); ok {
					manifest.Scripts[name] = text
				}
			}
		}
		manifest.Dependencies = append(manifest.Dependencies, toml.Strings(document, "project", "dependencies")...)
		for _, group := range []string{"dev", "test", "tests", "testing"} {
			manifest.DevDependencies = append(manifest.DevDependencies, toml.Strings(document, "dependency-groups", group)...)
			manifest.DevDependencies = append(manifest.DevDependencies, toml.Strings(document, "project", "optional-dependencies", group)...)
		}
		manifest.PytestPaths = toml.Strings(document, "tool", "pytest", "ini_options", "testpaths")
		manifest.UvWorkspace = toml.Strings(document, "tool", "uv", "workspace", "members")
		manifest.Poetry = toml.Table(document, "tool", "poetry") != nil
	}
	for _, name := range []string{"requirements.txt", "requirements-dev.txt", "requirements-test.txt"} {
		if data, err := readLimited(filepath.Join(root, name), maxManifestBytes); err == nil {
			manifest.Dependencies = append(manifest.Dependencies, requirementLines(string(data))...)
		}
	}
	return manifest
}

// requirementLines estrae i nomi dei pacchetti dalle righe di un requirements.txt, saltando
// opzioni, URL ed edit install.
func requirementLines(text string) []string {
	var packages []string
	for _, line := range strings.Split(text, "\n") {
		line = strings.TrimSpace(line)
		if line == "" || strings.HasPrefix(line, "#") || strings.HasPrefix(line, "-") {
			continue
		}
		if strings.Contains(line, "://") || strings.ContainsAny(line, " \t") {
			continue
		}
		packages = append(packages, line)
	}
	return packages
}

// dependencyNames normalizza i nomi dei pacchetti dichiarati: PEP 503 minuscolo con trattini.
func dependencyNames(groups ...[]string) map[string]bool {
	names := map[string]bool{}
	for _, group := range groups {
		for _, dependency := range group {
			name := dependency
			if index := strings.IndexAny(name, "[]<>=!~;("); index >= 0 {
				name = name[:index]
			}
			name = strings.ToLower(strings.TrimSpace(name))
			name = strings.ReplaceAll(name, "_", "-")
			name = strings.ReplaceAll(name, ".", "-")
			if name != "" {
				names[name] = true
			}
		}
	}
	return names
}

// hasDependency dice se il progetto dichiara un pacchetto (requirements, dependency groups o
// optional dependencies). Non verifica se è installato: quello richiede l'interprete.
func (m Manifest) hasDependency(name string) bool {
	return dependencyNames(m.Dependencies, m.DevDependencies)[strings.ToLower(strings.ReplaceAll(name, "_", "-"))]
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
	data, err := os.ReadFile(path)
	if err != nil {
		return nil, err
	}
	return data, nil
}
