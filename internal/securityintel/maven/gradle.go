package maven

import (
	"context"
	"fmt"
	"os"
	"path/filepath"
	"sort"
	"strings"

	"github.com/Andrea-Cavallo/adOmnia/internal/ide/project"
	"github.com/Andrea-Cavallo/adOmnia/internal/languages/java"
	"github.com/Andrea-Cavallo/adOmnia/internal/securityintel"
)

// Gradle usa le coordinate Maven (OSV: ecosistema "Maven"), quindi i build.gradle(.kts) passano da questo adapter:
// stesso motore CVE, stessa UI. La risoluzione è statica — le dipendenze con versione scritta (o in una variabile
// dello stesso script) — perché eseguire Gradle significherebbe eseguire il build dell'utente.

func isGradleManifest(path string) bool {
	name := filepath.Base(path)
	return name == "build.gradle" || name == "build.gradle.kts"
}

// FindGradleBuilds trova i build script sotto root, anche dei sottomoduli (ognuno dichiara le sue dipendenze).
// Una cartella con pom.xml è Maven: il suo pom è già un target.
func FindGradleBuilds(root string) ([]string, error) {
	var manifests []string
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
		if path != root && (project.IgnoredDirectory(entry.Name()) || strings.EqualFold(entry.Name(), "build") || depthOf(root, path) > 5) {
			return filepath.SkipDir
		}
		if visited++; visited > 4_000 || len(manifests) >= 50 {
			return filepath.SkipAll
		}
		if isFile(filepath.Join(path, "pom.xml")) {
			return nil
		}
		for _, name := range []string{"build.gradle", "build.gradle.kts"} {
			if script := filepath.Join(path, name); isFile(script) {
				manifests = append(manifests, script)
				break
			}
		}
		return nil
	})
	sort.Strings(manifests)
	return manifests, err
}

// gradleScope traduce la configurazione Gradle nello scope Maven che il motore sa leggere.
func gradleScope(configuration string) securityintel.Scope {
	switch {
	case strings.HasPrefix(configuration, "test"):
		return securityintel.ScopeTest
	case strings.HasPrefix(configuration, "compileOnly"), strings.HasPrefix(configuration, "provided"):
		return securityintel.ScopeProvided
	case strings.HasPrefix(configuration, "runtime"), configuration == "developmentOnly":
		return securityintel.ScopeRuntime
	case configuration == "annotationProcessor", configuration == "kapt", configuration == "ksp", configuration == "classpath":
		return securityintel.ScopeBuild
	}
	return securityintel.ScopeCompile
}

// resolveGradle legge le dipendenze dichiarate nel build script.
func (r *Resolver) resolveGradle(_ context.Context, path string) (securityintel.Resolution, error) {
	data, err := os.ReadFile(path)
	if err != nil {
		return securityintel.Resolution{}, fmt.Errorf("read %s: %w", filepath.ToSlash(path), err)
	}
	declared, err := java.ParseGradleDependencies(data)
	if err != nil {
		return securityintel.Resolution{}, err
	}
	resolution := securityintel.Resolution{}
	managed, bomWarnings := r.gradleManagedVersions(declared)
	resolution.Warnings = append(resolution.Warnings, bomWarnings...)
	seen := map[string]bool{}
	unversioned := 0
	for _, dependency := range declared {
		if dependency.Section != java.SectionDependency {
			continue // piattaforme/BOM e plugin non sono artefatti con CVE propri qui
		}
		version, origin := dependency.Resolved, securityintel.OriginDeclared
		if version == "" {
			entry, found := managed[dependency.Key()]
			if !found {
				unversioned++
				continue
			}
			version, origin = entry.Coordinate.Version, securityintel.OriginInherited
		}
		scope := gradleScope(dependency.Scope)
		component := securityintel.Component{
			Ecosystem: securityintel.EcosystemMaven, Name: dependency.Key(), Version: version, Scope: scope,
			Origin: origin, Exposure: securityintel.ExposureOf(scope, origin),
			Manifest: path, Direct: true, DependencyPath: []string{filepath.Base(filepath.Dir(path)), dependency.Key()},
		}
		if !seen[component.Key()] {
			seen[component.Key()] = true
			resolution.Components = append(resolution.Components, component)
		}
	}
	sort.SliceStable(resolution.Components, func(i, j int) bool { return resolution.Components[i].Name < resolution.Components[j].Name })
	resolution.Warnings = append(resolution.Warnings, "Gradle is read statically: only dependencies declared with a version in this script are checked, transitive ones are not.")
	if unversioned > 0 {
		resolution.Warnings = append(resolution.Warnings, fmt.Sprintf("%d dependencies have no version in this script (managed by a plugin or a platform whose BOM is not in the local Maven repository): they are not checked.", unversioned))
	}
	return resolution, nil
}

// springBootPlugin è il plugin che, con la sua versione, fissa le versioni di spring-boot-dependencies.
const springBootPlugin = "org.springframework.boot"

// gradleManagedVersions legge i BOM che il build script rende visibili senza eseguire Gradle:
// `platform("g:a:v")` e il plugin Spring Boot (che gestisce le versioni di spring-boot-dependencies:<versione>).
// I BOM si leggono dalla repository Maven locale: nessuna rete; un BOM assente diventa un warning.
func (r *Resolver) gradleManagedVersions(declared []java.PomDependency) (map[string]managedVersion, []string) {
	repository := r.LocalRepository
	if repository == "" {
		repository = LocalRepository(r.Environment)
	}
	var boms []Coordinate
	for _, dependency := range declared {
		switch {
		case dependency.Section == java.SectionManagement && dependency.Resolved != "":
			boms = append(boms, Coordinate{GroupID: dependency.GroupID, ArtifactID: dependency.ArtifactID, Version: dependency.Resolved, Type: "pom"})
		case dependency.Section == java.SectionPlugin && dependency.GroupID == springBootPlugin && dependency.Resolved != "":
			boms = append(boms, Coordinate{GroupID: springBootPlugin, ArtifactID: "spring-boot-dependencies", Version: dependency.Resolved, Type: "pom"})
		}
	}
	managed := map[string]managedVersion{}
	var warnings []string
	for _, bom := range boms {
		path := ""
		if repository != "" {
			path = PomPath(repository, bom)
		}
		if path == "" || !isFile(path) {
			warnings = append(warnings, fmt.Sprintf("BOM %s is not in the local Maven repository: the versions it manages are not checked", bom.String()))
			continue
		}
		warnings = append(warnings, r.mergeBOM(path, repository, map[string]string{}, managed, 0)...)
	}
	return managed, warnings
}
