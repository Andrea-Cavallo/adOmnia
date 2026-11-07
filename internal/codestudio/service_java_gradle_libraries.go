package codestudio

import (
	"bytes"
	"context"
	"fmt"
	"os"
	"path/filepath"
	"strings"
	"time"

	"github.com/Andrea-Cavallo/adOmnia/internal/ide/project"
	"github.com/Andrea-Cavallo/adOmnia/internal/ide/run"
	"github.com/Andrea-Cavallo/adOmnia/internal/languages/java"
	"github.com/Andrea-Cavallo/adOmnia/internal/procutil"
	mavensecurity "github.com/Andrea-Cavallo/adOmnia/internal/securityintel/maven"
)

const (
	// gradleLibrariesTimeout copre la prima risoluzione (plugin, BOM e dipendenze transitive).
	gradleLibrariesTimeout = 10 * time.Minute
)

// gradleUnits sono i progetti Gradle del workspace, radice prima.
func gradleUnits(workspaceProject Project) []project.Unit {
	var units []project.Unit
	for _, unit := range workspaceProject.Units {
		if unit.Language == java.ID && unit.Kind == java.UnitGradle && unit.Root != "" {
			units = append(units, unit)
		}
	}
	return units
}

// gradleLibraryRefs chiede a Gradle il grafo risolto con un init script di sola lettura. Se il build non
// parte (Gradle assente, build rotto) restituisce comunque le dipendenze dichiarate con una versione,
// così l'albero non resta vuoto: il warning dice che la lista è parziale.
func (s *Service) gradleLibraryRefs(session Session, units []project.Unit) ([]java.LibraryRef, []string) {
	refs := []java.LibraryRef{}
	warnings := []string{}
	for _, unit := range units {
		script, cleanup, err := writeGradleInitScript(java.GradleLibrariesInitScript)
		if err != nil {
			warnings = append(warnings, fmt.Sprintf("%s: %v", unit.Name, err))
			continue
		}
		output, runErr := s.runGradleTask(session, unit.Root, java.GradleLibrariesArguments(script), gradleLibrariesTimeout)
		cleanup()
		parsed := java.ParseGradleLibrariesOutput(output)
		if len(parsed) == 0 {
			if runErr != nil {
				warnings = append(warnings, fmt.Sprintf("%s: Gradle could not resolve the dependencies: %s", unit.Name, lastLines(output, 1200)))
			} else {
				warnings = append(warnings, fmt.Sprintf("%s: Gradle reported no dependencies", unit.Name))
			}
			staticRefs, staticWarnings := staticGradleLibraryRefs(session, []project.Unit{unit})
			refs = append(refs, staticRefs...)
			warnings = append(warnings, staticWarnings...)
			continue
		}
		if runErr != nil {
			warnings = append(warnings, fmt.Sprintf("%s: Gradle reported an error; the list may be partial: %s", unit.Name, lastLines(output, 800)))
		}
		for _, ref := range parsed {
			refs = append(refs, java.LibraryRef{
				GroupID:    ref.GroupID,
				ArtifactID: ref.ArtifactID,
				Version:    ref.Version,
				Scope:      java.GradleScopeName(ref.Configuration),
				Direct:     ref.Direct,
				Module:     projectRelativePath(session.Project, ref.ProjectDir),
			})
		}
	}
	return refs, warnings
}

// staticGradleLibraryRefs legge i build script senza eseguire Gradle: solo le dipendenze con una versione
// scritta (o in una variabile dello stesso script). Version catalog, BOM e transitive richiedono Gradle.
func staticGradleLibraryRefs(session Session, units []project.Unit) ([]java.LibraryRef, []string) {
	refs := []java.LibraryRef{}
	warnings := []string{}
	unversioned := 0
	for _, unit := range units {
		manifests, err := mavensecurity.FindGradleBuilds(unit.Root)
		if err != nil && len(manifests) == 0 {
			warnings = append(warnings, fmt.Sprintf("%s: %v", unit.Name, err))
			continue
		}
		for _, manifest := range manifests {
			data, readErr := os.ReadFile(manifest) // #nosec G304 -- read-only build script inside the opened project
			if readErr != nil {
				continue
			}
			declared, parseErr := java.ParseGradleDependencies(data)
			if parseErr != nil {
				continue
			}
			module := projectRelativePath(session.Project, filepath.Dir(manifest))
			for _, dependency := range declared {
				if dependency.Section != java.SectionDependency {
					continue
				}
				version := dependency.Resolved
				if version == "" {
					unversioned++
					continue
				}
				refs = append(refs, java.LibraryRef{
					GroupID: dependency.GroupID, ArtifactID: dependency.ArtifactID, Version: version,
					Scope: java.GradleScopeName(dependency.Scope), Direct: true, Module: module,
				})
			}
		}
	}
	if unversioned > 0 {
		warnings = append(warnings, fmt.Sprintf("%d Gradle dependencies have no version in the build scripts (managed by a plugin, a platform or a version catalog): authorize the tools to resolve them with Gradle.", unversioned))
	}
	return refs, warnings
}

