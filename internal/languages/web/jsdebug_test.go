package web

import (
	"path/filepath"
	"strings"
	"testing"
)

// installedJSDebug crea un'installazione gestita completa (server DAP + report pinnato) e
// restituisce la cartella strumenti.
func installedJSDebug(t *testing.T) string {
	t.Helper()
	tools := t.TempDir()
	writeFile(t, managedJSDebug(tools), "// js-debug\n")
	report, err := jsDebugReport()
	if err != nil {
		t.Fatal(err)
	}
	writeFile(t, filepath.Join(jsDebugDirectory(tools), "install-report.json"), string(report))
	return tools
}

func TestLocateJSDebugNeedsTheManagedInstallation(t *testing.T) {
	if server, source, warning := LocateJSDebug(""); server != "" || source != "" || warning != nil {
		t.Fatalf("without a tools folder nothing is found, got %q %q %v", server, source, warning)
	}
	tools := t.TempDir()
	if server, _, warning := LocateJSDebug(tools); server != "" || warning != nil {
		t.Fatalf("without an installation nothing is found, got %q %v", server, warning)
	}
}

func TestLocateJSDebugUsesAVerifiedInstallation(t *testing.T) {
	tools := installedJSDebug(t)
	server, source, warning := LocateJSDebug(tools)
	if warning != nil || server != managedJSDebug(tools) || source != "adOmnia tools" {
		t.Fatalf("a verified installation must be used: %q %q %v", server, source, warning)
	}
	// La prima verifica riuscita scrive il manifest generico (RS-9.4).
	if !isFile(filepath.Join(jsDebugDirectory(tools), "adomnia-tool.json")) {
		t.Fatal("the verified installation must record the tool manifest")
	}
}

func TestLocateJSDebugRefusesADifferentReport(t *testing.T) {
	tools := installedJSDebug(t)
	report := `{"tool":"js-debug","version":"v1.140.0","artifacts":[{"name":"js-debug-dap-v1.140.0.tar.gz","version":"v1.140.0","url":"https://example.invalid/x.tar.gz","sha256":"` + strings.Repeat("a", 64) + `"}]}`
	writeFile(t, filepath.Join(jsDebugDirectory(tools), "install-report.json"), report)

	server, _, warning := LocateJSDebug(tools)
	if server != "" || warning == nil || !strings.Contains(warning.Error(), "reinstall") {
		t.Fatalf("a report that does not match the pin must ask for a reinstall, got %q %v", server, warning)
	}
}

func TestLocateJSDebugRefusesAnInstallationWithoutReport(t *testing.T) {
	tools := t.TempDir()
	writeFile(t, managedJSDebug(tools), "// js-debug\n")
	server, _, warning := LocateJSDebug(tools)
	if server != "" || warning == nil || !strings.Contains(warning.Error(), "verification report") {
		t.Fatalf("an installation without report is not usable, got %q %v", server, warning)
	}
}

func TestJSDebugInstallPlanPinsTheReleaseAndVerifiesTheChecksum(t *testing.T) {
	tools := t.TempDir()
	plan, err := JSDebugInstallPlan(tools)
	if err != nil {
		t.Fatal(err)
	}
	if plan.Task != jsDebugInstallTask || plan.Languages[0] != ScriptID {
		t.Fatalf("plan = %+v", plan)
	}
	for _, want := range []string{"v1.140.0", jsDebugSHA256, "https://github.com/microsoft/vscode-js-debug/releases/download/v1.140.0/", "tar -xzf", "install-report.json"} {
		if !strings.Contains(plan.Command, want) {
			t.Fatalf("the install command must contain %q: %s", want, plan.Command)
		}
	}
	if plan.Prepare == nil {
		t.Fatal("the installer must prepare the tools folder")
	}
	if err := plan.Prepare(); err != nil || !isDir(jsDebugDirectory(tools)) {
		t.Fatalf("prepare: %v", err)
	}
}

func TestJSDebugInstallPlanNeedsAToolsFolder(t *testing.T) {
	if _, err := JSDebugInstallPlan(""); err == nil || !strings.Contains(err.Error(), "tools folder") {
		t.Fatalf("a missing tools folder must be reported, got %v", err)
	}
}

func TestJSDebugInstallCommandChecksTheChecksumBeforeExtracting(t *testing.T) {
	executable, arguments := jsDebugInstallCommand(`C:\tools\js-debug`, "https://example.invalid/a.tar.gz", jsDebugSHA256, "{}")
	if len(arguments) == 0 {
		t.Fatal("the installer must pass a script")
	}
	script := arguments[len(arguments)-1]
	if isWindows() {
		if executable != "powershell.exe" || !strings.Contains(script, "Get-FileHash") || strings.Contains(script, "-UseBasicParsing $f") {
			t.Fatalf("Windows installer = %s %s", executable, script)
		}
		return
	}
	if executable != "sh" || !strings.Contains(script, "sha256sum -c -") && !strings.Contains(script, "shasum -a 256 -c -") {
		t.Fatalf("POSIX installer = %s %s", executable, script)
	}
}

func TestVerifyManagedJSDebugRejectsAModifiedToolsFolder(t *testing.T) {
	tools := installedJSDebug(t)
	if err := verifyManagedJSDebug(tools); err != nil {
		t.Fatalf("the first verification must pass: %v", err)
	}
	// Il manifest ora esiste: un report diverso non corrisponde più a ciò che è stato verificato.
	writeFile(t, filepath.Join(jsDebugDirectory(tools), "install-report.json"), `{"tool":"js-debug","version":"v1.140.0","artifacts":[{"name":"js-debug-dap-v1.140.0.tar.gz","version":"v1.140.0","url":"https://example.invalid/x.tar.gz","sha256":"`+strings.Repeat("b", 64)+`"}]}`)
	if err := verifyManagedJSDebug(tools); err == nil || !strings.Contains(strings.ToLower(err.Error()), "reinstall") {
		t.Fatalf("a changed report must ask for a reinstall, got %v", err)
	}
}
