package eclipsepde

import (
	"context"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"
)

// TestRealKeplerP2Target resolves and downloads the RCP feature from the real
// Kepler SR2 repository (the release composite also lists an EPP child that
// redirects to archive.eclipse.org), then resolves a workspace bundle against it. It needs
// network access, so it is opt-in: ADOMNIA_TEST_P2=1.
func TestRealKeplerP2Target(t *testing.T) {
	if os.Getenv("ADOMNIA_TEST_P2") == "" {
		t.Skip("ADOMNIA_TEST_P2 is not set: opt in with ADOMNIA_TEST_P2=1 to download from download.eclipse.org")
	}
	useTempP2Cache(t)
	root := filepath.Join(t.TempDir(), "ws")
	writeProject(t, root, "com.acme.rcp", "Bundle-ManifestVersion: 2\nBundle-SymbolicName: com.acme.rcp;singleton:=true\nBundle-Version: 1.0.0\n"+
		"Bundle-RequiredExecutionEnvironment: JavaSE-1.6\nRequire-Bundle: org.eclipse.ui;bundle-version=\"[3.105.0,4.0.0)\",\n org.eclipse.core.runtime\n", nil)
	writeText(t, filepath.Join(root, "kepler.target"), `<?xml version="1.0" encoding="UTF-8" standalone="no"?>
<?pde version="3.8"?><target name="Kepler RCP" sequenceNumber="1"><locations>
<location includeAllPlatforms="false" includeConfigurePhase="false" includeMode="planner" includeSource="false" type="InstallableUnit">
<unit id="org.eclipse.rcp.feature.group" version="0.0.0"/>
<repository location="https://download.eclipse.org/releases/kepler/201402280900/"/>
</location></locations></target>`)
	if _, err := SetTarget(root, filepath.Join(root, "kepler.target")); err != nil {
		t.Fatal(err)
	}
	ctx, cancel := context.WithTimeout(context.Background(), 20*time.Minute)
	defer cancel()
	started := time.Now()
	result, err := DownloadTargetP2(ctx, root, nil)
	if err != nil {
		t.Fatal(err)
	}
	t.Logf("download: %+v in %s", *result, time.Since(started).Round(time.Second))
	if result.Bundles < 30 || result.Downloaded != result.Bundles {
		t.Fatalf("the RCP feature has dozens of bundles: %+v", result)
	}
	report, err := BuildReport(root)
	if err != nil {
		t.Fatal(err)
	}
	for _, problem := range report.Problems {
		t.Logf("problem: %s %s", problem.File, problem.Message)
	}
	if report.Unresolved != 0 || report.Bundles[0].Status != StatusResolved {
		t.Fatalf("the RCP bundle must resolve against the downloaded target: %+v", report.Bundles)
	}
}

// TestRealKeplerTargetAgreesWithEquinox downloads the Kepler SR2 RCP and EMF
// features and compares every bundle with Equinox, in PDE's development mode.
// Opt-in: ADOMNIA_TEST_P2=1 and ADOMNIA_TEST_EQUINOX=<org.eclipse.osgi_3.9.x.jar>.
func TestRealKeplerTargetAgreesWithEquinox(t *testing.T) {
	if os.Getenv("ADOMNIA_TEST_P2") == "" {
		t.Skip("ADOMNIA_TEST_P2 is not set")
	}
	osgiJar, classes := requireEquinox(t)
	cache := useTempP2Cache(t)
	root := filepath.Join(t.TempDir(), "ws")
	writeText(t, filepath.Join(root, "kepler.target"), `<?xml version="1.0" encoding="UTF-8" standalone="no"?>
<target name="Kepler"><locations>
<location includeAllPlatforms="false" includeMode="planner" includeSource="false" type="InstallableUnit">
<unit id="org.eclipse.rcp.feature.group" version="0.0.0"/>
<unit id="org.eclipse.emf.ecore.feature.group" version="0.0.0"/>
<unit id="org.eclipse.equinox.p2.core.feature.feature.group" version="0.0.0"/>
<repository location="https://download.eclipse.org/releases/kepler/201402280900/"/>
</location></locations></target>`)
	if _, err := SetTarget(root, filepath.Join(root, "kepler.target")); err != nil {
		t.Fatal(err)
	}
	ctx, cancel := context.WithTimeout(context.Background(), 20*time.Minute)
	defer cancel()
	result, err := DownloadTargetP2(ctx, root, nil)
	if err != nil {
		t.Fatal(err)
	}
	if len(result.Problems) > 0 {
		t.Logf("p2 problems: %v", result.Problems)
	}
	bundles, err := filepath.Glob(filepath.Join(cache, "bundles", "*.jar"))
	if err != nil || len(bundles) == 0 {
		t.Fatalf("no bundles: %v", err)
	}
	equinox := runEquinox(t, osgiJar, classes, "JavaSE-1.6", "development", bundles)
	resolved := 0
	for _, bundle := range equinox {
		if bundle.resolved {
			resolved++
		}
	}
	t.Logf("%d bundles, %d resolved by Equinox", len(equinox), resolved)
	if differences := compareResolvers(equinox, runGo(t, "JavaSE-1.6", bundles)); len(differences) > 0 {
		t.Errorf("Go and Equinox disagree on the Kepler target:\n%s", strings.Join(differences, "\n"))
	}
}