// markGradleArtifacts completa i flag Downloaded/Sources con la cache Gradle, che ha un layout diverso dal
// repository Maven e viene letta solo quando il progetto ha un'unità Gradle.
func markGradleArtifacts(libraries []java.Library, environment []string) {
	home := java.GradleUserHome(environment)
	if home == "" {
		return
	}
	for index := range libraries {
		library := &libraries[index]
		if !library.Downloaded && java.GradleArtifactPath(home, library.GroupID, library.ArtifactID, library.Version, "") != "" {
			library.Downloaded = true
		}
		if !library.Sources && java.GradleArtifactPath(home, library.GroupID, library.ArtifactID, library.Version, "sources") != "" {
			library.Sources = true
		}
	}
}

// gradleSourcesJar è il jar dei sorgenti nella cache Gradle, o nel repository Maven locale quando Gradle
// risolve da mavenLocal.
func (s *Service) gradleSourcesJar(session Session, groupID, artifactID, version string) string {
	if path := java.ArtifactPath(mavensecurity.LocalRepository(s.javaEnvironment(session)), groupID, artifactID, version, "sources"); fileExists(path) {
		return path
	}
	return java.GradleArtifactPath(java.GradleUserHome(s.javaEnvironment(session)), groupID, artifactID, version, "sources")
}

// downloadGradleLibrarySources risolve l'artefatto sources con i repository del build (init script + task
// detached). Va in rete, quindi parte solo con il progetto autorizzato e dopo la conferma dell'utente.
func (s *Service) downloadGradleLibrarySources(session Session, groupID, artifactID, version string) error {
	units := gradleUnits(session.Project)
	if len(units) == 0 {
		return fmt.Errorf("downloading sources needs a Gradle project")
	}
	script, cleanup, err := writeGradleInitScript(java.GradleSourcesInitScript)
	if err != nil {
		return err
	}
	output, runErr := s.runGradleTask(session, units[0].Root, java.GradleSourcesArguments(script, groupID, artifactID, version), javaSourcesDownloadTimeout)
	cleanup()
	if runErr != nil {
		return fmt.Errorf("Gradle could not download the sources: %s", lastLines(output, 1500))
	}
	if s.gradleSourcesJar(session, groupID, artifactID, version) != "" {
		return nil
	}
	// La cache di un repository locale può stare altrove: vale il file che il task ha risolto.
	for line := range strings.SplitSeq(strings.ReplaceAll(output, "\r\n", "\n"), "\n") {
		if path, ok := strings.CutPrefix(strings.TrimSpace(line), "ADOMNIA|SOURCE|"); ok && fileExists(path) {
			return nil
		}
	}
	return fmt.Errorf("Gradle finished without a sources jar for %s:%s:%s", groupID, artifactID, version)
}

// runGradleTask esegue Gradle nella radice del progetto con l'ambiente del progetto. Gli argomenti sono
// sempre fissi o una coordinata validata: nessun testo libero arriva alla riga di comando.
func (s *Service) runGradleTask(session Session, root string, arguments []string, timeout time.Duration) (string, error) {
	executable, _, _, err := java.BuildToolOf(root)
	if err != nil {
		return "", err
	}
	if err := run.CheckBatchSafe(executable, arguments); err != nil {
		return "", err
	}
	environment, err := s.executionEnvironment(session.ID, java.ID, nil)
	if err != nil {
		return "", err
	}
	ctx, cancel := context.WithTimeout(context.Background(), timeout)
	defer cancel()
	command := procutil.CommandContext(ctx, executable, arguments...)
	command.Dir, command.Env = root, environment
	configureProcess(command, false)
	var log bytes.Buffer
	command.Stdout, command.Stderr = &log, &log
	runErr := command.Run()
	if ctx.Err() != nil {
		return log.String(), fmt.Errorf("Gradle took longer than %s", timeout)
	}
	return log.String(), runErr
}

// writeGradleInitScript scrive lo script in una cartella temporanea (mai nel progetto) e restituisce la
// funzione che lo rimuove.
func writeGradleInitScript(content string) (string, func(), error) {
	file, err := os.CreateTemp("", "adomnia-gradle-*.init.gradle")
	if err != nil {
		return "", func() {}, err
	}
	path := file.Name()
	if _, err := file.WriteString(content); err != nil {
		_ = file.Close()
		_ = os.Remove(path)
		return "", func() {}, err
	}
	if err := file.Close(); err != nil {
		_ = os.Remove(path)
		return "", func() {}, err
	}
	return path, func() { _ = os.Remove(path) }, nil
}
