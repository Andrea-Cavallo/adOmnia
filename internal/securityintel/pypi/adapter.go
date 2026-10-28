// Package pypi è l'adapter PyPI di adOmnia Security Intelligence.
//
// Legge i manifest Python di un'unità — `requirements*.txt`, `pyproject.toml` — e, quando c'è, il
// lockfile (`poetry.lock` o `uv.lock`) che contiene le versioni **effettivamente risolte**, come il
// grafo Maven o la MVS di Go. La regola dell'engine vale anche qui: niente numeri inventati. Una
// dipendenza senza versione esatta (un `>=`, un `~=`, un nome nudo) non viene interrogata — OSV
// risponderebbe per tutte le versioni — e finisce nei warning, così l'utente sa perché la copertura
// è parziale e cosa fare (committare un lockfile o fissare la versione).
//
// Nessuna esecuzione: la risoluzione è statica e offline. `pip` non viene mai invocato, i sorgenti
// non escono dalla macchina (Privacy by Design, come per gli altri ecosistemi).
package pypi

import (
	"context"
	"fmt"
	"os"
	"path/filepath"
	"sort"
	"strings"

	"github.com/Andrea-Cavallo/adOmnia/internal/securityintel"
)

// Adapter è l'adapter PyPI di adOmnia Security Intelligence.
type Adapter struct{}

// New crea l'adapter PyPI.
func New() *Adapter { return &Adapter{} }

// Ecosystem implementa securityintel.EcosystemAdapter.
func (*Adapter) Ecosystem() securityintel.Ecosystem { return securityintel.EcosystemPyPI }

// maxComponents limita la risoluzione per manifest, contro lockfile patologici.
const maxComponents = 5_000

// maxVisitedDirectories limita la scoperta, come per gli altri adapter.
const maxVisitedDirectories = 4_000

// Discover implementa securityintel.EcosystemAdapter: trova i manifest Python del progetto.
//
// Un'unità può avere `pyproject.toml` e `requirements.txt` insieme: sono due dichiarazioni diverse
// (la seconda spesso per il deploy) e valgono entrambe. Il lockfile non è un target: è la risoluzione
// del target che gli sta accanto.
func (a *Adapter) Discover(ctx context.Context, root string) ([]securityintel.Target, error) {
	var targets []securityintel.Target
	visited := 0
	err := filepath.WalkDir(root, func(path string, entry os.DirEntry, walkErr error) error {
		if walkErr != nil {
			if entry != nil && entry.IsDir() {
				return filepath.SkipDir
			}
			return nil
		}
		if err := ctx.Err(); err != nil {
			return err
		}
		if entry.IsDir() {
			if path != root && skipDirectory(entry.Name()) {
				return filepath.SkipDir
			}
			visited++
			if visited > maxVisitedDirectories || len(targets) >= 200 {
				return filepath.SkipAll
			}
			return nil
		}
		name := strings.ToLower(entry.Name())
		if !isRequirementsFile(name) && name != "pyproject.toml" {
			return nil
		}
		manifest := path
		if name == "pyproject.toml" && !declaresDependencies(manifest) {
			return nil // un pyproject senza dipendenze non è un target di sicurezza
		}
		directory := filepath.Dir(manifest)
		targets = append(targets, securityintel.Target{
			Ecosystem: securityintel.EcosystemPyPI,
			Root:      directory,
			Manifest:  manifest,
			Name:      unitName(directory),
		})
		return nil
	})
	sort.Slice(targets, func(i, j int) bool { return targets[i].Manifest < targets[j].Manifest })
	return targets, err
}

// Resolve implementa securityintel.EcosystemAdapter.
//
// Ordine: lockfile (versioni risolte, dipendenze transitive comprese) → dichiarazioni con pin
// esatto → warning per ciò che resta non fissato.
func (a *Adapter) Resolve(ctx context.Context, target securityintel.Target, options securityintel.ResolveOptions) (securityintel.Resolution, error) {
	data, err := os.ReadFile(target.Manifest)
	if err != nil {
		return securityintel.Resolution{}, fmt.Errorf("read %s: %w", filepath.ToSlash(target.Manifest), err)
	}
	if err := ctx.Err(); err != nil {
		return securityintel.Resolution{}, err
	}
	declared, warnings := declaredRequirements(filepath.Base(target.Manifest), data)
	byName := map[string]declaredRequirement{}
	for _, requirement := range declared {
		byName[requirement.name] = requirement
	}

	var resolution securityintel.Resolution
	resolution.Warnings = append(resolution.Warnings, warnings...)
	if locked, lockedWarnings, found := readLockfile(target.Root); found {
		resolution.Components = lockedComponents(locked, byName, target.Manifest)
		resolution.Warnings = append(resolution.Warnings, lockedWarnings...)
	} else {
		resolution.Components = pinnedComponents(declared, target.Manifest)
		if unpinned := unpinnedNames(declared); len(unpinned) > 0 {
			resolution.Warnings = append(resolution.Warnings,
				fmt.Sprintf("%d dependencies are not pinned (%s): commit a poetry.lock or uv.lock, or pin them with ==, to have them analysed",
					len(unpinned), summarize(unpinned)))
		}
		if len(resolution.Components) == 0 {
			resolution.Warnings = append(resolution.Warnings,
				"no dependency has an exact version: the manifest was read but nothing can be matched against advisories")
		}
	}
	if len(resolution.Components) > maxComponents {
		resolution.Components = resolution.Components[:maxComponents]
		resolution.Warnings = append(resolution.Warnings, fmt.Sprintf("dependency graph truncated at %d components", maxComponents))
	}
	sort.SliceStable(resolution.Components, func(i, j int) bool { return resolution.Components[i].Name < resolution.Components[j].Name })
	return resolution, nil
}

