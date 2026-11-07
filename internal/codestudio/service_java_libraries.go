package codestudio

import (
	"bytes"
	"context"
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"strings"
	"time"

	"github.com/Andrea-Cavallo/adOmnia/internal/ide/langserver"
	"github.com/Andrea-Cavallo/adOmnia/internal/ide/project"
	"github.com/Andrea-Cavallo/adOmnia/internal/ide/run"
	"github.com/Andrea-Cavallo/adOmnia/internal/languages/java"
	"github.com/Andrea-Cavallo/adOmnia/internal/procutil"
	"github.com/Andrea-Cavallo/adOmnia/internal/securityintel"
	mavensecurity "github.com/Andrea-Cavallo/adOmnia/internal/securityintel/maven"
)

const (
	// javaLibrariesTimeout copre la risoluzione offline di tutti i pom: legge solo file del repository locale.
	javaLibrariesTimeout = 20 * time.Second
	// javaSourcesDownloadTimeout è il primo `dependency:get`: può scaricare anche il plugin.
	javaSourcesDownloadTimeout = 5 * time.Minute
	javaLibrariesMaxComponents = 5000
)

// JavaLibraries è External Libraries di un progetto Java (Maven o Gradle).
type JavaLibraries struct {
	Libraries []java.Library `json:"libraries"`
	// Repository è il repository Maven locale da cui si leggono jar e sorgenti; Gradle aggiunge la sua cache.
	Repository string   `json:"repository"`
	Warnings   []string `json:"warnings"`
}

// JavaLibraries elenca le dipendenze che i build del progetto risolvono (Maven dai pom, Gradle dai build
// script), transitive comprese, con lo stesso resolver offline del pom per Maven e un task di sola lettura per
// Gradle. Maven legge solo file; Gradle viene eseguito solo con il progetto autorizzato, altrimenti si leggono
// le dipendenze dichiarate con una versione.
func (s *Service) JavaLibraries(sessionID string) (JavaLibraries, error) {
	session, err := s.session(sessionID)
	if err != nil {
		return JavaLibraries{}, err
	}
	environment := s.javaEnvironment(session)
	repository := mavensecurity.LocalRepository(environment)
	var poms []string
	for _, unit := range mavenUnits(session.Project) {
		poms = append(poms, java.ReactorPoms(unit.Manifest, session.Project.RealPath)...)
	}
	own := map[string]bool{}
	for _, pom := range poms {
		if coordinate := java.ProjectCoordinate(pom); coordinate != "" {
			own[coordinate] = true
		}
	}
	ctx, cancel := context.WithTimeout(context.Background(), javaLibrariesTimeout)
	defer cancel()
	resolver := mavensecurity.New().Resolver
	resolver.LocalRepository = repository
	result := JavaLibraries{Repository: repository, Warnings: []string{}}
	var refs []java.LibraryRef
	for _, pom := range poms {
		resolved, err := resolver.Resolve(ctx, pom, securityintel.ResolveOptions{Offline: true, MaxComponents: javaLibrariesMaxComponents})
		module := projectRelativePath(session.Project, filepath.Dir(pom))
		if err != nil {
			result.Warnings = append(result.Warnings, fmt.Sprintf("%s: %v", filepath.ToSlash(filepath.Join(module, "pom.xml")), err))
			continue
		}
		for _, component := range resolved.Components {
			group, artifact, _ := strings.Cut(component.Name, ":")
			refs = append(refs, java.LibraryRef{GroupID: group, ArtifactID: artifact, Version: component.Version, Scope: string(component.Scope), Direct: component.Direct, Module: module})
		}
	}
	gradle := gradleUnits(session.Project)
	if len(gradle) > 0 {
		if session.Project.Authorization == AuthorizationPermitted {
			gradleRefs, warnings := s.gradleLibraryRefs(session, gradle)
			refs = append(refs, gradleRefs...)
			result.Warnings = append(result.Warnings, warnings...)
		} else {
			gradleRefs, warnings := staticGradleLibraryRefs(session, gradle)
			refs = append(refs, gradleRefs...)
			result.Warnings = append(result.Warnings, warnings...)
			result.Warnings = append(result.Warnings, "Authorize the tools for this project to resolve Gradle dependencies with Gradle: transitive dependencies, platforms and version catalogs need it.")
		}
	}
	result.Libraries = java.MergeLibraries(refs, own, repository)
	if len(gradle) > 0 {
		markGradleArtifacts(result.Libraries, environment)
	}
	return result, nil
}

