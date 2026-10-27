package maven

import (
	"fmt"
	"strings"

	"github.com/Andrea-Cavallo/adOmnia/internal/securityintel"
)

// Limiti della visita: un grafo reale ha centinaia di nodi, non decine di migliaia.
const (
	maxTransitiveNodes = 4000
	maxTransitiveDepth = 24
)

// transitiveSeed è una dipendenza dichiarata dal progetto, punto di partenza della visita.
type transitiveSeed struct {
	Component  securityintel.Component
	Exclusions []exclusion
}

type exclusion struct{ GroupID, ArtifactID string }

type transitiveNode struct {
	Coordinate Coordinate
	Scope      string
	Path       []string
	Exclusions []exclusion
	Depth      int
}

// transitiveResult è l'esito della visita offline.
type transitiveResult struct {
	Components []securityintel.Component
	// Missing sono i POM che non stanno nella repository locale: i loro figli non si conoscono.
	Missing   int
	Truncated bool
}

// walkTransitive risolve le dipendenze transitive leggendo i POM della repository locale, senza eseguire Maven.
//
// Applica le regole di Maven che contano per capire cosa finisce nel classpath: mediazione "il più vicino
// vince" (visita in ampiezza, le dichiarate per prime), propagazione dello scope, esclusione di optional,
// provided e test dei figli, `<exclusions>`, e le versioni di `dependencyManagement` del progetto che valgono
// anche per le transitive. Non conosce i profili né i range di versione complessi: un POM mancante o un range
// non risolvibile si dichiara, mai si inventa.
func (r *Resolver) walkTransitive(seeds []transitiveSeed, rootManaged map[string]managedVersion, repository string, manifest string) transitiveResult {
	result := transitiveResult{}
	visited := map[string]bool{}
	var queue []transitiveNode
	for _, seed := range seeds {
		visited[seed.Component.Key()] = true
		name := seed.Component.Name
		group, artifact, _ := strings.Cut(name, ":")
		queue = append(queue, transitiveNode{
			Coordinate: Coordinate{GroupID: group, ArtifactID: artifact, Version: seed.Component.Version, Type: "pom"},
			Scope:      string(seed.Component.Scope),
			Path:       seed.Component.DependencyPath,
			Exclusions: seed.Exclusions,
		})
	}
	models := map[string]*childModel{}
	for len(queue) > 0 {
		node := queue[0]
		queue = queue[1:]
		if node.Depth >= maxTransitiveDepth {
			result.Truncated = true
			continue
		}
		model := r.childModelOf(PomPath(repository, node.Coordinate), repository, models)
		if model == nil {
			result.Missing++
			continue
		}
		for _, dependency := range model.dependencies {
			child, ok := childCoordinate(dependency, model, rootManaged)
			if !ok || excluded(child, node.Exclusions) {
				continue
			}
			scope, ok := propagatedScope(node.Scope, ScopeOf(dependency))
			if !ok || dependency.Optional || visited[child.Key()] {
				continue
			}
			if len(result.Components) >= maxTransitiveNodes {
				result.Truncated = true
				return result
			}
			visited[child.Key()] = true
			component := securityintel.Component{
				Ecosystem: securityintel.EcosystemMaven, Name: child.Key(), Version: child.Version,
				Scope: securityintel.Scope(scope), Origin: securityintel.OriginTransitive,
				Exposure: securityintel.ExposureOf(securityintel.Scope(scope), securityintel.OriginTransitive),
				Manifest: manifest, Direct: false,
			}
			component.DependencyPath = append(append([]string{}, node.Path...), component.Name)
			result.Components = append(result.Components, component)
			child.Type = "pom"
			queue = append(queue, transitiveNode{Coordinate: child, Scope: scope, Path: component.DependencyPath, Exclusions: append(append([]exclusion{}, node.Exclusions...), exclusionsOf(dependency)...), Depth: node.Depth + 1})
		}
	}
	return result
}

