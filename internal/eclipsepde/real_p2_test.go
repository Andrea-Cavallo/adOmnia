package eclipsepde

import (
	"context"
	"os"
	"path/filepath"
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
