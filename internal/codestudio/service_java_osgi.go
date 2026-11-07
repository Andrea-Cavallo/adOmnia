package codestudio

import (
	"context"
	"errors"
	"fmt"
	"path"
	"path/filepath"
	"strings"
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

// osgiImports holds the cancel function of the running plug-in import of each session.
var osgiImports sync.Map

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
		if len(plan.Skipped) > 0 {
			return Execution{}, fmt.Errorf("no bundle can compile. %s", firstOsgiError(plan))
		}
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

// firstOsgiError is the most useful reason to show first: the dependency that is really missing.
func firstOsgiError(plan *eclipsepde.BuildPlan) string {
	for _, problem := range plan.Problems {
		if problem.Severity == "error" {
			return problem.String()
		}
	}
	return plan.Skipped[0].String()
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
	for _, skipped := range plan.Skipped {
		event.Problems = append(event.Problems, skipped.String())
	}
	for _, step := range plan.Steps {
		event.Problems = append(event.Problems, step.BytecodeProblems()...)
	}
	s.emit("osgi.build", session.ID, string(session.ID), event)
}

// StartJavaOsgiRun starts the bundles in Equinox on the project JVM, without Maven or an Eclipse launcher.
func (s *Service) StartJavaOsgiRun(sessionID string) (OsgiRunResult, error) {
	_, result, err := s.startOsgiFramework(sessionID, 0, "")
	return result, err
}

// ListJavaOsgiApps lists the `.product` and PDE `.launch` files that start an Eclipse application.
func (s *Service) ListJavaOsgiApps(sessionID string) ([]eclipsepde.AppLaunch, error) {
	root, err := s.trustedOsgiRoot(sessionID)
	if err != nil {
		return nil, err
	}
	return eclipsepde.ListAppLaunches(root)
}

// StartJavaOsgiApp starts the Eclipse application of a `.product` or `.launch` (relative to the project).
func (s *Service) StartJavaOsgiApp(sessionID, file string) (OsgiRunResult, error) {
	if strings.TrimSpace(file) == "" {
		return OsgiRunResult{}, errors.New("choose a .product or .launch file")
	}
	_, result, err := s.startOsgiFramework(sessionID, 0, file)
	return result, err
}

// StartJavaOsgiDebug starts the bundles in Equinox waiting on a JDWP port and attaches the Java
// debugger: breakpoints in the bundles' sources work because JDT LS sees them through the shadow
// workspace. If the attach fails the JVM is stopped, otherwise it would wait for a debugger forever.
// file is a `.product`/`.launch` to debug that application, "" for the bundles in the framework.
func (s *Service) StartJavaOsgiDebug(sessionID, file string) (DebugSessionInfo, error) {
	session, err := s.session(sessionID)
	if err != nil {
		return DebugSessionInfo{}, err
	}
	if status := s.lsp.Status(session.ID, java.ID); status.State != LanguageServerReady {
		if _, err := s.StartProvidedLanguageServer(sessionID, java.ID); err != nil {
			return DebugSessionInfo{}, fmt.Errorf("the Java language server is needed to debug the bundles: %w", err)
		}
	}
	port, err := freeLocalPort()
	if err != nil {
		return DebugSessionInfo{}, err
	}
	session, result, err := s.startOsgiFramework(sessionID, port, file)
	if err != nil {
		return DebugSessionInfo{}, err
	}
	ctx, cancel := context.WithTimeout(context.Background(), javaDebugResolveTimeout)
	defer cancel()
	address, err := s.startJavaDebugServer(ctx, session)
	if err == nil {
		var info DebugSessionInfo
		if info, err = s.openJavaDebugAdapter(session, java.DebugOptions{Address: address, AttachHost: "127.0.0.1", AttachPort: port}, session.Project.RealPath); err == nil {
			return info, nil
		}
	}
	_ = s.processes.Stop(result.Execution.ID) // best effort: the JVM is suspended waiting for us
	return DebugSessionInfo{}, err
}

// OsgiExportResult is an export, plus the p2 publisher run when a repository was asked for.
type OsgiExportResult struct {
	Export  *eclipsepde.ExportResult `json:"export"`
	Publish *Execution               `json:"publish,omitempty"`
}

// ExportJavaOsgiBundles writes the compiled bundles and the features as jars into dest; with publish
// the target's p2 publisher then turns the folder into a p2 repository, in the Run console.
func (s *Service) ExportJavaOsgiBundles(sessionID, dest string, publish bool) (OsgiExportResult, error) {
	root, err := s.trustedOsgiRoot(sessionID)
	if err != nil {
		return OsgiExportResult{}, err
	}
	dest = strings.TrimSpace(dest)
	if dest == "" || !filepath.IsAbs(dest) {
		return OsgiExportResult{}, errors.New("choose an export folder")
	}
	exported, err := eclipsepde.ExportBundles(root, dest, time.Now())
	if err != nil {
		return OsgiExportResult{}, err
	}
	result := OsgiExportResult{Export: exported}
	if !publish {
		return result, nil
	}
	session, err := s.session(sessionID)
	if err != nil {
		return result, err
	}
	jvm, err := s.osgiJVM(session)
	if err != nil {
		return result, err
	}
	launch, err := eclipsepde.PublishP2(root, dest)
	if err != nil {
		return result, err
	}
	environment, err := s.executionEnvironment(session.ID, java.ID, nil)
	if err != nil {
		return result, err
	}
	execution, err := s.processes.Start(CommandSpec{
		SessionID: session.ID, Kind: osgiRunKind, Executable: jvm.Binary, Arguments: launch.Arguments,
		WorkingDirectory: launch.Directory, Environment: environment, DisplayCommand: "p2 publisher on Java " + jvm.Version,
	})
	if err != nil {
		return result, err
	}
	result.Publish = &execution
	return result, nil
}

// startOsgiFramework launches Equinox in the Run console: the workspace bundles, or the application
// of appFile (a .product/.launch). A debugPort above zero opens JDWP on it.
func (s *Service) startOsgiFramework(sessionID string, debugPort int, appFile string) (Session, OsgiRunResult, error) {
	root, err := s.trustedOsgiRoot(sessionID)
	if err != nil {
		return Session{}, OsgiRunResult{}, err
	}
	session, err := s.session(sessionID)
	if err != nil {
		return Session{}, OsgiRunResult{}, err
	}
	jvm, err := s.osgiJVM(session)
	if err != nil {
		return Session{}, OsgiRunResult{}, err
	}
	target := eclipsepde.LaunchJVM{Major: jvm.Major, Arch: jvm.Arch}
	var launch *eclipsepde.Launch
	display := "equinox on Java " + jvm.Version
	if appFile == "" {
		launch, err = eclipsepde.PrepareLaunch(root, target)
	} else {
		launch, err = eclipsepde.PrepareAppLaunch(root, target, filepath.ToSlash(appFile))
		display = path.Base(filepath.ToSlash(appFile)) + " on Java " + jvm.Version
	}
	if err != nil {
		return Session{}, OsgiRunResult{}, err
	}
	if debugPort > 0 {
		launch.WithDebugger(debugPort)
		display += " (debug)"
	}
	environment, err := s.executionEnvironment(session.ID, java.ID, nil)
	if err != nil {
		return Session{}, OsgiRunResult{}, err
	}
	execution, err := s.processes.Start(CommandSpec{
		SessionID: session.ID, Kind: osgiRunKind, Executable: jvm.Binary, Arguments: launch.Arguments,
		WorkingDirectory: launch.Directory, Environment: environment, DisplayCommand: display,
	})
	if err != nil {
		return Session{}, OsgiRunResult{}, err
	}
	s.rememberRunRequest(execution.ID, RunRequest{SessionID: session.ID, Kind: osgiRunKind})
	result := OsgiRunResult{Execution: execution, Problems: []string{}}
	for _, problem := range launch.Problems {
		result.Problems = append(result.Problems, problem.String())
	}
	return session, result, nil
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
	s.invalidateOsgiExplorer(SessionID(sessionID))
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
	s.invalidateOsgiExplorer(session.ID)
	return eclipsepde.SetTarget(session.Project.RealPath, path)
}

// OsgiImportResult is one import: what was copied, what was left out and the report of the merged
// workspace, so the panel shows the new bundles without a second round trip.
type OsgiImportResult struct {
	Imported []string                    `json:"imported"`
	Skipped  []string                    `json:"skipped"`
	Report   *eclipsepde.WorkspaceReport `json:"report,omitempty"`
}

// ImportJavaOsgiPlugins copies Eclipse plug-in projects chosen on the machine into plugins/ of the
// workspace. It is the fast path for a PDE workspace made of several repositories: the bundles land
// in the project root, so they compile against each other instead of against the target alone.
// Progress arrives as `osgi.import.progress`; a cancelled import keeps nothing it had not finished.
func (s *Service) ImportJavaOsgiPlugins(sessionID string, sources []string) (OsgiImportResult, error) {
	root, err := s.trustedOsgiRoot(sessionID)
	if err != nil {
		return OsgiImportResult{}, err
	}
	if len(sources) == 0 {
		return OsgiImportResult{}, errors.New("choose at least one plug-in folder")
	}
	ctx, cancel := context.WithCancel(context.Background())
	if _, running := osgiImports.LoadOrStore(sessionID, cancel); running {
		cancel()
		return OsgiImportResult{}, errors.New("an import of this project is already running")
	}
	defer func() {
		osgiImports.Delete(sessionID)
		cancel()
	}()
	copied, err := eclipsepde.ImportPlugins(ctx, root, sources, func(progress eclipsepde.ImportProgress) {
		s.emit("osgi.import.progress", SessionID(sessionID), sessionID, progress)
	})
	result := OsgiImportResult{Imported: copied.Imported, Skipped: copied.Skipped}
	if err != nil {
		return result, err
	}
	if len(copied.Imported) == 0 {
		// Nothing changed: no report to read, and the reasons are already in Skipped.
		return result, nil
	}
	s.invalidateOsgiExplorer(SessionID(sessionID))
	report, err := eclipsepde.BuildReport(root)
	if err != nil {
		return result, nil // the copy is done: the panel reports the read error on reload
	}
	result.Report = report
	return result, nil
}

// CancelJavaOsgiImport stops the running import of the session, removing what it had copied.
func (s *Service) CancelJavaOsgiImport(sessionID string) {
	if cancel, ok := osgiImports.Load(sessionID); ok {
		cancel.(context.CancelFunc)()
	}
}

// RemoveJavaOsgiPlugin deletes a bundle that was imported into plugins/ of the workspace and returns
// the report of the remaining bundles. Nothing outside that folder can be removed from here.
func (s *Service) RemoveJavaOsgiPlugin(sessionID, name string) (*eclipsepde.WorkspaceReport, error) {
	root, err := s.trustedOsgiRoot(sessionID)
	if err != nil {
		return nil, err
	}
	if err := eclipsepde.RemoveImportedPlugin(root, name); err != nil {
		return nil, err
	}
	s.invalidateOsgiExplorer(SessionID(sessionID))
	return eclipsepde.BuildReport(root)
}

// OsgiTychoResult is the target platform a pom.xml implies: its p2 repositories, the units the
// workspace still needs, and, once written, the definition adOmnia downloads from.
type OsgiTychoResult struct {
	Repositories []eclipsepde.TychoRepository `json:"repositories"`
	Units        []string                     `json:"units"`
	TargetPath   string                       `json:"targetPath,omitempty"`
	Problems     []string                     `json:"problems,omitempty"`
	Report       *eclipsepde.WorkspaceReport  `json:"report,omitempty"`
}

// JavaOsgiTychoTarget reads the target platform a Tycho build declares in its pom.xml. Tycho
// resolves the repositories against the requirements of the bundles, so the generated definition
// seeds those units and lets the existing p2 download fetch only the closure: no full Eclipse
// release is downloaded. With create it writes .adomnia/tycho.target and makes it active.
func (s *Service) JavaOsgiTychoTarget(sessionID string, create bool) (OsgiTychoResult, error) {
	root, err := s.trustedOsgiRoot(sessionID)
	if err != nil {
		return OsgiTychoResult{}, err
	}
	target, err := eclipsepde.ReadTychoTarget(root)
	if err != nil {
		return OsgiTychoResult{}, err
	}
	result := OsgiTychoResult{
		Repositories: target.Repositories,
		Units:        eclipsepde.RequiredUnits(root),
		Problems:     target.Unresolved,
	}
	if !create {
		return result, nil
	}
	path, err := eclipsepde.WriteTychoTarget(root, target, result.Units)
	if err != nil {
		return result, err
	}
	result.TargetPath = path
	s.invalidateOsgiExplorer(SessionID(sessionID))
	report, err := eclipsepde.SetTarget(root, path)
	if err != nil {
		return result, err
	}
	result.Report = report
	return result, nil
}