// JavaLibrarySource prepara il codice di una libreria: estrae (una volta) il suo jar dei sorgenti in cache e
// lo descrive come la sorgente di un modulo Go. Senza jar dei sorgenti dice cosa manca.
func (s *Service) JavaLibrarySource(sessionID, groupID, artifactID, version string) (DependencySource, error) {
	session, err := s.session(sessionID)
	if err != nil {
		return DependencySource{}, err
	}
	if !java.LibraryCoordinateValid(groupID, artifactID, version) {
		return DependencySource{}, errors.New("invalid Maven coordinate")
	}
	source := DependencySource{ModulePath: groupID + ":" + artifactID, Version: version, Found: true, Files: []DependencySourceFile{}}
	directory := java.SourcesDirectory(langserver.VirtualDocumentsRoot(), groupID, artifactID, version)
	if !java.SourcesExtracted(directory) {
		sourcesJar := s.gradleSourcesJar(session, groupID, artifactID, version)
		if !fileExists(sourcesJar) {
			source.Reason = "the sources of this library are not in the local Maven repository or the Gradle cache yet"
			return source, nil
		}
		if err := java.ExtractSources(sourcesJar, directory); err != nil {
			return DependencySource{}, err
		}
	}
	return describeDependencyDirectory(session.Project, source, directory, "maven-sources"), nil
}

// DownloadJavaLibrarySources scarica il jar dei sorgenti di una libreria: con Gradle usar il build del
// progetto (init script), con Maven `dependency:get`. Va in rete e lancia un tool, quindi solo con il progetto
// autorizzato e dopo la conferma.
func (s *Service) DownloadJavaLibrarySources(sessionID, groupID, artifactID, version string) error {
	session, err := s.session(sessionID)
	if err != nil {
		return err
	}
	if session.Project.Authorization != AuthorizationPermitted {
		return errors.New("explicitly authorize the tools for this project")
	}
	if !java.LibraryCoordinateValid(groupID, artifactID, version) {
		return errors.New("invalid library coordinate")
	}
	units := mavenUnits(session.Project)
	if len(gradleUnits(session.Project)) > 0 {
		err := s.downloadGradleLibrarySources(session, groupID, artifactID, version)
		if err == nil {
			return nil
		}
		// Un progetto con entrambi i build: la libreria può essere solo nel pom.
		if len(units) == 0 {
			return err
		}
	}
	if len(units) == 0 {
		return errors.New("downloading sources needs a Maven or Gradle project")
	}
	executable, _, _, err := java.BuildToolOf(units[0].Root)
	if err != nil {
		return err
	}
	arguments := java.SourcesDownloadArguments(groupID, artifactID, version)
	if err := run.CheckBatchSafe(executable, arguments); err != nil {
		return err
	}
	environment, err := s.executionEnvironment(session.ID, java.ID, nil)
	if err != nil {
		return err
	}
	ctx, cancel := context.WithTimeout(context.Background(), javaSourcesDownloadTimeout)
	defer cancel()
	command := procutil.CommandContext(ctx, executable, arguments...)
	command.Dir, command.Env = units[0].Root, environment
	configureProcess(command, false)
	var log bytes.Buffer
	command.Stdout, command.Stderr = &log, &log
	if err := command.Run(); err != nil {
		if ctx.Err() != nil {
			return fmt.Errorf("the download took longer than %s", javaSourcesDownloadTimeout)
		}
		return fmt.Errorf("this library publishes no sources, or Maven could not download them: %s", lastLines(log.String(), 1500))
	}
	return nil
}

// javaEnvironment è l'ambiente dei comandi Java del progetto, o quello del processo se non si ricava:
// serve a trovare il repository locale (maven.repo.local, MAVEN_OPTS) come lo troverebbe Maven.
func (s *Service) javaEnvironment(session Session) []string {
	if environment, err := s.executionEnvironment(session.ID, java.ID, nil); err == nil {
		return environment
	}
	return os.Environ()
}

// mavenUnits sono i moduli Maven del progetto, radice prima.
func mavenUnits(workspaceProject Project) []project.Unit {
	var units []project.Unit
	for _, unit := range workspaceProject.Units {
		if unit.Language == java.ID && unit.Kind == java.UnitMaven && unit.Manifest != "" {
			units = append(units, unit)
		}
	}
	return units
}

// lastLines è la coda di un output di tool, senza spazi ai lati.
func lastLines(text string, limit int) string {
	text = strings.TrimSpace(text)
	if len(text) > limit {
		text = text[len(text)-limit:]
	}
	return text
}
