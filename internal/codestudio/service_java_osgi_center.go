package codestudio

import (
	"errors"
	"path/filepath"
	"sync"

	"github.com/Andrea-Cavallo/adOmnia/internal/eclipsepde"
	"github.com/Andrea-Cavallo/adOmnia/internal/languages/java"
)

// osgiExplorers caches the Plugin Explorer of each session: the search runs on every
// keystroke, so the manifests are read once and re-read only after a target change,
// a reindex, an import or a removal.
var osgiExplorers sync.Map

// JavaOsgiExplorer builds (or returns the cached) OSGi Control Center data: every bundle
// of the workspace and of the target, its activator, start level and state, the summary
// cards and the diagnostics.
func (s *Service) JavaOsgiExplorer(sessionID string) (*eclipsepde.ExplorerReport, error) {
	session, err := s.session(sessionID)
	if err != nil {
		return nil, err
	}
	if session.Project.Authorization != AuthorizationPermitted {
		return nil, errors.New("explicitly authorize the tools for this project")
	}
	return s.osgiExplorerReport(session)
}

// RefreshJavaOsgiExplorer re-reads the manifests, the target index and the diagnostics.
// The panel calls it after an edit, when the cached explorer may be stale.
func (s *Service) RefreshJavaOsgiExplorer(sessionID string) (*eclipsepde.ExplorerReport, error) {
	session, err := s.session(sessionID)
	if err != nil {
		return nil, err
	}
	if session.Project.Authorization != AuthorizationPermitted {
		return nil, errors.New("explicitly authorize the tools for this project")
	}
	s.invalidateOsgiExplorer(session.ID)
	return s.osgiExplorerReport(session)
}

// osgiExplorerReport returns the cached explorer or builds it from the project files.
func (s *Service) osgiExplorerReport(session Session) (*eclipsepde.ExplorerReport, error) {
	if cached, ok := osgiExplorers.Load(session.ID); ok {
		if report, valid := cached.(*eclipsepde.ExplorerReport); valid {
			return report, nil
		}
	}
	report, err := eclipsepde.BuildExplorer(session.Project.RealPath, osgiProjectJVMMajor(session))
	if err != nil {
		return nil, err
	}
	osgiExplorers.Store(session.ID, report)
	return report, nil
}

// invalidateOsgiExplorer drops the cached explorer of a session after a change to the
// project or to the target.
func (s *Service) invalidateOsgiExplorer(sessionID SessionID) {
	osgiExplorers.Delete(sessionID)
}

// osgiProjectJVMMajor is the major version of the JVM chosen for the project, or 0 when
// it has not been chosen: it decides whether a Bundle-RequiredExecutionEnvironment is
// satisfied.
func osgiProjectJVMMajor(session Session) int {
	home := java.ProjectJavaHome(session.Project.RealPath)
	if home == "" {
		return 0
	}
	jdk, ok := java.InspectJDK(home, "project")
	if !ok {
		return 0
	}
	return jdk.Major
}

// JavaOsgiSearch is the instant search of the explorer: symbolic name, activator, exported
// and imported packages, vendor and manifest text.
func (s *Service) JavaOsgiSearch(sessionID, query string, limit int) ([]eclipsepde.SearchHit, error) {
	report, err := s.JavaOsgiExplorer(sessionID)
	if err != nil {
		return nil, err
	}
	if limit <= 0 || limit > 200 {
		limit = 60
	}
	return report.Search(query, limit), nil
}

// JavaOsgiBundleDetail is the right-hand panel of the Control Center: state, wiring,
// diagnostics, activator, services, impact and the focused graph of one bundle.
func (s *Service) JavaOsgiBundleDetail(sessionID, name string, depth int) (*eclipsepde.BundleDetail, error) {
	report, err := s.JavaOsgiExplorer(sessionID)
	if err != nil {
		return nil, err
	}
	return report.Detail(name, depth)
}

// JavaOsgiImpact is the Dependency Impact Analyzer: who depends on this bundle, directly
// and transitively, which services it provides and what to check before a change.
func (s *Service) JavaOsgiImpact(sessionID, name string) (*eclipsepde.Impact, error) {
	report, err := s.JavaOsgiExplorer(sessionID)
	if err != nil {
		return nil, err
	}
	return report.AnalyzeImpact(name)
}

// JavaOsgiImpactForClass resolves a class or interface of the workspace to its bundle and
// returns the impact of changing it.
func (s *Service) JavaOsgiImpactForClass(sessionID, class string) (*eclipsepde.Impact, error) {
	report, err := s.JavaOsgiExplorer(sessionID)
	if err != nil {
		return nil, err
	}
	return report.AnalyzeImpactForClass(class)
}

// JavaOsgiFocusedGraph returns the subgraph around one bundle: dependencies and consumers,
// limited to depth (1 or 2), with the unresolved edges kept visible.
func (s *Service) JavaOsgiFocusedGraph(sessionID, name string, depth int) (*eclipsepde.FocusGraph, error) {
	report, err := s.JavaOsgiExplorer(sessionID)
	if err != nil {
		return nil, err
	}
	return report.FocusGraph(name, depth)
}

// CompareJavaOsgiTarget diffs the active target platform against another one: added,
// removed and version-changed bundles, which is what a migration review needs.
func (s *Service) CompareJavaOsgiTarget(sessionID, path string) (*eclipsepde.TargetComparison, error) {
	root, err := s.trustedOsgiRoot(sessionID)
	if err != nil {
		return nil, err
	}
	settings, err := eclipsepde.LoadTargetSettings(root)
	if err != nil {
		return nil, err
	}
	if settings.Active == "" {
		return nil, errors.New("choose a target platform first: Java › OSGi Control Center › Target")
	}
	left := ""
	for _, profile := range settings.Profiles {
		if profile.Name == settings.Active {
			left = profile.Path
		}
	}
	if left == "" {
		return nil, errors.New("the active target platform has no path")
	}
	if !filepath.IsAbs(left) {
		left = filepath.Join(root, filepath.FromSlash(left))
	}
	comparison, err := eclipsepde.CompareTargets(left, path)
	if err != nil {
		return nil, err
	}
	return comparison, nil
}

// ImportJavaOsgiJars adds loose JARs to the active target folder after an explicit
// confirmation. Each JAR must be a real OSGi bundle.
func (s *Service) ImportJavaOsgiJars(sessionID string, files []string, confirmed bool) (eclipsepde.LooseJarResult, error) {
	if !confirmed {
		return eclipsepde.LooseJarResult{}, errors.New("explicit confirmation required before copying JARs into the target platform")
	}
	root, err := s.trustedOsgiRoot(sessionID)
	if err != nil {
		return eclipsepde.LooseJarResult{}, err
	}
	result, err := eclipsepde.ImportLooseJars(root, files)
	if err != nil {
		return eclipsepde.LooseJarResult{}, err
	}
	session, err := s.session(sessionID)
	if err == nil {
		s.invalidateOsgiExplorer(session.ID)
	}
	return *result, nil
}
