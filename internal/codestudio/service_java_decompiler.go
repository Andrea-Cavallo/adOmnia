package codestudio

import (
	"bytes"
	"context"
	"errors"
	"fmt"
	"path/filepath"
	"time"

	"github.com/Andrea-Cavallo/adOmnia/internal/ide/langserver"
	"github.com/Andrea-Cavallo/adOmnia/internal/languages/java"
	"github.com/Andrea-Cavallo/adOmnia/internal/procutil"
	mavensecurity "github.com/Andrea-Cavallo/adOmnia/internal/securityintel/maven"
)

// javaDecompileTimeout bounds one jar: Vineflower handles thousands of classes a minute.
const javaDecompileTimeout = 10 * time.Minute

// PreviewJavaDecompilerInstall is the exact command that installs Vineflower, for the confirmation.
func (s *Service) PreviewJavaDecompilerInstall(sessionID string) (ServerInstallPreview, error) {
	if _, err := s.session(sessionID); err != nil {
		return ServerInstallPreview{}, err
	}
	return java.DecompilerInstallPlan(s.toolsRoot)
}

// InstallJavaDecompiler downloads Vineflower into the tools folder after explicit confirmation, in the Run
// console.
func (s *Service) InstallJavaDecompiler(sessionID string, confirmed bool) (Execution, error) {
	if !confirmed {
		return Execution{}, errors.New("explicit confirmation required before downloading the tools")
	}
	session, err := s.session(sessionID)
	if err != nil {
		return Execution{}, err
	}
	if session.Project.Authorization != AuthorizationPermitted {
		return Execution{}, errors.New("trust the project before installing tools")
	}
	plan, err := java.DecompilerInstallPlan(s.toolsRoot)
	if err != nil {
		return Execution{}, err
	}
	return s.runInstallPlan(session, plan)
}

// DecompileJavaJar decompiles a .jar (relative to the project, or absolute: a library of the local Maven
// repository) into a read-only cache and describes it like the sources of a library.
func (s *Service) DecompileJavaJar(sessionID, jar string) (DependencySource, error) {
	session, err := s.session(sessionID)
	if err != nil {
		return DependencySource{}, err
	}
	if session.Project.Authorization != AuthorizationPermitted {
		return DependencySource{}, errors.New("explicitly authorize the tools for this project")
	}
	path := jar
	if !filepath.IsAbs(path) {
		if path, err = s.documents.ResolveProjectPath(session.Project, jar); err != nil {
			return DependencySource{}, err
		}
	}
	directory, err := java.DecompiledJarDirectory(langserver.VirtualDocumentsRoot(), path)
	if err != nil {
		return DependencySource{}, err
	}
	if err := s.decompileInto(session, path, directory); err != nil {
		return DependencySource{}, err
	}
	source := DependencySource{ModulePath: filepath.Base(path), Files: []DependencySourceFile{}}
	return describeDependencyDirectory(session.Project, source, directory, "java-decompiled"), nil
}

// decompiledLibrary decompiles a library that publishes no sources, when the decompiler is installed and the
// project trusted; ok is false when it cannot, and the caller keeps its "no sources" answer.
func (s *Service) decompiledLibrary(session Session, groupID, artifactID, version string) (string, bool) {
	directory := java.DecompiledLibraryDirectory(langserver.VirtualDocumentsRoot(), groupID, artifactID, version)
	if java.Decompiled(directory) {
		return directory, true
	}
	if session.Project.Authorization != AuthorizationPermitted || !fileExists(java.DecompilerJar(s.toolsRoot)) {
		return "", false
	}
	environment := s.javaEnvironment(session)
	jar := java.ArtifactPath(mavensecurity.LocalRepository(environment), groupID, artifactID, version, "")
	if !fileExists(jar) {
		jar = java.GradleArtifactPath(java.GradleUserHome(environment), groupID, artifactID, version, "")
	}
	if jar == "" || !fileExists(jar) || s.decompileInto(session, jar, directory) != nil {
		return "", false
	}
	return directory, true
}

// decompileInto runs Vineflower on a JVM it supports (the project JDK when recent enough) and fills the
// cache folder once.
func (s *Service) decompileInto(session Session, jar, directory string) error {
	if java.Decompiled(directory) {
		return nil
	}
	var project java.JDK
	if home := java.ProjectJavaHome(session.Project.RealPath); home != "" {
		project, _ = java.InspectJDK(home, "project")
	}
	jvm, err := java.DecompilerJVM(project, append(java.DiscoverJDKs(), java.DetectJDK()))
	if err != nil {
		return err
	}
	javaBinary := jvm.Binary
	job, err := java.NewDecompileJob(javaBinary, java.DecompilerJar(s.toolsRoot), jar, directory)
	if err != nil {
		return err
	}
	ctx, cancel := context.WithTimeout(context.Background(), javaDecompileTimeout)
	defer cancel()
	command := procutil.CommandContext(ctx, job.Java, job.Arguments()...)
	configureProcess(command, false)
	var log bytes.Buffer
	command.Stdout, command.Stderr = &log, &log
	if err := command.Run(); err != nil {
		_ = job.Abort() // the staging folder of this run
		if ctx.Err() != nil {
			return fmt.Errorf("decompiling %s took longer than %s", filepath.Base(jar), javaDecompileTimeout)
		}
		return fmt.Errorf("the decompiler failed on %s: %s", filepath.Base(jar), lastLines(log.String(), 1500))
	}
	return job.Finish()
}
