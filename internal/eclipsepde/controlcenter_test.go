package eclipsepde

import (
	"os"
	"path/filepath"
	"strings"
	"testing"
)

const coreControlManifest = `Manifest-Version: 1.0
Bundle-ManifestVersion: 2
Bundle-SymbolicName: com.acme.core
Bundle-Version: 1.2.0
Bundle-Activator: com.acme.core.Activator
Export-Package: com.acme.core.api;version="1.2.0"
Service-Component: OSGI-INF/core.xml
`

const coreActivatorSource = `package com.acme.core;

import org.osgi.framework.BundleActivator;
import org.osgi.framework.BundleContext;

public class Activator implements BundleActivator {
	public void start(BundleContext context) throws Exception {
		System.out.println("start");
	}

	public void stop(BundleContext context) throws Exception {
	}
}
`

const coreComponent = `<?xml version="1.0" encoding="UTF-8"?>
<scr:component xmlns:scr="http://www.osgi.org/xmlns/scr/v1.1.0" name="com.acme.core.service">
	<implementation class="com.acme.core.ServiceImpl"/>
	<service>
		<provide interface="com.acme.core.api.Service"/>
	</service>
</scr:component>
`

const coreConsumerComponent = `<?xml version="1.0" encoding="UTF-8"?>
<scr:component xmlns:scr="http://www.osgi.org/xmlns/scr/v1.1.0" name="com.acme.ui.consumer">
	<implementation class="com.acme.ui.Consumer"/>
	<reference interface="com.acme.core.api.Service"/>
</scr:component>
`

const uiControlManifest = `Manifest-Version: 1.0
Bundle-ManifestVersion: 2
Bundle-SymbolicName: com.acme.ui
Bundle-Version: 1.0.0
Bundle-ActivationPolicy: lazy
Bundle-Activator: com.acme.ui.Activator
Require-Bundle: com.acme.core;bundle-version="[1.0.0,2.0.0)"
Import-Package: com.acme.core.api;version="[1.0.0,2.0.0)"
Service-Component: OSGI-INF/ui.xml
`

const appControlManifest = `Manifest-Version: 1.0
Bundle-ManifestVersion: 2
Bundle-SymbolicName: com.acme.app
Bundle-Version: 1.0.0
Bundle-RequiredExecutionEnvironment: JavaSE-1.8
Require-Bundle: com.acme.ui
Eclipse-PlatformFilter: (&(osgi.os=linux))
`

const brokenControlManifest = `Manifest-Version: 1.0
Bundle-ManifestVersion: 2
Bundle-SymbolicName: com.acme.broken
Bundle-Version: 1.0.0
Require-Bundle: com.acme.core;bundle-version="[2.0.0,3.0.0)"
Import-Package: com.acme.missing
`

const legacyLazyManifest = `Manifest-Version: 1.0
Bundle-ManifestVersion: 2
Bundle-SymbolicName: com.acme.legacy
Bundle-Version: 1.0.0
Eclipse-LazyStart: true
`

const testsFragmentManifest = `Manifest-Version: 1.0
Bundle-ManifestVersion: 2
Bundle-SymbolicName: com.acme.core.tests
Bundle-Version: 1.0.0
Fragment-Host: com.acme.core
Require-Bundle: org.junit
`

const otherTargetManifest = `Manifest-Version: 1.0
Bundle-ManifestVersion: 2
Bundle-SymbolicName: com.acme.other;singleton:=true
Bundle-Version: 2.0.0
Export-Package: com.acme.other.api;version="2.0.0"
`

// controlCenterWorkspace is a legacy PDE workspace with one target platform: a bundle
// that exports a package and a DS service, a lazy consumer, a broken bundle, a platform
// filtered app and a test fragment.
func controlCenterWorkspace(t *testing.T) (root, target string) {
	t.Helper()
	base := t.TempDir()
	root = filepath.Join(base, "ws")
	target = filepath.Join(base, "target")
	writeProject(t, root, "com.acme.core", coreControlManifest, map[string]string{
		"src/com/acme/core/Activator.java": coreActivatorSource,
		"OSGI-INF/core.xml":                coreComponent,
	})
	writeProject(t, root, "com.acme.ui", uiControlManifest, map[string]string{
		"src/com/acme/ui/Activator.java": "package com.acme.ui;\n\npublic class Activator {\n\tpublic void start(org.osgi.framework.BundleContext context) {}\n}\n",
		"OSGI-INF/ui.xml":                coreConsumerComponent,
	})
	writeProject(t, root, "com.acme.app", appControlManifest, nil)
	writeProject(t, root, "com.acme.broken", brokenControlManifest, nil)
	writeProject(t, root, "com.acme.legacy", legacyLazyManifest, nil)
	writeProject(t, root, "com.acme.core.tests", testsFragmentManifest, nil)
	writeJar(t, filepath.Join(target, "com.acme.other_2.0.0.jar"), otherTargetManifest)
	writeJar(t, filepath.Join(target, "com.acme.other_1.0.0.jar"), strings.ReplaceAll(otherTargetManifest, "2.0.0", "1.0.0"))
	if _, err := SetTarget(root, target); err != nil {
		t.Fatal(err)
	}
	return root, target
}

