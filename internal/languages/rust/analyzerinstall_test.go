package rust

import (
	"path/filepath"
	"runtime"
	"strings"
	"testing"

	"github.com/Andrea-Cavallo/adOmnia/internal/ide/toolmanifest"
)

func pinnedRustAnalyzerAsset(t *testing.T) rustAnalyzerAsset {
	t.Helper()
	asset, ok := rustAnalyzerAssets[runtime.GOOS+"/"+runtime.GOARCH]
	if !ok {
		t.Skipf("no rust-analyzer asset is pinned for %s/%s", runtime.GOOS, runtime.GOARCH)
	}
	return asset
}

func TestManagedRustAnalyzerIsUsedOnlyWhenVerified(t *testing.T) {
	asset := pinnedRustAnalyzerAsset(t)
	tools := t.TempDir()
	binary := managedRustAnalyzer(tools)
	writeFile(t, filepath.Dir(binary), filepath.Base(binary), "")

	original := lookPath
	lookPath = func(string) (string, error) { return "", errNotFound }
	defer func() { lookPath = original }()

	if info := New().LocateServer(t.TempDir(), tools); info.Available {
		t.Fatal("an unverified managed install must not be used")
	}
	if err := verifyManagedRustAnalyzer(tools); err == nil || !strings.Contains(err.Error(), toolmanifest.ReportFile) {
		t.Fatalf("an install without a report must be refused: %v", err)
	}

	report, err := rustAnalyzerReport(asset)
	if err != nil {
		t.Fatal(err)
	}
	writeFile(t, rustAnalyzerDirectory(tools), toolmanifest.ReportFile, string(report))
	if err := verifyManagedRustAnalyzer(tools); err != nil {
		t.Fatalf("verified install: %v", err)
	}
	info := New().LocateServer(t.TempDir(), tools)
	if !info.Available || info.Source != "adOmnia tools" || info.Binary != binary {
		t.Fatalf("info = %+v", info)
	}
}

func TestRustAnalyzerStandalonePlanWhenRustupIsMissing(t *testing.T) {
	asset := pinnedRustAnalyzerAsset(t)
	original := lookPath
	lookPath = func(string) (string, error) { return "", errNotFound }
	defer func() { lookPath = original }()

	plan, err := New().InstallPlan(t.TempDir())
	if err != nil {
		t.Fatal(err)
	}
	for _, want := range []string{asset.name, asset.sha256, rustAnalyzerVersion} {
		if !strings.Contains(plan.Command, want) && !strings.Contains(plan.Note, want) {
			t.Fatalf("standalone plan does not mention %q:\n%s\n%s", want, plan.Command, plan.Note)
		}
	}
	if plan.Task != rustAnalyzerInstallTask || len(plan.Languages) != 1 || plan.Languages[0] != ID {
		t.Fatalf("plan = %+v", plan)
	}
}

func TestRustAnalyzerStandalonePlanNeedsAToolsFolder(t *testing.T) {
	original := lookPath
	lookPath = func(string) (string, error) { return "", errNotFound }
	defer func() { lookPath = original }()

	if _, err := New().InstallPlan(""); err == nil || !strings.Contains(err.Error(), "tools folder") {
		t.Fatalf("a missing tools folder must be refused: %v", err)
	}
}
