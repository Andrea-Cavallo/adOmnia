package maven

import (
	"context"
	"fmt"
	"path/filepath"
	"regexp"
	"sort"
	"strings"

	"adomnia/internal/securityintel"
)

// managedVersion è una versione imposta da dependencyManagement o da un BOM.
type managedVersion struct {
	Coordinate Coordinate
	Scope      string
	Optional   bool
	Source     string // "pom", "parent", "bom:<coordinate>"
}

// Resolver risolve il grafo effettivo delle dipendenze di un progetto Maven.
type Resolver struct {
	// LocalRepository è la repository locale Maven. Vuoto: si riconosce da sola.
	LocalRepository string
	// MavenExecutable è l'eseguibile Maven. Se presente e Runnable, la risoluzione
	// usa il vero model builder di Maven e ottiene anche le dipendenze transitive.
	MavenExecutable string
	// Environment è l'ambiente dei processi Maven.
	Environment []string
}

// Result è l'esito della risoluzione di un pom.
type Result struct {
	Components []securityintel.Component
	Warnings   []string
	// EffectivePOM è l'XML dell'effective POM quando Maven lo ha prodotto.
	EffectivePOM string
	// Transitive dice se le dipendenze transitive sono state risolte davvero.
	Transitive bool
}

// maxParentDepth limita la risalita della catena dei parent POM.
const maxParentDepth = 12

// Resolve risolve le dipendenze effettive di un pom.
//
// Prima prova il model builder di Maven, che è l'unico a conoscere davvero la
// risoluzione completa (parent remoti, BOM, profili, transitività). Se Maven non è
// disponibile o non è permesso, risolve in locale leggendo parent e BOM dalla
// repository locale, e lo dichiara: un risultato parziale deve dirsi tale.
func (r *Resolver) Resolve(ctx context.Context, pomPath string, options securityintel.ResolveOptions) (Result, error) {
	if !isFile(pomPath) {
		return Result{}, fmt.Errorf("pom.xml not found: %s", filepath.ToSlash(pomPath))
	}
	if r.MavenExecutable != "" && !options.Offline {
		if result, err := r.resolveWithMaven(ctx, pomPath, options); err == nil {
			return result, nil
		}
		// Maven non ha risposto: si degrada all'analisi locale senza perdere il lavoro.
	}
	return r.resolveLocal(pomPath, options)
}

