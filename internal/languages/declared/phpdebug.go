package declared

import (
	"fmt"
	"os"
	"path/filepath"
	"strings"

	"github.com/Andrea-Cavallo/adOmnia/internal/ide/lsp"
	"github.com/Andrea-Cavallo/adOmnia/internal/ide/toolmanifest"
	"github.com/Andrea-Cavallo/adOmnia/internal/jsonutil"
)

// PHP Debug adapter (xdebug/vscode-php-debug) is distributed as a VSIX on GitHub, not npm: the
// install downloads the pinned release, verifies its SHA-256 and extracts it into adOmnia's tools
// folder. The adapter entry (out/phpDebug.js) runs on Node and speaks DAP over stdio.
const (
	phpDebugVersion     = "1.40.2"
	phpDebugAsset       = "php-debug-1.40.2.vsix"
	phpDebugSHA256      = "17631993fe800083a2fc89a6782c8bf58a79603ad201ddff60d9b59ba2345d5f"
	phpDebugInstallTask = "install-php-debugger"
)

func phpDebugAssetURL() string {
	return "https://github.com/xdebug/vscode-php-debug/releases/download/v" + phpDebugVersion + "/" + phpDebugAsset
}

func phpDebugDirectory(toolsRoot string) string {
	return filepath.Join(toolsRoot, "php-debug-"+phpDebugVersion)
}

// managedPHPDebugEntry is the adapter script inside the extracted VSIX.
func managedPHPDebugEntry(toolsRoot string) string {
	return filepath.Join(phpDebugDirectory(toolsRoot), "extract", "extension", "out", "phpDebug.js")
}

func phpDebugReport() ([]byte, error) {
	return jsonutil.Marshal(toolmanifest.Report{
		Tool: "php-debug", Version: phpDebugVersion,
		Artifacts: []toolmanifest.Artifact{{
			Name: phpDebugAsset, Version: phpDebugVersion, URL: phpDebugAssetURL(), SHA256: phpDebugSHA256,
		}},
	})
}

// verifyManagedPHPDebug checks the install report and the extracted entry, the same way CodeLLDB is
// verified: a folder without a matching report is never used.
func verifyManagedPHPDebug(toolsRoot string) error {
	directory := phpDebugDirectory(toolsRoot)
	report, err := os.ReadFile(filepath.Join(directory, toolmanifest.ReportFile))
	if err != nil {
		return fmt.Errorf("the installed PHP debug adapter has no verification report (%s): reinstall it from PHP > Install Debug Adapter…", toolmanifest.ReportFile)
	}
	parsed, err := toolmanifest.ParseReport(report)
	if err != nil {
		return fmt.Errorf("the installed PHP debug adapter is not verified: %w. Reinstall it from PHP > Install Debug Adapter…", err)
	}
	expected := toolmanifest.Artifact{Name: phpDebugAsset, Version: phpDebugVersion, URL: phpDebugAssetURL(), SHA256: phpDebugSHA256}
	if parsed.Tool != "php-debug" || parsed.Version != phpDebugVersion || len(parsed.Artifacts) != 1 || parsed.Artifacts[0] != expected {
		return fmt.Errorf("the installed PHP debug adapter does not match the pinned %s release: reinstall it from PHP > Install Debug Adapter…", phpDebugVersion)
	}
	if info, err := os.Stat(managedPHPDebugEntry(toolsRoot)); err != nil || info.IsDir() {
		return fmt.Errorf("the installed PHP debug adapter has no adapter script: reinstall it from PHP > Install Debug Adapter…")
	}
	return toolmanifest.Ensure(filepath.Join(directory, toolmanifest.ManifestFile), "php-debug", phpDebugVersion, parsed.Artifacts, report)
}

// managedPHPDebug locates the adapter installed by adOmnia and the Node runtime that runs it.
func managedPHPDebug(toolsRoot string) (string, []string, bool) {
	if toolsRoot == "" || verifyManagedPHPDebug(toolsRoot) != nil {
		return "", nil, false
	}
	node, err := lookPath("node")
	if err != nil {
		return "", nil, false
	}
	return node, []string{managedPHPDebugEntry(toolsRoot)}, true
}

// PHPDebugInstallPlan downloads the pinned VSIX, verifies its SHA-256, extracts it into the adOmnia
// tools folder and writes the verification report. It never installs anything globally.
func PHPDebugInstallPlan(toolsRoot string) (lsp.InstallPlan, error) {
	if toolsRoot == "" {
		return lsp.InstallPlan{}, fmt.Errorf("adOmnia tools folder not configured")
	}
	directory := phpDebugDirectory(toolsRoot)
	report, err := phpDebugReport()
	if err != nil {
		return lsp.InstallPlan{}, err
	}
	executable, arguments := toolmanifest.Download{Directory: directory, Archive: "php-debug.zip", URL: phpDebugAssetURL(), SHA256: phpDebugSHA256, Report: string(report)}.Command()
	return lsp.InstallPlan{
		Task:       phpDebugInstallTask,
		Title:      "Install the PHP debug adapter?",
		Label:      "Installing the PHP debug adapter",
		Note:       fmt.Sprintf("Downloads the pinned PHP Debug %s VSIX, verifies its SHA-256 and extracts it into the adOmnia tools folder (%s), never into your project or global Node modules. Needs network access now; afterwards debugging works offline.", phpDebugVersion, directory),
		Command:    executable + " " + strings.Join(arguments, " "),
		Executable: executable,
		Arguments:  arguments,
		Directory:  toolsRoot,
		Prepare:    func() error { return os.MkdirAll(directory, 0o755) },
		Languages:  []string{"php"},
	}, nil
}
