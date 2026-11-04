package codestudio

import (
	"context"
	"errors"
	"fmt"
	"sync"
	"time"

	"github.com/Andrea-Cavallo/adOmnia/internal/eclipsepde"
	"github.com/Andrea-Cavallo/adOmnia/internal/ide/run"
	"github.com/Andrea-Cavallo/adOmnia/internal/languages/java"
)

// p2DownloadTimeout bounds a target download: a full Eclipse SDK target is about 300 MB.
const p2DownloadTimeout = 30 * time.Minute

// osgiDownloads holds the cancel function of the running p2 download of each session.
var osgiDownloads sync.Map

// Run kinds of the OSGi commands: StartRun routes them here, so Rerun works from the Run console.
const (
	osgiBuildKind = "osgi-build"
	osgiRunKind   = "osgi-run"
)

// osgiBuilds marks the sessions with a bundle build in progress.
var osgiBuilds sync.Map

// OsgiBuildEvent is the payload of `osgi.build`: progress of a build and, with Finished, its outcome.
type OsgiBuildEvent struct {
	Done     int      `json:"done"`
	Total    int      `json:"total"`
	Bundle   string   `json:"bundle"`
	Finished bool     `json:"finished"`
	Stopped  bool     `json:"stopped"`
	Errors   int      `json:"errors"`
	Problems []string `json:"problems"`
}

// OsgiRunResult is the started framework and what will not resolve in it.
type OsgiRunResult struct {
	Execution Execution `json:"execution"`
	Problems  []string  `json:"problems"`
}

// IsJavaOsgiProject says whether the project holds OSGi bundles: it reads manifests only.
func (s *Service) IsJavaOsgiProject(sessionID string) (bool, error) {
	session, err := s.session(sessionID)
	if err != nil {
		return false, err
	}
	return eclipsepde.HasBundles(session.Project.RealPath), nil
}

// osgiJVM is the JVM chosen for the project: legacy bundles must not silently fall back to the system Java.
func (s *Service) osgiJVM(session Session) (java.JDK, error) {
	home := java.ProjectJavaHome(session.Project.RealPath)
	if home == "" {
		return java.JDK{}, errors.New("choose the JVM of this project first: Java > Select JDK")
	}
	jvm, ok := java.InspectJDK(home, "project")
	if !ok {
		return java.JDK{}, fmt.Errorf("%s has no bin/java: Java > Select JDK", home)
	}
	return jvm, nil
}

// StartJavaOsgiBuild compiles the bundles of the project, dependencies first, with the
// compiler of the target platform on the project JVM. Errors go to Problems, progress to `osgi.build`.
func (s *Service) StartJavaOsgiBuild(sessionID string) (Execution, error) {
	root, err := s.trustedOsgiRoot(sessionID)
	if err != nil {
		return Execution{}, err
	}
	session, err := s.session(sessionID)
	if err != nil {
		return Execution{}, err
	}
	jvm, err := s.osgiJVM(session)
	if err != nil {
		return Execution{}, err
	}
	plan, err := eclipsepde.PlanBuild(root, jvm.Major)
	if err != nil {
		return Execution{}, err
	}
	if len(plan.Steps) == 0 {
		return Execution{}, errors.New("no bundle of this project has source folders to compile")
	}
	if _, running := osgiBuilds.LoadOrStore(session.ID, true); running {
		return Execution{}, errors.New("the bundles of this project are already building")
	}
	execution, err := s.startOsgiStep(session, jvm, plan, 0, nil)
	if err != nil {
		osgiBuilds.Delete(session.ID)
		return Execution{}, err
	}
	s.rememberRunRequest(execution.ID, RunRequest{SessionID: session.ID, Kind: osgiBuildKind})
	return execution, nil
}

// startOsgiStep runs one bundle; the next one starts when it exits. A bundle with errors does
// not stop the chain: the compiler still emits its classes, and every error shows at once.
func (s *Service) startOsgiStep(session Session, jvm java.JDK, plan *eclipsepde.BuildPlan, index int, seed []run.Diagnostic) (Execution, error) {
	step := plan.Steps[index]
	if err := step.Prepare(); err != nil {
		return Execution{}, err
	}
	environment, err := s.executionEnvironment(session.ID, java.ID, nil)
	if err != nil {
		return Execution{}, err
	}
	s.emit("osgi.build", session.ID, string(session.ID), OsgiBuildEvent{Done: index, Total: len(plan.Steps), Bundle: step.Bundle})
	return s.processes.Start(CommandSpec{
		SessionID: session.ID, Kind: osgiBuildKind, Executable: jvm.Binary, Arguments: step.Arguments,
		WorkingDirectory: step.Directory, Environment: environment,
		DisplayCommand: fmt.Sprintf("ecj %s (%d/%d)", step.Bundle, index+1, len(plan.Steps)),
		Diagnostics:    eclipsepde.EcjDiagnostics(), SeedDiagnostics: seed,
		OnExit: func(done Execution) { go s.afterOsgiStep(session, jvm, plan, index, done) },
	})
}

func (s *Service) afterOsgiStep(session Session, jvm java.JDK, plan *eclipsepde.BuildPlan, index int, done Execution) {
	stopped := done.Status == "stopped"
	var failure string
	if !stopped && index+1 < len(plan.Steps) {
		_, err := s.startOsgiStep(session, jvm, plan, index+1, done.Diagnostics)
		if err == nil {
			return
		}
		failure = err.Error()
	}
	osgiBuilds.Delete(session.ID)
	event := OsgiBuildEvent{Done: index + 1, Total: len(plan.Steps), Finished: true, Stopped: stopped, Problems: []string{}}
	for _, diagnostic := range done.Diagnostics {
		if diagnostic.Severity == 1 {
			event.Errors++
		}
	}
	if failure != "" {
		event.Problems = append(event.Problems, failure)
	}
	for _, problem := range plan.Problems {
		if problem.Severity == "error" {
			event.Problems = append(event.Problems, problem.String())
		}
	}
	for _, step := range plan.Steps {
		event.Problems = append(event.Problems, step.BytecodeProblems()...)
	}
	s.emit("osgi.build", session.ID, string(session.ID), event)
}