// resolveLocal risolve in locale, senza eseguire Maven.
//
// Copre ciò che è leggibile dal manifest e dai POM già presenti nella repository
// locale: parent, proprietà, dependencyManagement e BOM importati. Non inventa le
// dipendenze transitive, e lo scrive fra i warning.
func (r *Resolver) resolveLocal(pomPath string, options securityintel.ResolveOptions) (Result, error) {
	repository := r.LocalRepository
	if repository == "" {
		repository = LocalRepository(r.Environment)
	}
	chain, properties, managed, warnings, err := r.loadModel(pomPath, repository)
	if err != nil {
		return Result{}, err
	}
	root := chain[0]
	result := Result{Warnings: warnings}

	// Dipendenze dichiarate: versione dal pom o dal management, origine dalla catena.
	seen := map[string]bool{}
	var seeds []transitiveSeed
	for index := range root.Dependencies {
		dependency := root.Dependencies[index]
		coordinate := DependencyCoordinate(dependency, properties)
		if coordinate.GroupID == "" || coordinate.ArtifactID == "" {
			result.Warnings = append(result.Warnings, fmt.Sprintf("dependency %d of %s has no groupId or artifactId", index+1, filepath.ToSlash(pomPath)))
			continue
		}
		origin := securityintel.OriginDeclared
		if coordinate.Version == "" {
			entry, found := managed[coordinate.Key()]
			if !found {
				result.Warnings = append(result.Warnings, fmt.Sprintf("%s has no version and no managed version: the build resolves it, this analysis cannot", coordinate.Key()))
				continue
			}
			coordinate.Version = entry.Coordinate.Version
			origin = securityintel.OriginManaged
			if entry.Source != "pom" {
				origin = securityintel.OriginInherited
			}
		}
		if dependency.Optional && !options.IncludeOptional {
			continue
		}
		scope := ScopeOf(dependency)
		if entry, found := managed[coordinate.Key()]; found && dependency.Scope == "" && entry.Scope != "" {
			scope = entry.Scope
		}
		if scope == "import" {
			continue // un import gestisce versioni, non è una dipendenza eseguibile
		}
		component := securityintel.Component{
			Ecosystem: securityintel.EcosystemMaven,
			Name:      coordinate.Key(),
			Version:   coordinate.Version,
			Scope:     securityintel.Scope(scope),
			Origin:    origin,
			Exposure:  securityintel.ExposureOf(securityintel.Scope(scope), origin),
			Manifest:  pomPath,
			Direct:    true,
		}
		component.DependencyPath = []string{rootName(root), component.Name}
		if seen[component.Key()] {
			continue
		}
		seen[component.Key()] = true
		result.Components = append(result.Components, component)
		seeds = append(seeds, transitiveSeed{Component: component, Exclusions: exclusionsOf(dependency)})
	}

	// Dipendenze dei plugin di build: non finiscono nell'artefatto, ma eseguono
	// durante il build e possono essere vulnerabili quanto le altre.
	if options.IncludePluginDependencies {
		for _, plugin := range root.Build.Plugins {
			properties := properties
			for _, dependency := range plugin.Dependencies {
				coordinate := DependencyCoordinate(dependency, properties)
				if coordinate.GroupID == "" || coordinate.ArtifactID == "" {
					continue
				}
				if coordinate.Version == "" {
					if entry, found := managed[coordinate.Key()]; found {
						coordinate.Version = entry.Coordinate.Version
					} else {
						continue
					}
				}
				component := securityintel.Component{
					Ecosystem: securityintel.EcosystemMaven,
					Name:      coordinate.Key(),
					Version:   coordinate.Version,
					Scope:     securityintel.ScopeBuild,
					Origin:    securityintel.OriginPlugin,
					Exposure:  securityintel.ExposureBuild,
					Manifest:  pomPath,
					Direct:    true,
				}
				component.DependencyPath = []string{rootName(root), component.Name}
				if seen[component.Key()] {
					continue
				}
				seen[component.Key()] = true
				result.Components = append(result.Components, component)
			}
		}
	}

	// Transitive: visita dei POM della repository locale, senza Maven. Completa solo se nessun POM manca.
	if repository != "" {
		walked := r.walkTransitive(seeds, managed, repository, pomPath)
		result.Components = append(result.Components, walked.Components...)
		result.Warnings = append(result.Warnings, transitiveWarnings(walked)...)
		result.Transitive = walked.Missing == 0 && !walked.Truncated
	} else {
		result.Warnings = append(result.Warnings, "transitive dependencies were not resolved: no local Maven repository was found and Maven was not available. Findings cover the dependencies declared in the POM chain only.")
	}
	sort.SliceStable(result.Components, func(left, right int) bool { return result.Components[left].Name < result.Components[right].Name })
	return result, nil
}