// childModel è un POM della repository locale con le sue proprietà e le versioni gestite lungo parent e BOM.
type childModel struct {
	dependencies []Dependency
	properties   map[string]string
	managed      map[string]managedVersion
}

func (r *Resolver) childModelOf(path, repository string, cache map[string]*childModel) *childModel {
	if path == "" || !isFile(path) {
		return nil
	}
	if cached, ok := cache[path]; ok {
		return cached
	}
	chain, properties, managed, _, err := r.loadModel(path, repository)
	if err != nil || len(chain) == 0 {
		cache[path] = nil
		return nil
	}
	model := &childModel{dependencies: chain[0].Dependencies, properties: properties, managed: managed}
	cache[path] = model
	return model
}

// childCoordinate è la coordinata effettiva di una dipendenza di un POM: la versione del management del progetto
// vince su quella del figlio (è così in Maven), poi quella scritta, poi quella del management del figlio.
func childCoordinate(dependency Dependency, model *childModel, rootManaged map[string]managedVersion) (Coordinate, bool) {
	coordinate := DependencyCoordinate(dependency, model.properties)
	if coordinate.GroupID == "" || coordinate.ArtifactID == "" {
		return Coordinate{}, false
	}
	if entry, found := rootManaged[coordinate.Key()]; found && entry.Coordinate.Version != "" {
		coordinate.Version = entry.Coordinate.Version
	} else if coordinate.Version == "" {
		if entry, found := model.managed[coordinate.Key()]; found {
			coordinate.Version = entry.Coordinate.Version
		}
	}
	coordinate.Version = pinnedVersion(coordinate.Version)
	return coordinate, coordinate.Version != "" && !strings.Contains(coordinate.Version, "${")
}

// pinnedVersion riduce un range Maven al suo limite inferiore ("[1.2,2.0)" → "1.2"); "" se non c'è.
func pinnedVersion(version string) string {
	version = strings.TrimSpace(version)
	if !strings.HasPrefix(version, "[") && !strings.HasPrefix(version, "(") {
		return version
	}
	lower, _, _ := strings.Cut(strings.Trim(version, "[]()"), ",")
	return strings.TrimSpace(lower)
}

// propagatedScope è lo scope di una transitiva dato lo scope del genitore e quello dichiarato dal figlio.
// provided, test e system dei figli non sono transitivi.
func propagatedScope(parent, child string) (string, bool) {
	if child != "compile" && child != "runtime" {
		return "", false
	}
	switch parent {
	case "compile":
		return child, true
	case "runtime":
		return "runtime", true
	case "provided", "test":
		return parent, true
	}
	return "", false
}

func exclusionsOf(dependency Dependency) []exclusion {
	result := make([]exclusion, 0, len(dependency.Exclusions))
	for _, item := range dependency.Exclusions {
		result = append(result, exclusion{GroupID: item.GroupID, ArtifactID: item.ArtifactID})
	}
	return result
}

func excluded(coordinate Coordinate, exclusions []exclusion) bool {
	for _, item := range exclusions {
		if (item.GroupID == "*" || item.GroupID == coordinate.GroupID) && (item.ArtifactID == "*" || item.ArtifactID == coordinate.ArtifactID) {
			return true
		}
	}
	return false
}

// transitiveWarnings dice cosa la visita non ha coperto.
func transitiveWarnings(result transitiveResult) []string {
	var warnings []string
	if result.Missing > 0 {
		warnings = append(warnings, fmt.Sprintf("%d dependency POMs are not in the local Maven repository (never downloaded): what they bring in is not covered. Build the project once with Maven, or authorize Maven, for the full graph.", result.Missing))
	}
	if result.Truncated {
		warnings = append(warnings, fmt.Sprintf("the transitive walk stopped at %d dependencies or %d levels: the graph is larger than analyzed.", maxTransitiveNodes, maxTransitiveDepth))
	}
	return warnings
}