// StartJavaOsgiRun starts the bundles in Equinox on the project JVM, without Maven or an Eclipse launcher.
func (s *Service) StartJavaOsgiRun(sessionID string) (OsgiRunResult, error) {
	root, err := s.trustedOsgiRoot(sessionID)
	if err != nil {
		return OsgiRunResult{}, err
	}
	session, err := s.session(sessionID)
	if err != nil {
		return OsgiRunResult{}, err
	}
	jvm, err := s.osgiJVM(session)
	if err != nil {
		return OsgiRunResult{}, err
	}
	launch, err := eclipsepde.PrepareLaunch(root, jvm.Major)
	if err != nil {
		return OsgiRunResult{}, err
	}
	environment, err := s.executionEnvironment(session.ID, java.ID, nil)
	if err != nil {
		return OsgiRunResult{}, err
	}
	execution, err := s.processes.Start(CommandSpec{
		SessionID: session.ID, Kind: osgiRunKind, Executable: jvm.Binary, Arguments: launch.Arguments,
		WorkingDirectory: launch.Directory, Environment: environment,
		DisplayCommand: "equinox on Java " + jvm.Version,
	})
	if err != nil {
		return OsgiRunResult{}, err
	}
	s.rememberRunRequest(execution.ID, RunRequest{SessionID: session.ID, Kind: osgiRunKind})
	result := OsgiRunResult{Execution: execution, Problems: []string{}}
	for _, problem := range launch.Problems {
		result.Problems = append(result.Problems, problem.String())
	}
	return result, nil
}

// JavaOsgiWorkspace elenca i bundle OSGi/PDE del progetto e come si risolvono sulla target platform attiva.
func (s *Service) JavaOsgiWorkspace(sessionID string) (*eclipsepde.WorkspaceReport, error) {
	session, err := s.session(sessionID)
	if err != nil {
		return nil, err
	}
	// Il percorso del target arriva da un file del progetto e porta a leggere fuori dal progetto.
	if session.Project.Authorization != AuthorizationPermitted {
		return nil, errors.New("explicitly authorize the tools for this project")
	}
	return eclipsepde.BuildReport(session.Project.RealPath)
}

// trustedOsgiRoot is the root of an authorized project: the target path comes
// from a project file and leads outside the project.
func (s *Service) trustedOsgiRoot(sessionID string) (string, error) {
	session, err := s.session(sessionID)
	if err != nil {
		return "", err
	}
	if session.Project.Authorization != AuthorizationPermitted {
		return "", errors.New("explicitly authorize the tools for this project")
	}
	return session.Project.RealPath, nil
}

// ReindexJavaOsgiTarget forgets the cached index of the target and reads every manifest again.
func (s *Service) ReindexJavaOsgiTarget(sessionID string) (*eclipsepde.WorkspaceReport, error) {
	root, err := s.trustedOsgiRoot(sessionID)
	if err != nil {
		return nil, err
	}
	return eclipsepde.ReindexReport(root)
}

// PreviewJavaOsgiP2 lists the p2 repositories of the active .target, without network access.
func (s *Service) PreviewJavaOsgiP2(sessionID string) (*eclipsepde.P2Preview, error) {
	root, err := s.trustedOsgiRoot(sessionID)
	if err != nil {
		return nil, err
	}
	return eclipsepde.PreviewTargetP2(root)
}

// DownloadJavaOsgiP2 downloads the bundles of the p2 locations of the active .target into
// the machine cache, after explicit confirmation. Progress arrives as `osgi.p2.progress`.
func (s *Service) DownloadJavaOsgiP2(sessionID string, confirmed bool) (*eclipsepde.P2DownloadResult, error) {
	if !confirmed {
		return nil, errors.New("explicit confirmation required before downloading the p2 bundles")
	}
	root, err := s.trustedOsgiRoot(sessionID)
	if err != nil {
		return nil, err
	}
	ctx, cancel := context.WithTimeout(context.Background(), p2DownloadTimeout)
	defer cancel()
	if _, running := osgiDownloads.LoadOrStore(sessionID, cancel); running {
		return nil, errors.New("the p2 bundles of this project are already downloading")
	}
	defer osgiDownloads.Delete(sessionID)
	return eclipsepde.DownloadTargetP2(ctx, root, func(progress eclipsepde.P2Progress) {
		s.emit("osgi.p2.progress", SessionID(sessionID), sessionID, progress)
	})
}

// CancelJavaOsgiP2 stops the running p2 download of the session, if any.
func (s *Service) CancelJavaOsgiP2(sessionID string) {
	if cancel, ok := osgiDownloads.Load(sessionID); ok {
		cancel.(context.CancelFunc)()
	}
}

// SetJavaOsgiTarget sceglie la target platform (cartella di bundle, installazione Eclipse o file .target).
// Il percorso può stare fuori dal progetto: Kepler di solito è installato altrove.
func (s *Service) SetJavaOsgiTarget(sessionID, path string) (*eclipsepde.WorkspaceReport, error) {
	session, err := s.session(sessionID)
	if err != nil {
		return nil, err
	}
	if session.Project.Authorization != AuthorizationPermitted {
		return nil, errors.New("explicitly authorize the tools for this project")
	}
	return eclipsepde.SetTarget(session.Project.RealPath, path)
}
