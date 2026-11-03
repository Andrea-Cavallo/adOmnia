package eclipsepde

import (
	"os"
	"path/filepath"
	"testing"
)

const appManifest = `Manifest-Version: 1.0
Bundle-ManifestVersion: 2
Bundle-SymbolicName: com.acme.app;singleton:=true
Bundle-Version: 1.0.0.qualifier
Bundle-RequiredExecutionEnvironment: JavaSE-1.6
Require-Bundle: com.acme.core,
 org.eclipse.ui;bundle-version="[3.0.0,4.0.0)",
 system.bundle
Import-Package: javax.swing,
 org.w3c.dom,
 org.xml.sax.helpers,
 javax.servlet;resolution:=optional
`

const coreManifest = `Manifest-Version: 1.0
Bundle-ManifestVersion: 2
Bundle-SymbolicName: com.acme.core
Bundle-Version: 1.2.0
Export-Package: com.acme.core.api;version="1.2.0"
`

const brokenManifest = `Manifest-Version: 1.0
Bundle-ManifestVersion: 2
Bundle-SymbolicName: com.acme.broken
Bundle-Version: 1.0.0
Import-Package: javax.servlet
Require-Bundle: org.eclipse.ui;bundle-version="[4.0.0,5.0.0)"
`

const uiManifest = `Manifest-Version: 1.0
Bundle-ManifestVersion: 2
Bundle-SymbolicName: org.eclipse.ui
Bundle-Version: 3.105.0.v20130522
Import-Package: org.not.installed;resolution:=optional
`

const osgiManifest = `Manifest-Version: 1.0
Bundle-ManifestVersion: 2
Bundle-SymbolicName: org.eclipse.osgi;singleton:=true
Bundle-Version: 3.9.1.v20140110
Export-Package: org.osgi.framework;version="1.7"
`

// legacyWorkspace is a workspace with nested projects and a target directory next to it.
func legacyWorkspace(t *testing.T) (root, target string) {
	t.Helper()
	base := t.TempDir()
	root = filepath.Join(base, "ws")
	target = filepath.Join(base, "kepler", "plugins")
	writeProject(t, filepath.Join(root, "plugins"), "com.acme.app", appManifest, nil)
	writeProject(t, filepath.Join(root, "plugins"), "com.acme.core", coreManifest, nil)
	writeProject(t, filepath.Join(root, "plugins"), "com.acme.broken", brokenManifest, nil)
	writeJar(t, filepath.Join(target, "org.eclipse.ui_3.105.0.v20130522.jar"), uiManifest)
	writeJar(t, filepath.Join(target, "org.eclipse.osgi_3.9.1.v20140110.jar"), osgiManifest)
	return root, target
}

func statusOf(t *testing.T, report *WorkspaceReport, name string) BundleStatus {
	t.Helper()
	for _, bundle := range report.Bundles {
		if bundle.SymbolicName == name {
			return bundle
		}
	}
	t.Fatalf("bundle %s not in report: %+v", name, report.Bundles)
	return BundleStatus{}
}

func TestBuildReportWithoutTargetListsBundles(t *testing.T) {
	root, _ := legacyWorkspace(t)
	report, err := BuildReport(root)
	if err != nil {
		t.Fatal(err)
	}
	if report.HasTarget || len(report.Bundles) != 3 {
		t.Fatalf("report = %+v", report)
	}
	app := statusOf(t, report, "com.acme.app")
	if app.Status != "" || app.ExecutionEnvironment != "JavaSE-1.6" || app.Location != "plugins/com.acme.app" {
		t.Fatalf("app = %+v", app)
	}
}

func TestBuildReportResolvesAgainstTargetAndWorkspace(t *testing.T) {
	root, target := legacyWorkspace(t)
	report, err := SetTarget(root, target)
	if err != nil {
		t.Fatal(err)
	}
	if !report.HasTarget || report.TargetBundles != 2 || report.Unresolved != 1 {
		t.Fatalf("report = %+v", report)
	}
	// Workspace sibling, system.bundle alias and JRE packages must not be reported as missing.
	app := statusOf(t, report, "com.acme.app")
	if app.Status != StatusWarning || len(app.Missing) != 1 || app.Missing[0].Name != "javax.servlet" || !app.Missing[0].Optional {
		t.Fatalf("app = %+v", app)
	}
	// javax.servlet is not part of the JRE, unlike javax.swing; the UI bundle version is too old.
	broken := statusOf(t, report, "com.acme.broken")
	if broken.Status != StatusUnresolved || len(broken.Missing) != 2 {
		t.Fatalf("broken = %+v", broken)
	}
	if statusOf(t, report, "com.acme.core").Status != StatusResolved {
		t.Fatalf("core = %+v", statusOf(t, report, "com.acme.core"))
	}
}

