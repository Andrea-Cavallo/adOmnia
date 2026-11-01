package declared

import (
	"os"
	"path/filepath"
	"strings"
	"testing"

	"github.com/Andrea-Cavallo/adOmnia/internal/ide/dap"
	"github.com/Andrea-Cavallo/adOmnia/internal/ide/toolmanifest"
)

func phpAdapter(t *testing.T) scriptAdapter {
	t.Helper()
	for _, language := range Languages() {
		if language.ID() == "php" {
			adapter, ok := language.(scriptAdapter)
			if !ok {
				t.Fatal("php is not a script adapter")
			}
			return adapter
		}
	}
	t.Fatal("php not registered")
	return scriptAdapter{}
}

func installedPHPDebug(t *testing.T) string {
	t.Helper()
	tools := t.TempDir()
	directory := phpDebugDirectory(tools)
	entry := managedPHPDebugEntry(tools)
	if err := os.MkdirAll(filepath.Dir(entry), 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(entry, []byte("// adapter"), 0o644); err != nil {
		t.Fatal(err)
	}
	report, err := phpDebugReport()
	if err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(directory, toolmanifest.ReportFile), report, 0o644); err != nil {
		t.Fatal(err)
	}
	return tools
}

func TestPHPDebugInstallPlanPinsTheVSIX(t *testing.T) {
	tools := t.TempDir()
	plan, err := PHPDebugInstallPlan(tools)
	if err != nil {
		t.Fatal(err)
	}
	for _, want := range []string{"v" + phpDebugVersion, phpDebugAssetURL(), phpDebugSHA256, toolmanifest.ReportFile} {
		if !strings.Contains(plan.Command, want) && !strings.Contains(plan.Note, want) {
			t.Fatalf("install plan does not mention %q: %s", want, plan.Command)
		}
	}
	if plan.Task != phpDebugInstallTask || len(plan.Languages) != 1 || plan.Languages[0] != "php" {
		t.Fatalf("plan = %+v", plan)
	}
	if _, err := PHPDebugInstallPlan(""); err == nil {
		t.Fatal("a missing tools folder must be refused")
	}
}

func TestPHPDebugIsOnlyInstalledWhenVerified(t *testing.T) {
	tools := t.TempDir()
	if err := verifyManagedPHPDebug(tools); err == nil || !strings.Contains(err.Error(), "verification report") {
		t.Fatalf("an empty folder must not be used: %v", err)
	}
	if _, _, ok := managedPHPDebug(tools); ok {
		t.Fatal("an unverified install must not be located")
	}
	if _, err := phpAdapter(t).DebuggerInstallPlan(tools); err != nil {
		t.Fatalf("php declares an installable debugger: %v", err)
	}
}

func TestManagedPHPDebugRunsOnNode(t *testing.T) {
	tools := installedPHPDebug(t)
	fakeToolchain(t, "node", "php")
	executable, arguments, ok := managedPHPDebug(tools)
	if !ok || executable != "/usr/bin/node" || len(arguments) != 1 || arguments[0] != managedPHPDebugEntry(tools) {
		t.Fatalf("managed php debug = %q %v %v", executable, arguments, ok)
	}

	root := t.TempDir()
	writeProjectFile(t, root, "app.php", "<?php echo 1;\n")
	spec, err := phpAdapter(t).DebugAdapter(dap.LaunchRequest{
		Root: root, WorkingDirectory: root, ToolsRoot: tools,
		LanguageOptions: []byte(`{"program":"app.php"}`),
	})
	if err != nil {
		t.Fatal(err)
	}
	if spec.Executable != "/usr/bin/node" || len(spec.Arguments) != 1 || spec.Transport != dap.Stdio {
		t.Fatalf("spec = %+v", spec)
	}
}

func TestScriptRowsWithoutADebuggerSayWhy(t *testing.T) {
	for _, language := range Languages() {
		if language.ID() != "ruby" {
			continue
		}
		adapter, ok := language.(scriptAdapter)
		if !ok {
			t.Fatal("ruby is a script adapter")
		}
		if _, err := adapter.DebuggerInstallPlan(t.TempDir()); err == nil {
			t.Fatal("ruby has no installable debugger")
		}
		return
	}
	t.Fatal("ruby not registered")
}