// lockedComponents traduce le voci del lockfile in componenti del motore: le dipendenze dirette
// arrivano dal manifest (con il loro scope), le altre sono transitive.
func lockedComponents(locked []lockedPackage, declared map[string]declaredRequirement, manifest string) []securityintel.Component {
	components := make([]securityintel.Component, 0, len(locked))
	for _, entry := range locked {
		if entry.version == "" {
			continue
		}
		component := securityintel.Component{
			Ecosystem: securityintel.EcosystemPyPI,
			Name:      entry.name,
			Version:   entry.version,
			Scope:     securityintel.ScopeCompile,
			Origin:    securityintel.OriginTransitive,
			Exposure:  securityintel.ExposureOf(securityintel.ScopeCompile, securityintel.OriginTransitive),
			Manifest:  manifest,
		}
		if entry.testScope {
			component.Scope = securityintel.ScopeTest
			component.Exposure = securityintel.ExposureOf(securityintel.ScopeTest, securityintel.OriginTransitive)
		}
		if requirement, ok := declared[entry.name]; ok {
			component.Direct = true
			component.Origin = securityintel.OriginDeclared
			component.Scope = requirement.scope
			component.Exposure = securityintel.ExposureOf(requirement.scope, securityintel.OriginDeclared)
		}
		components = append(components, component)
	}
	return components
}

// pinnedComponents sono le dipendenze dichiarate con versione esatta, senza lockfile.
func pinnedComponents(declared []declaredRequirement, manifest string) []securityintel.Component {
	components := make([]securityintel.Component, 0, len(declared))
	for _, requirement := range declared {
		if requirement.version == "" {
			continue
		}
		components = append(components, securityintel.Component{
			Ecosystem: securityintel.EcosystemPyPI,
			Name:      requirement.name,
			Version:   requirement.version,
			Scope:     requirement.scope,
			Origin:    securityintel.OriginDeclared,
			Exposure:  securityintel.ExposureOf(requirement.scope, securityintel.OriginDeclared),
			Manifest:  manifest,
			Direct:    true,
		})
	}
	return components
}

// unpinnedNames elenca le dipendenze dichiarate senza versione esatta.
func unpinnedNames(declared []declaredRequirement) []string {
	var names []string
	for _, requirement := range declared {
		if requirement.version == "" {
			names = append(names, requirement.name)
		}
	}
	return names
}

// summarize limita l'elenco nei warning alle prime voci.
func summarize(names []string) string {
	const limit = 8
	if len(names) <= limit {
		return strings.Join(names, ", ")
	}
	return strings.Join(names[:limit], ", ") + ", …"
}

// unitName è il nome leggibile dell'unità: quello del pyproject, altrimenti la cartella.
func unitName(directory string) string {
	if data, err := os.ReadFile(filepath.Join(directory, "pyproject.toml")); err == nil {
		if name := pyprojectName(string(data)); name != "" {
			return name
		}
	}
	return filepath.Base(directory)
}

// declaresDependencies dice se un pyproject dichiara dipendenze (PEP 621 o Poetry).
func declaresDependencies(manifest string) bool {
	data, err := os.ReadFile(manifest)
	if err != nil {
		return false
	}
	text := string(data)
	return strings.Contains(text, "[project]") || strings.Contains(text, "[tool.poetry")
}

// isRequirementsFile riconosce `requirements.txt` e le sue varianti (`requirements-dev.txt`).
func isRequirementsFile(name string) bool {
	return strings.HasPrefix(name, "requirements") && strings.HasSuffix(name, ".txt")
}

// skipDirectory dice se una cartella va saltata dalla scoperta dei manifest: ambienti, dipendenze
// installate, build e cache non contengono manifest del progetto.
func skipDirectory(name string) bool {
	switch strings.ToLower(name) {
	case ".git", ".idea", ".vscode", "node_modules", "vendor", "bin", "build", "dist", "coverage",
		".cache", ".venv", "venv", "env", "__pycache__", ".tox", ".nox", ".mypy_cache", ".pytest_cache",
		".ruff_cache", "site-packages", "testdata", ".task", ".eggs":
		return true
	}
	lower := strings.ToLower(name)
	return strings.HasSuffix(lower, ".egg-info") || strings.HasSuffix(lower, ".dist-info")
}
