package declared

import (
	"errors"
	"os"
	"os/exec"
	"path/filepath"
	"runtime"
	"strings"
	"testing"

	"github.com/Andrea-Cavallo/adOmnia/internal/ide/language"
	"github.com/Andrea-Cavallo/adOmnia/internal/ide/toolmanifest"
	"github.com/Andrea-Cavallo/adOmnia/internal/jsonutil"
)

func TestNetcoredbgPrefersTheVerifiedInstallThenPath(t *testing.T) {
	asset, ok := netcoredbgAssets[runtime.GOOS+"/"+runtime.GOARCH]
	if !ok {
		t.Skip("no netcoredbg build pinned for this platform")
	}
	t.Cleanup(func() { lookPath = defaultLookPath })
	lookPath = func(string) (string, error) { return "", errors.New("missing") }
	tools := t.TempDir()

	if _, err := netcoredbgFor(tools); err == nil || !strings.Contains(err.Error(), "Install .NET Debugger") {
		t.Fatalf("nothing installed must point at the install command, got %v", err)
	}
	// A binary without a report is never used.
	relative, _ := filepath.Rel(tools, netcoredbgBinary(tools))
	writeProjectFile(t, tools, filepath.ToSlash(relative), "x")
	if binary := managedNetcoredbg(tools); binary != "" {
		t.Fatalf("an unverified folder was used: %s", binary)
	}
	report, err := jsonutil.Marshal(toolmanifest.Report{Tool: "netcoredbg", Version: netcoredbgVersion, Artifacts: []toolmanifest.Artifact{netcoredbgArtifact(asset)}})
	if err != nil {
		t.Fatal(err)
	}
	relative, _ = filepath.Rel(tools, filepath.Join(netcoredbgDirectory(tools), toolmanifest.ReportFile))
	writeProjectFile(t, tools, filepath.ToSlash(relative), string(report))
	if binary, err := netcoredbgFor(tools); err != nil || binary != netcoredbgBinary(tools) {
		t.Fatalf("the verified install must win: %s %v", binary, err)
	}

	lookPath = func(name string) (string, error) { return "/bin/" + name, nil }
	if binary, _ := netcoredbgFor(""); binary != "/bin/netcoredbg" {
		t.Fatalf("PATH fallback = %s", binary)
	}
}

func TestDotnetRowsOfferTheNetcoredbgInstall(t *testing.T) {
	if _, ok := netcoredbgAssets[runtime.GOOS+"/"+runtime.GOARCH]; !ok {
		t.Skip("no netcoredbg build pinned for this platform")
	}
	for _, id := range []string{"csharp", "fsharp"} {
		installer, ok := rowAdapter(t, id).(language.DebuggerInstaller)
		if !ok {
			t.Fatalf("%s has no debugger install", id)
		}
		plan, err := installer.DebuggerInstallPlan(t.TempDir())
		if err != nil || plan.Task != netcoredbgInstallTask || !strings.Contains(plan.Command, netcoredbgVersion) {
			t.Fatalf("%s plan: %+v %v", id, plan, err)
		}
	}
	if _, err := NetcoredbgInstallPlan(""); err == nil {
		t.Fatal("a missing tools folder must be reported")
	}
}

// TestRealNetcoredbgInstall downloads the pinned release with the exact plan command.
// ADOMNIA_TEST_NETCOREDBG=1 go test ./internal/languages/declared -run RealNetcoredbg
func TestRealNetcoredbgInstall(t *testing.T) {
	if os.Getenv("ADOMNIA_TEST_NETCOREDBG") != "1" {
		t.Skip("set ADOMNIA_TEST_NETCOREDBG=1 to download netcoredbg")
	}
	tools := t.TempDir()
	plan, err := NetcoredbgInstallPlan(tools)
	if err != nil {
		t.Fatal(err)
	}
	if err := plan.Prepare(); err != nil {
		t.Fatal(err)
	}
	command := exec.Command(plan.Executable, plan.Arguments...) // #nosec G204 -- pinned test command
	command.Dir = plan.Directory
	if output, err := command.CombinedOutput(); err != nil {
		t.Fatalf("install failed: %v\n%s", err, output)
	}
	binary := managedNetcoredbg(tools)
	if binary == "" {
		t.Fatal("the installed netcoredbg did not verify")
	}
	if output, err := exec.Command(binary, "--version").CombinedOutput(); err != nil || !strings.Contains(string(output), "NET Core debugger") { // #nosec G204 -- just installed
		t.Fatalf("netcoredbg --version: %v %s", err, output)
	}
}