// loadModel risale la catena dei parent POM e raccoglie proprietà, dipendenze e
// versioni gestite, includendo i BOM importati.
func (r *Resolver) loadModel(pomPath, repository string) ([]POM, map[string]string, map[string]managedVersion, []string, error) {
	var chain []POM
	properties := map[string]string{}
	managed := map[string]managedVersion{}
	warnings := []string{}
	current := pomPath
	for depth := 0; depth < maxParentDepth; depth++ {
		pom, err := ReadPOM(current)
		if err != nil && pom.ArtifactID == "" {
			if depth == 0 {
				return nil, nil, nil, nil, fmt.Errorf("read %s: %w", filepath.ToSlash(current), err)
			}
			warnings = append(warnings, fmt.Sprintf("parent POM %s could not be read: %v", filepath.ToSlash(current), err))
			break
		}
		chain = append(chain, pom)
		properties = PomProperties(pom, properties)

		// Le versioni gestite di questo pom valgono solo se non già definite da un
		// figlio: in Maven il management più vicino vince.
		for _, dependency := range pom.DependencyManagement.Dependencies {
			coordinate := DependencyCoordinate(dependency, properties)
			if coordinate.GroupID == "" || coordinate.ArtifactID == "" {
				continue
			}
			if coordinate.Version == "" {
				continue
			}
			if _, exists := managed[coordinate.Key()]; exists {
				continue
			}
			managed[coordinate.Key()] = managedVersion{
				Coordinate: coordinate,
				Scope:      ScopeOf(dependency),
				Optional:   dependency.Optional,
				Source:     "pom",
			}
			// Un BOM importato porta dentro le versioni di un altro progetto.
			if ScopeOf(dependency) == "import" && (coordinate.Type == "pom" || coordinate.Type == "") {
				bomPath := PomPath(repository, coordinate)
				if bomPath == "" || !isFile(bomPath) {
					warnings = append(warnings, fmt.Sprintf("BOM %s is not in the local repository: managed versions it defines are unknown", coordinate.String()))
					continue
				}
				bomWarnings := r.mergeBOM(bomPath, repository, properties, managed, 0)
				warnings = append(warnings, bomWarnings...)
			}
		}

		parent, ok := ParentCoordinate(pom, properties)
		if !ok {
			break
		}
		next := parentPath(pom, parent, current)
		if next == "" || !isFile(next) {
			// Un POM della repository locale non ha un parent a ../pom.xml: sta anch'esso nella repository.
			next = PomPath(repository, parent)
		}
		if next == "" || !isFile(next) {
			warnings = append(warnings, fmt.Sprintf("parent POM %s is not available locally: inherited dependencies and managed versions are unknown", parent.String()))
			break
		}
		current = next
	}
	// L'ultimo pom letto è il più esterno: il suo management è il meno specifico.
	// La mappa è già impostata dal più vicino, che in Maven ha la precedenza.
	return chain, properties, managed, warnings, nil
}

// mergeBOM incorpora il dependencyManagement di un BOM importato.
func (r *Resolver) mergeBOM(bomPath, repository string, properties map[string]string, managed map[string]managedVersion, depth int) []string {
	if depth > maxParentDepth {
		return []string{fmt.Sprintf("BOM chain too deep at %s", filepath.ToSlash(bomPath))}
	}
	bom, err := ReadPOM(bomPath)
	if err != nil {
		return []string{fmt.Sprintf("BOM %s could not be read: %v", filepath.ToSlash(bomPath), err)}
	}
	bomProperties := PomProperties(bom, properties)
	warnings := []string{}
	for _, dependency := range bom.DependencyManagement.Dependencies {
		coordinate := DependencyCoordinate(dependency, bomProperties)
		if coordinate.GroupID == "" || coordinate.ArtifactID == "" || coordinate.Version == "" {
			continue
		}
		if _, exists := managed[coordinate.Key()]; exists {
			continue
		}
		managed[coordinate.Key()] = managedVersion{
			Coordinate: coordinate,
			Scope:      ScopeOf(dependency),
			Optional:   dependency.Optional,
			Source:     "bom:" + filepath.ToSlash(bomPath),
		}
	}
	return warnings
}

// parentPath decide dove cercare il parent POM: il relativePath del pom se porta a un
// file, altrimenti la repository locale.
func parentPath(pom POM, parent Coordinate, current string) string {
	if pom.Parent != nil && pom.Parent.RelativePath != "" && pom.Parent.RelativePath != "non-existent" {
		candidate := filepath.Join(filepath.Dir(current), filepath.FromSlash(pom.Parent.RelativePath))
		if isFile(candidate) {
			return candidate
		}
		if isFile(filepath.Join(candidate, "pom.xml")) {
			return filepath.Join(candidate, "pom.xml")
		}
	}
	return ""
}

// rootName è il nome mostrato come radice del grafo di dipendenze.
func rootName(pom POM) string {
	if pom.ArtifactID != "" {
		return pom.ArtifactID
	}
	return "project"
}