func TestActivatorsIncludePolicyAndSourceLines(t *testing.T) {
	root, _ := controlCenterWorkspace(t)
	ws, err := ImportWorkspace(root)
	if err != nil {
		t.Fatal(err)
	}
	activators := Activators(ws)
	if len(activators) != 2 {
		t.Fatalf("activators = %+v", activators)
	}
	byName := map[string]ActivatorInfo{}
	for _, activator := range activators {
		byName[activator.Bundle] = activator
	}
	core := byName["com.acme.core"]
	if core.Class != "com.acme.core.Activator" || !core.FileExists {
		t.Fatalf("core activator = %+v", core)
	}
	if core.StartLine != 7 || core.StopLine != 11 {
		t.Fatalf("start/stop lines = %d/%d, want 7/11", core.StartLine, core.StopLine)
	}
	if core.Policy != "eager" || core.Lazy {
		t.Fatalf("core policy = %q lazy=%v", core.Policy, core.Lazy)
	}
	ui := byName["com.acme.ui"]
	if !ui.Lazy || ui.Policy != "lazy" || ui.StartLine != 4 {
		t.Fatalf("ui activator = %+v", ui)
	}
	if strings.Contains(ui.File, "\\") && !strings.HasPrefix(ui.File, root) {
		t.Fatalf("ui file is not relative to the project: %q", ui.File)
	}
}

func TestActivationPolicyLegacyHeader(t *testing.T) {
	root := t.TempDir()
	writeProject(t, root, "com.acme.legacy", legacyLazyManifest, nil)
	ws, err := ImportWorkspace(root)
	if err != nil {
		t.Fatal(err)
	}
	bundle := ws.ProjectByName("com.acme.legacy").Bundle
	if !bundle.LazyActivation || bundle.ActivationPolicy != "lazy" {
		t.Fatalf("legacy lazy activation not read: %+v", bundle)
	}
	if bundle.ActivationOnStart() {
		t.Fatal("a lazy bundle must not activate on start")
	}
}