func TestOptionalImportOfADependencyIsNotNoise(t *testing.T) {
	root, target := legacyWorkspace(t)
	writeProject(t, filepath.Join(root, "plugins"), "com.acme.ui", `Manifest-Version: 1.0
Bundle-SymbolicName: com.acme.ui
Bundle-Version: 1.0.0
Require-Bundle: org.eclipse.ui
`, nil)
	report, err := SetTarget(root, target)
	if err != nil {
		t.Fatal(err)
	}
	if got := statusOf(t, report, "com.acme.ui"); got.Status != StatusResolved || len(got.Notes) != 0 {
		t.Fatalf("ui = %+v", got)
	}
}

func TestSetTargetPersistsAcrossReports(t *testing.T) {
	root, target := legacyWorkspace(t)
	if _, err := SetTarget(root, target); err != nil {
		t.Fatal(err)
	}
	report, err := BuildReport(root)
	if err != nil {
		t.Fatal(err)
	}
	if !report.HasTarget || report.TargetPath != target || report.TargetBundles != 2 {
		t.Fatalf("report = %+v", report)
	}
}

func TestSetTargetStoresPathsInsideTheWorkspaceAsRelative(t *testing.T) {
	root, _ := legacyWorkspace(t)
	inside := filepath.Join(root, "target-platform")
	writeJar(t, filepath.Join(inside, "org.eclipse.ui.jar"), uiManifest)
	if _, err := SetTarget(root, inside); err != nil {
		t.Fatal(err)
	}
	settings, err := LoadTargetSettings(root)
	if err != nil {
		t.Fatal(err)
	}
	if len(settings.Profiles) != 1 || settings.Profiles[0].Path != "target-platform" {
		t.Fatalf("settings = %+v", settings)
	}
	report, err := BuildReport(root)
	if err != nil {
		t.Fatal(err)
	}
	if report.TargetBundles != 1 {
		t.Fatalf("report = %+v", report)
	}
}

func TestSetTargetRejectsAMissingPath(t *testing.T) {
	root, _ := legacyWorkspace(t)
	if _, err := SetTarget(root, filepath.Join(root, "nope")); err == nil {
		t.Fatal("expected an error for a missing target")
	}
	if _, err := os.Stat(filepath.Join(root, filepath.FromSlash(TargetSettingsFile))); !os.IsNotExist(err) {
		t.Fatalf("settings must not be written for a rejected target: %v", err)
	}
}

func TestTargetFileIndexesDirectoriesAndReportsP2Units(t *testing.T) {
	root, target := legacyWorkspace(t)
	definition := filepath.Join(root, "kepler.target")
	content := `<?xml version="1.0"?><target name="Kepler" sequenceNumber="1"><locations>
<location path="` + filepath.ToSlash(target) + `" type="Directory"/>
<location type="InstallableUnit"><unit id="org.eclipse.rcp.feature.group" version="4.3.2"/></location>
</locations></target>`
	if err := os.WriteFile(definition, []byte(content), 0o644); err != nil {
		t.Fatal(err)
	}
	report, err := SetTarget(root, definition)
	if err != nil {
		t.Fatal(err)
	}
	if report.TargetBundles != 2 {
		t.Fatalf("report = %+v", report)
	}
	found := false
	for _, problem := range report.Problems {
		if problem.Severity == "warning" && problem.File == "kepler.target" {
			found = true
		}
	}
	if !found {
		t.Fatalf("the p2 unit must be reported as not available: %+v", report.Problems)
	}
}

func TestImportWorkspaceFindsTheOpenedProjectItself(t *testing.T) {
	root, _ := legacyWorkspace(t)
	ws, err := ImportWorkspace(filepath.Join(root, "plugins", "com.acme.core"))
	if err != nil {
		t.Fatal(err)
	}
	if len(ws.Projects) != 1 || ws.Projects[0].Name != "com.acme.core" {
		t.Fatalf("projects = %+v", ws.Projects)
	}
}

func TestImportWorkspaceSkipsBuildOutputAndMetadata(t *testing.T) {
	root, _ := legacyWorkspace(t)
	writeProject(t, filepath.Join(root, "node_modules"), "stray", coreManifest, nil)
	writeProject(t, filepath.Join(root, ".metadata"), "stray2", coreManifest, nil)
	ws, err := ImportWorkspace(root)
	if err != nil {
		t.Fatal(err)
	}
	if len(ws.Projects) != 3 {
		t.Fatalf("projects = %+v", ws.Projects)
	}
}
