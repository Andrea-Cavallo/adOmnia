package rust

import (
	"fmt"
	"os"
	"path/filepath"
	"runtime"
	"strings"

	"github.com/Andrea-Cavallo/adOmnia/internal/ide/lsp"
	"github.com/Andrea-Cavallo/adOmnia/internal/ide/sdk"
	"github.com/Andrea-Cavallo/adOmnia/internal/ide/toolmanifest"
	"github.com/Andrea-Cavallo/adOmnia/internal/jsonutil"
)

// Standalone rust-analyzer (RS-9.4): when rustup is not available, adOmnia can install the pinned
// release of the language server into its own tools folder. The archive is checksum-verified and the
// install is recorded with the generic tool manifest, like CodeLLDB and basedpyright.
const rustAnalyzerVersion = "2026-10-26"

type rustAnalyzerAsset struct {
	name   string
	sha256 string
	// gzip: the release is a single gzipped binary instead of a zip archive.
	gzip bool
}

// rustAnalyzerAssets pins the platform assets and their SHA-256 (release 2026-10-26).
var rustAnalyzerAssets = map[string]rustAnalyzerAsset{
	"windows/amd64": {"rust-analyzer-x86_64-pc-windows-msvc.zip", "13549dd0c380647685c82c87b8d80904f81bc4de92a82c099b6083c5b9aa1ca1", false},
	"windows/arm64": {"rust-analyzer-aarch64-pc-windows-msvc.zip", "e5f758de3ece10656d7bba6565b92e65fb52843810dc1bd0a911e307755d63ad", false},
	"linux/amd64":   {"rust-analyzer-x86_64-unknown-linux-gnu.gz", "4c83773525f93b636ed79761389568b4d2a89c05fa7ecc440245032d49ad80ce", true},
	"linux/arm64":   {"rust-analyzer-aarch64-unknown-linux-gnu.gz", "1b225c4c9ae329ca96e8a75a5bbcb5562a7f1d25c57c8b55d3e02299a3dbe836", true},
	"darwin/amd64":  {"rust-analyzer-x86_64-apple-darwin.gz", "b3e4904877bcf7013a4a342c449cff1bf0ea0b91d5a1a30ac8df3d32142519c0", true},
	"darwin/arm64":  {"rust-analyzer-aarch64-apple-darwin.gz", "8fb90cb58f5910d8d8b24ac1a93cca49f053365cbf0eb3c682144ad0a0027dcf", true},
}

func rustAnalyzerAssetURL(name string) string {
	return "https://github.com/rust-lang/rust-analyzer/releases/download/" + rustAnalyzerVersion + "/" + name
}

func rustAnalyzerDirectory(toolsRoot string) string {
	return filepath.Join(toolsRoot, "rust-analyzer-"+rustAnalyzerVersion)
}

// managedRustAnalyzer is the verified standalone binary in adOmnia's tools folder.
func managedRustAnalyzer(toolsRoot string) string {
	if toolsRoot == "" {
		return ""
	}
	return filepath.Join(rustAnalyzerDirectory(toolsRoot), "extract", sdk.ExecutableName(rustAnalyzerName))
}

func rustAnalyzerReport(asset rustAnalyzerAsset) ([]byte, error) {
	return jsonutil.Marshal(toolmanifest.Report{
		Tool: "rust-analyzer", Version: rustAnalyzerVersion,
		Artifacts: []toolmanifest.Artifact{{
			Name: asset.name, Version: rustAnalyzerVersion,
			URL: rustAnalyzerAssetURL(asset.name), SHA256: asset.sha256,
		}},
	})
}

// verifyManagedRustAnalyzer checks report and manifest before the binary is used: an install without
// a matching report is ignored and the editor notice can reinstall it.
func verifyManagedRustAnalyzer(toolsRoot string) error {
	directory := rustAnalyzerDirectory(toolsRoot)
	report, err := os.ReadFile(filepath.Join(directory, toolmanifest.ReportFile))
	if err != nil {
		return fmt.Errorf("the installed rust-analyzer has no verification report (%s): reinstall it from the editor notice", toolmanifest.ReportFile)
	}
	parsed, err := toolmanifest.ParseReport(report)
	if err != nil {
		return fmt.Errorf("the installed rust-analyzer is not verified: %w. Reinstall it from the editor notice", err)
	}
	asset, pinned := rustAnalyzerAssets[runtime.GOOS+"/"+runtime.GOARCH]
	if !pinned {
		return fmt.Errorf("no rust-analyzer build is pinned for %s/%s: reinstall it from the editor notice", runtime.GOOS, runtime.GOARCH)
	}
	expected := toolmanifest.Artifact{Name: asset.name, Version: rustAnalyzerVersion, URL: rustAnalyzerAssetURL(asset.name), SHA256: asset.sha256}
	if parsed.Tool != "rust-analyzer" || parsed.Version != rustAnalyzerVersion || len(parsed.Artifacts) != 1 || parsed.Artifacts[0] != expected {
		return fmt.Errorf("the installed rust-analyzer does not match the pinned %s release: reinstall it from the editor notice", rustAnalyzerVersion)
	}
	binary := managedRustAnalyzer(toolsRoot)
	if info, err := os.Stat(binary); err != nil || info.IsDir() {
		return fmt.Errorf("the installed rust-analyzer has no binary: reinstall it from the editor notice")
	}
	return toolmanifest.Ensure(filepath.Join(directory, toolmanifest.ManifestFile), "rust-analyzer", rustAnalyzerVersion, parsed.Artifacts, report)
}