func TestStartLevelPlanReadsGeneratedConfig(t *testing.T) {
	root := t.TempDir()
	config := `osgi.bundles=reference:file\:C\:/ws/plugins/com.acme.core@2\:start,reference:file\:C\:/ws/plugins/com.acme.ui@1\:start,reference:file\:C\:/ws/plugins/com.acme.lazy
osgi.bundles.defaultStartLevel=4
`
	path := filepath.Join(root, filepath.FromSlash(startLevelConfigFile))
	if err := os.MkdirAll(filepath.Dir(path), 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(path, []byte(config), 0o644); err != nil {
		t.Fatal(err)
	}
	plan := ReadStartLevelPlan(root)
	if !plan.Configured || plan.Default != 4 || len(plan.Entries) != 3 {
		t.Fatalf("plan = %+v", plan)
	}
	if level, start, found := plan.LevelFor("C:/ws/plugins/com.acme.core"); !found || level != 2 || !start {
		t.Fatalf("core entry = %d %v %v", level, start, found)
	}
	// No instruction after '@' means installed, not started, at the default level.
	if level, start, found := plan.LevelFor("C:/ws/plugins/com.acme.lazy"); !found || start || level != 4 {
		t.Fatalf("lazy entry = %d %v %v", level, start, found)
	}
	if _, _, found := plan.LevelFor("C:/ws/plugins/com.acme.none"); found {
		t.Fatal("an unlisted bundle must not match")
	}
}

func TestDiagnoseExplainsWhyABundleDoesNotStart(t *testing.T) {
	root, _ := controlCenterWorkspace(t)
	report, err := BuildExplorer(root, 6)
	if err != nil {
		t.Fatal(err)
	}
	byKind := map[string]Diagnostic{}
	for _, diagnostic := range report.Diagnostics {
		byKind[diagnostic.Kind] = diagnostic
	}
	conflict, ok := byKind["version-conflict"]
	if !ok {
		t.Fatalf("no version conflict diagnosed: %+v", report.Diagnostics)
	}
	if conflict.Bundle != "com.acme.broken" || !strings.Contains(conflict.Cause, "[2.0.0,3.0.0)") {
		t.Fatalf("conflict = %+v", conflict)
	}
	if _, ok := byKind["missing-requirement"]; !ok {
		t.Fatalf("the missing package was not diagnosed: %+v", report.Diagnostics)
	}
	if bree, ok := byKind["bree"]; !ok || bree.Severity != "error" || !strings.Contains(bree.Title, "Java 8") {
		t.Fatalf("bree = %+v", byKind["bree"])
	}
	if platform, ok := byKind["platform-filter"]; !ok || platform.Bundle != "com.acme.app" {
		t.Fatalf("platform filter = %+v", byKind["platform-filter"])
	}
	if lazy, ok := byKind["resolved-lazy"]; !ok || lazy.Severity != "info" || lazy.Bundle != "com.acme.ui" {
		t.Fatalf("lazy bundle must be explained, not warned: %+v", byKind["resolved-lazy"])
	}
	if _, ok := byKind["resolved-lazy"]; ok {
		if byKind["resolved-lazy"].Severity != "info" {
			t.Fatal("lazy activation must never be a warning")
		}
	}
	for _, diagnostic := range report.Diagnostics {
		if diagnostic.Kind == "singleton-duplicate" && diagnostic.Bundle == "com.acme.other" {
			if len(diagnostic.Available) != 2 {
				t.Fatalf("singleton diagnostic = %+v", diagnostic)
			}
			return
		}
	}
	t.Fatalf("singleton at two versions not diagnosed: %+v", report.Diagnostics)
}

func TestExplorerRowsSummaryAndSearch(t *testing.T) {
	root, _ := controlCenterWorkspace(t)
	report, err := BuildExplorer(root, 6)
	if err != nil {
		t.Fatal(err)
	}
	if report.Summary.Bundles != 6 {
		t.Fatalf("summary = %+v, rows = %d", report.Summary, len(report.Bundles))
	}
	// With a Java 6 project JVM com.acme.app (JavaSE-1.8) does not resolve either, and
	// the test fragment needs org.junit, which this target does not have.
	if report.Summary.Resolved != 3 {
		t.Fatalf("resolved = %d, want 3", report.Summary.Resolved)
	}
	if report.Summary.Lazy != 2 {
		t.Fatalf("lazy = %d, want 2 (com.acme.ui and the Eclipse-LazyStart bundle)", report.Summary.Lazy)
	}
	if report.Summary.Fragments != 1 {
		t.Fatalf("fragments = %d, want 1", report.Summary.Fragments)
	}
	if report.Summary.Issues < 2 {
		t.Fatalf("issues = %d", report.Summary.Issues)
	}
	var broken BundleRow
	for _, row := range report.Bundles {
		if row.SymbolicName == "com.acme.broken" {
			broken = row
		}
	}
	if broken.State != "INSTALLED" || len(broken.Missing) == 0 {
		t.Fatalf("broken row = %+v", broken)
	}

	for _, query := range []struct {
		text, field, name string
	}{
		{"com.acme.core", "name", "com.acme.core"},
		{"com.acme.core.api", "exported package", "com.acme.core"},
		{"com.acme.core.Activator", "activator", "com.acme.core"},
		{"Bundle-ActivationPolicy", "manifest", "com.acme.ui"},
	} {
		hits := report.Search(query.text, 5)
		if len(hits) == 0 {
			t.Fatalf("no hit for %q", query.text)
		}
		found := false
		for _, hit := range hits {
			if hit.SymbolicName == query.name && hit.Field == query.field {
				found = true
			}
		}
		if !found {
			t.Fatalf("search %q = %+v, want %s in field %s", query.text, hits, query.name, query.field)
		}
	}
	if hits := report.Search("no-such-thing", 5); len(hits) != 0 {
		t.Fatalf("unexpected hits: %+v", hits)
	}
}

func TestImpactAnalyzerFindsConsumersTestsAndServices(t *testing.T) {
	root, _ := controlCenterWorkspace(t)
	report, err := BuildExplorer(root, 6)
	if err != nil {
		t.Fatal(err)
	}
	impact, err := report.AnalyzeImpact("com.acme.core")
	if err != nil {
		t.Fatal(err)
	}
	direct := map[string]Consumer{}
	for _, consumer := range impact.DirectConsumers {
		direct[consumer.SymbolicName] = consumer
	}
	if _, ok := direct["com.acme.ui"]; !ok {
		t.Fatalf("com.acme.ui is not a direct consumer: %+v", impact.DirectConsumers)
	}
	if _, ok := direct["com.acme.broken"]; !ok {
		t.Fatalf("com.acme.broken requires core and must be listed: %+v", impact.DirectConsumers)
	}
	if _, ok := direct["com.acme.core.tests"]; !ok {
		t.Fatalf("the test fragment is not a consumer: %+v", impact.DirectConsumers)
	}
	if len(impact.Tests) == 0 || impact.Tests[0].SymbolicName != "com.acme.core.tests" {
		t.Fatalf("tests = %+v", impact.Tests)
	}
	if len(impact.ProvidedServices) != 1 || impact.ProvidedServices[0] != "com.acme.core.api.Service" {
		t.Fatalf("provided services = %+v", impact.ProvidedServices)
	}
	if ui := direct["com.acme.ui"]; len(ui.Services) != 1 || ui.Services[0] != "com.acme.core.api.Service" {
		t.Fatalf("the DS consumer of the service is not correlated: %+v", ui)
	}
	if len(impact.Checks) == 0 {
		t.Fatal("no checks suggested")
	}
	if impact.TotalConsumers == 0 {
		t.Fatal("total consumers must include direct and transitive")
	}

	classImpact, err := report.AnalyzeImpactForClass("com.acme.core.Activator")
	if err != nil {
		t.Fatal(err)
	}
	if classImpact.MatchedClass != "com.acme.core.Activator" || classImpact.SymbolicName != "com.acme.core" {
		t.Fatalf("class impact = %+v", classImpact)
	}
	if _, err := report.AnalyzeImpactForClass("com.acme.none.Missing"); err == nil {
		t.Fatal("a class outside the workspace must not resolve")
	}
}

func TestFocusGraphHasDependenciesConsumersAndMissingEdges(t *testing.T) {
	root, _ := controlCenterWorkspace(t)
	report, err := BuildExplorer(root, 6)
	if err != nil {
		t.Fatal(err)
	}
	// com.acme.ui depends on com.acme.core and is required by com.acme.app: the graph
	// around it has both directions.
	graph, err := report.FocusGraph("com.acme.ui", 1)
	if err != nil {
		t.Fatal(err)
	}
	directions := map[string]int{}
	for _, node := range graph.Nodes {
		directions[node.Direction]++
	}
	if directions["root"] != 1 || directions["dependency"] == 0 || directions["consumer"] == 0 {
		t.Fatalf("graph directions = %+v, nodes = %+v", directions, graph.Nodes)
	}

	// A bundle whose requirements cannot be satisfied keeps the dangling edges visible.
	broken, err := report.FocusGraph("com.acme.broken", 1)
	if err != nil {
		t.Fatal(err)
	}
	if broken.Missing == 0 {
		t.Fatalf("the missing edges must be flagged: %+v", broken.Edges)
	}
	foundCore := false
	for _, edge := range broken.Edges {
		if edge.Direction == "dependency" && strings.HasPrefix(edge.To, "com.acme.core") && !edge.Satisfied {
			foundCore = true
		}
	}
	if !foundCore {
		t.Fatalf("the unsatisfied range to com.acme.core is not marked: %+v", broken.Edges)
	}
	if _, err := report.FocusGraph("com.acme.none", 1); err == nil {
		t.Fatal("an unknown bundle must not build a graph")
	}
}

func TestExplorerWithoutTargetDoesNotClaimBundlesResolve(t *testing.T) {
	root := t.TempDir()
	writeProject(t, root, "com.acme.core", coreControlManifest, nil)
	report, err := BuildExplorer(root, 0)
	if err != nil {
		t.Fatal(err)
	}
	if report.HasTarget || report.Summary.Resolved != 0 || report.Summary.Bundles != 1 {
		t.Fatalf("report = %+v", report.Summary)
	}
	if report.Bundles[0].State != "" || report.Bundles[0].Status != "" {
		t.Fatalf("a bundle without a target must not look resolved: %+v", report.Bundles[0])
	}
	if len(report.Diagnostics) != 0 {
		t.Fatalf("no target, no resolution diagnostics: %+v", report.Diagnostics)
	}
}

func TestCompareTargetsReportsAddedRemovedAndChanged(t *testing.T) {
	base := t.TempDir()
	left := filepath.Join(base, "left")
	right := filepath.Join(base, "right")
	writeJar(t, filepath.Join(left, "com.acme.other_1.0.0.jar"), strings.ReplaceAll(otherTargetManifest, "2.0.0", "1.0.0"))
	writeJar(t, filepath.Join(left, "com.acme.removed_1.0.0.jar"), strings.ReplaceAll(otherTargetManifest, "com.acme.other", "com.acme.removed"))
	writeJar(t, filepath.Join(right, "com.acme.other_2.0.0.jar"), otherTargetManifest)
	comparison, err := CompareTargets(left, right)
	if err != nil {
		t.Fatal(err)
	}
	if len(comparison.Added) != 0 || len(comparison.Removed) != 1 || len(comparison.Changed) != 1 {
		t.Fatalf("comparison = %+v", comparison)
	}
	if comparison.Removed[0].SymbolicName != "com.acme.removed" || comparison.Changed[0].SymbolicName != "com.acme.other" {
		t.Fatalf("comparison = %+v", comparison)
	}
	if comparison.Common != 1 {
		t.Fatalf("common = %d", comparison.Common)
	}
	if _, err := CompareTargets(filepath.Join(base, "missing"), right); err == nil {
		t.Fatal("a missing target must fail")
	}
}

// A bundle that ships a fragment per platform is normal in a real PDE workspace: the ones for
// the other platforms must not make the project look broken or inflate the Issues card.
func TestPlatformFilterForAnotherPlatformIsInfo(t *testing.T) {
	root := t.TempDir()
	writeProject(t, root, "com.acme.plan9", bundleManifest("com.acme.plan9", "Eclipse-PlatformFilter: (osgi.os=plan9)", "Export-Package: com.acme.plan9"), nil)
	report, err := BuildExplorer(root, 0)
	if err != nil {
		t.Fatal(err)
	}
	if len(report.Diagnostics) != 1 {
		t.Fatalf("diagnostics = %+v", report.Diagnostics)
	}
	diagnostic := report.Diagnostics[0]
	if diagnostic.Kind != "platform-filter" || diagnostic.Severity != "info" {
		t.Fatalf("diagnostic = %+v", diagnostic)
	}
	if len(diagnostic.Actions) != 0 {
		t.Fatalf("a bundle for another platform has nothing to fix: %+v", diagnostic.Actions)
	}
	if report.Summary.Issues != 0 {
		t.Fatalf("issues = %d, want 0", report.Summary.Issues)
	}
}

// The host of a fragment may be in the target the user has not chosen yet: until then the row
// already says "choose a target platform", and a red orphan error is noise.
func TestOrphanFragmentWithoutTargetIsNotAnError(t *testing.T) {
	root := t.TempDir()
	writeProject(t, root, "com.acme.fragment", bundleManifest("com.acme.fragment", "Fragment-Host: org.eclipse.ui.workbench"), nil)
	report, err := BuildExplorer(root, 0)
	if err != nil {
		t.Fatal(err)
	}
	if len(report.Diagnostics) != 0 || report.Summary.Issues != 0 {
		t.Fatalf("diagnostics = %+v, issues = %d", report.Diagnostics, report.Summary.Issues)
	}
}

func TestImportLooseJarsOnlyIntoAFolderTarget(t *testing.T) {
	root, target := controlCenterWorkspace(t)
	source := filepath.Join(t.TempDir(), "com.acme.extra_1.0.0.jar")
	writeJar(t, source, strings.ReplaceAll(otherTargetManifest, "com.acme.other", "com.acme.extra"))
	notABundle := filepath.Join(t.TempDir(), "plain.jar")
	writeJar(t, notABundle, "Manifest-Version: 1.0\n")

	result, err := ImportLooseJars(root, []string{source, notABundle})
	if err != nil {
		t.Fatal(err)
	}
	if len(result.Imported) != 1 || len(result.Skipped) != 1 {
		t.Fatalf("result = %+v", result)
	}
	if _, err := os.Stat(filepath.Join(target, filepath.Base(source))); err != nil {
		t.Fatalf("the jar was not copied: %v", err)
	}
	if _, err := ImportLooseJars(root, []string{source}); err != nil {
		t.Fatal(err)
	}

	// A .target definition is not writable from here.
	definition := filepath.Join(root, "empty.target")
	if err := os.WriteFile(definition, []byte(`<?xml version="1.0" encoding="UTF-8"?><target name="empty"/>`), 0o644); err != nil {
		t.Fatal(err)
	}
	if _, err := SetTarget(root, definition); err != nil {
		t.Fatal(err)
	}
	if _, err := ImportLooseJars(root, []string{source}); err == nil {
		t.Fatal("a .target definition must refuse loose JARs")
	}
}