// treeLinePattern riconosce una riga dell'output di `mvn dependency:tree`.
var treeMarkerPattern = regexp.MustCompile(`^([|\\+\-\s]*)(?:\+|\\)?-?\s?(.*)$`)

// dependencyEntryPattern riconosce la coordinata in una riga dell'albero.
var dependencyEntryPattern = regexp.MustCompile(`^([^:\s]+):([^:\s]+):([^:\s]+)(?::([^:\s]*))?(?::([^:\s]*))?$`)

// parseDependencyTree legge l'output testuale di `mvn dependency:tree` e restituisce
// componenti con la loro catena di dipendenze.
//
// L'albero di Maven è la verità sulle transitività: mostra anche le versioni che la
// risoluzione ha effettivamente scelto, non quelle che il manifest suggeriva.
func parseDependencyTree(output, rootDirectory string) ([]securityintel.Component, []string) {
	components := []securityintel.Component{}
	warnings := []string{}
	// stack tiene il percorso dalla radice al nodo corrente, per livello di indentazione.
	stack := []string{}
	seen := map[string]bool{}
	for _, raw := range strings.Split(output, "\n") {
		line := strings.TrimRight(raw, "\r")
		if !strings.Contains(line, "[INFO]") {
			continue
		}
		content := strings.TrimPrefix(line, "[INFO]")
		content = strings.TrimRight(content, " \t")
		if content == "" {
			continue
		}
		// Le righe di intestazione dell'albero non sono dipendenze.
		if !strings.Contains(content, ":") {
			continue
		}
		marker := treeMarkerPattern.FindStringSubmatch(content)
		if marker == nil {
			continue
		}
		indent, entry := marker[1], strings.TrimSpace(marker[2])
		// La radice dell'albero non ha marcatore.
		if !strings.Contains(indent, "+") && !strings.Contains(indent, "\\") {
			if len(stack) == 0 {
				stack = append(stack, entry)
			}
			continue
		}
		level := treeLevel(indent)
		if level <= 0 {
			level = 1
		}
		for len(stack) > level {
			stack = stack[:len(stack)-1]
		}
		if len(stack) < level {
			stack = append(stack, entry)
		} else {
			stack[len(stack)-1] = entry
		}
		parts := dependencyEntryPattern.FindStringSubmatch(entry)
		if parts == nil {
			continue
		}
		scope := parts[5]
		if scope == "" {
			scope = "compile"
		}
		component := securityintel.Component{
			Ecosystem: securityintel.EcosystemMaven,
			Name:      parts[1] + ":" + parts[2],
			Version:   parts[4],
			Scope:     securityintel.Scope(strings.ToLower(scope)),
			Origin:    securityintel.OriginTransitive,
			Exposure:  securityintel.ExposureOf(securityintel.Scope(strings.ToLower(scope)), securityintel.OriginTransitive),
			Manifest:  filepath.Join(rootDirectory, "pom.xml"),
			Direct:    level == 1,
		}
		if component.Direct {
			component.Origin = securityintel.OriginDeclared
		}
		component.DependencyPath = append(append([]string{}, stack[:min(level, len(stack))]...), component.Name)
		if seen[component.Key()] {
			continue
		}
		seen[component.Key()] = true
		components = append(components, component)
	}
	return components, warnings
}

// treeLevel conta il livello di indentazione di una riga dell'albero di Maven.
func treeLevel(indent string) int {
	level := 0
	for _, char := range indent {
		switch char {
		case '+', '\\':
			level++
		case ' ', '|', '\t':
		}
	}
	// Ogni marcatore di livello è preceduto da due spazi o da "| ".
	prefix := indent
	prefix = strings.ReplaceAll(prefix, "|", " ")
	prefix = strings.ReplaceAll(prefix, "+", "")
	prefix = strings.ReplaceAll(prefix, "-", "")
	prefix = strings.ReplaceAll(prefix, "\\", "")
	return len(prefix)/2 + 1
}

// min ritorna il minore fra due interi.
func min(left, right int) int {
	if left < right {
		return left
	}
	return right
}