// rustAnalyzerStandaloneInstallPlan installs the pinned standalone release. It is used only when
// rustup is absent, so the preferred component path keeps working.
func rustAnalyzerStandaloneInstallPlan(toolsRoot string) (lsp.InstallPlan, error) {
	if toolsRoot == "" {
		return lsp.InstallPlan{}, fmt.Errorf("adOmnia tools folder not configured")
	}
	asset, ok := rustAnalyzerAssets[runtime.GOOS+"/"+runtime.GOARCH]
	if !ok {
		return lsp.InstallPlan{}, fmt.Errorf("no rust-analyzer build is pinned for %s/%s: install Rust with rustup (https://rustup.rs) and run `rustup component add rust-analyzer`", runtime.GOOS, runtime.GOARCH)
	}
	directory := rustAnalyzerDirectory(toolsRoot)
	url := rustAnalyzerAssetURL(asset.name)
	report, err := rustAnalyzerReport(asset)
	if err != nil {
		return lsp.InstallPlan{}, err
	}
	executable, arguments := rustAnalyzerInstallCommand(directory, url, asset.sha256, string(report), asset.gzip)
	return lsp.InstallPlan{
		Task:       rustAnalyzerInstallTask,
		Title:      "Install the Rust language server?",
		Label:      "Installing rust-analyzer",
		Note:       fmt.Sprintf("Downloads the pinned rust-analyzer %s build (%s), verifies its SHA-256 and extracts it into the adOmnia tools folder (%s), never into your project or toolchains. Needs network access now; afterwards rust-analyzer works offline.", rustAnalyzerVersion, asset.name, directory),
		Command:    executable + " " + strings.Join(arguments, " "),
		Executable: executable,
		Arguments:  arguments,
		Directory:  toolsRoot,
		Prepare:    func() error { return os.MkdirAll(directory, 0o755) },
		Languages:  []string{ID},
	}, nil
}

func rustAnalyzerInstallCommand(directory, url, sha256, report string, gzip bool) (string, []string) {
	if runtime.GOOS == "windows" {
		quote := func(value string) string { return "'" + strings.ReplaceAll(value, "'", "''") + "'" }
		script := "$ErrorActionPreference='Stop'; $d=" + quote(directory) + "; $f=Join-Path $d 'rust-analyzer.zip'; " +
			"Invoke-WebRequest -UseBasicParsing " + quote(url) + " -OutFile $f; " +
			"if ((Get-FileHash $f -Algorithm SHA256).Hash.ToLower() -ne '" + sha256 + "') { Remove-Item $f; throw 'SHA-256 mismatch: the download was discarded' }; " +
			"Expand-Archive -Force $f (Join-Path $d 'extract'); Remove-Item $f; " +
			"Set-Content -LiteralPath (Join-Path $d " + quote(toolmanifest.ReportFile) + ") -Value " + quote(report)
		return "powershell.exe", []string{"-NoProfile", "-NonInteractive", "-Command", script}
	}
	quote := func(value string) string { return "'" + strings.ReplaceAll(value, "'", `'\''`) + "'" }
	check := "sha256sum -c -"
	if runtime.GOOS == "darwin" {
		check = "shasum -a 256 -c -"
	}
	extract := "mv \"$d/rust-analyzer\" \"$d/extract/rust-analyzer\""
	if gzip {
		extract = "gzip -dc \"$d/rust-analyzer.gz\" > \"$d/extract/rust-analyzer\""
	}
	archive := "$d/rust-analyzer"
	if gzip {
		archive = "$d/rust-analyzer.gz"
	}
	script := "set -e; d=" + quote(directory) + "; mkdir -p \"$d/extract\"; curl -fsSL " + quote(url) + " -o " + archive + "; " +
		"echo '" + sha256 + "  '" + archive + " | " + check + "; " +
		extract + "; chmod +x \"$d/extract/rust-analyzer\"; rm -f " + archive + "; " +
		"printf '%s' " + quote(report) + " >\"$d/" + toolmanifest.ReportFile + "\""
	return "sh", []string{"-c", script}
}
