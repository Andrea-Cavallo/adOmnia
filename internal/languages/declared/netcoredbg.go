package declared

import (
	"fmt"
	"os"
	"path/filepath"
	"runtime"
	"strings"

	"github.com/Andrea-Cavallo/adOmnia/internal/ide/lsp"
	"github.com/Andrea-Cavallo/adOmnia/internal/ide/toolmanifest"
	"github.com/Andrea-Cavallo/adOmnia/internal/jsonutil"
)

// netcoredbg (Samsung, MIT) debugs C# and F# assemblies over DAP. The install downloads the pinned
// release for this platform, verifies its SHA-256 and extracts it into adOmnia's tools folder.
const (
	netcoredbgVersion     = "3.2.0-1092"
	netcoredbgInstallTask = "install-dotnet-debugger"
)

type netcoredbgAsset struct{ name, sha256 string }

// No macOS Intel build is published for this release: those users keep netcoredbg on PATH.
var netcoredbgAssets = map[string]netcoredbgAsset{
	"windows/amd64": {"netcoredbg-win64.zip", "3c410a45fa502415203a94fcb88654af65bf8e3dac158a5527a722e7a6b9274a"},
	"linux/amd64":   {"netcoredbg-linux-amd64.tar.gz", "080eb3b2d2152465f599d3b33d1ee6e747794e11cc0a3773ec689f5e5f2c5afa"},
	"linux/arm64":   {"netcoredbg-linux-arm64.tar.gz", "065ff49badec8a695dbea2de6ab6a330c774a191e426a217ab8cc05250627ccb"},
	"darwin/arm64":  {"netcoredbg-osx-arm64.zip", "f4fa33b3ff874910cc184b4bb3b9c56d0abdf5c6521cee0b144d7c6e4a6e59ea"},
}

func netcoredbgDirectory(toolsRoot string) string {
	return filepath.Join(toolsRoot, "netcoredbg-"+netcoredbgVersion)
}

func netcoredbgBinary(toolsRoot string) string {
	name := "netcoredbg"
	if runtime.GOOS == "windows" {
		name += ".exe"
	}
	return filepath.Join(netcoredbgDirectory(toolsRoot), "extract", "netcoredbg", name)
}

func netcoredbgArtifact(asset netcoredbgAsset) toolmanifest.Artifact {
	return toolmanifest.Artifact{Name: asset.name, Version: netcoredbgVersion,
		URL: "https://github.com/Samsung/netcoredbg/releases/download/" + netcoredbgVersion + "/" + asset.name, SHA256: asset.sha256}
}

// managedNetcoredbg is the verified netcoredbg installed by adOmnia, or "" when there is none:
// a folder without a report matching the pinned release is never used.
func managedNetcoredbg(toolsRoot string) string {
	asset, ok := netcoredbgAssets[runtime.GOOS+"/"+runtime.GOARCH]
	if toolsRoot == "" || !ok {
		return ""
	}
	directory := netcoredbgDirectory(toolsRoot)
	report, err := os.ReadFile(filepath.Join(directory, toolmanifest.ReportFile)) // #nosec G304 -- adOmnia tools folder
	if err != nil {
		return ""
	}
	parsed, err := toolmanifest.ParseReport(report)
	if err != nil || parsed.Tool != "netcoredbg" || parsed.Version != netcoredbgVersion ||
		len(parsed.Artifacts) != 1 || parsed.Artifacts[0] != netcoredbgArtifact(asset) {
		return ""
	}
	binary := netcoredbgBinary(toolsRoot)
	if info, err := os.Stat(binary); err != nil || info.IsDir() {
		return ""
	}
	if toolmanifest.Ensure(filepath.Join(directory, toolmanifest.ManifestFile), "netcoredbg", netcoredbgVersion, parsed.Artifacts, report) != nil {
		return ""
	}
	return binary
}

// NetcoredbgInstallPlan is the one visible command that installs the pinned netcoredbg.
func NetcoredbgInstallPlan(toolsRoot string) (lsp.InstallPlan, error) {
	if toolsRoot == "" {
		return lsp.InstallPlan{}, fmt.Errorf("adOmnia tools folder not configured")
	}
	asset, ok := netcoredbgAssets[runtime.GOOS+"/"+runtime.GOARCH]
	if !ok {
		return lsp.InstallPlan{}, fmt.Errorf("no netcoredbg build is published for %s/%s: install it manually and put it on PATH", runtime.GOOS, runtime.GOARCH)
	}
	artifact := netcoredbgArtifact(asset)
	report, err := jsonutil.Marshal(toolmanifest.Report{Tool: "netcoredbg", Version: netcoredbgVersion, Artifacts: []toolmanifest.Artifact{artifact}})
	if err != nil {
		return lsp.InstallPlan{}, err
	}
	directory := netcoredbgDirectory(toolsRoot)
	archive := "netcoredbg.tar.gz"
	if strings.HasSuffix(asset.name, ".zip") {
		archive = "netcoredbg.zip"
	}
	executable, arguments := toolmanifest.Download{Directory: directory, Archive: archive, URL: artifact.URL, SHA256: asset.sha256,
		Report: string(report), Executables: []string{"netcoredbg/netcoredbg"}}.Command()
	return lsp.InstallPlan{
		Task:       netcoredbgInstallTask,
		Title:      "Install the .NET debugger?",
		Label:      "Installing netcoredbg",
		Note:       fmt.Sprintf("Downloads netcoredbg %s (%s), verifies its SHA-256 and extracts it into the adOmnia tools folder (%s), never into your project or global .NET tools. Needs network access now; afterwards debugging works offline.", netcoredbgVersion, asset.name, directory),
		Command:    executable + " " + strings.Join(arguments, " "),
		Executable: executable,
		Arguments:  arguments,
		Directory:  toolsRoot,
		Prepare:    func() error { return os.MkdirAll(directory, 0o755) },
		Languages:  []string{"csharp", "fsharp"},
	}, nil
}

// DebuggerInstallPlan implements language.DebuggerInstaller for C# and F#.
func (dotnetAdapter) DebuggerInstallPlan(toolsRoot string) (lsp.InstallPlan, error) {
	return NetcoredbgInstallPlan(toolsRoot)
}

// netcoredbgFor prefers the verified install in the tools folder, then netcoredbg on PATH.
func netcoredbgFor(toolsRoot string) (string, error) {
	if binary := managedNetcoredbg(toolsRoot); binary != "" {
		return binary, nil
	}
	if binary, err := lookPath("netcoredbg"); err == nil {
		return binary, nil
	}
	return "", fmt.Errorf("netcoredbg is not installed: run 'Install .NET Debugger…' from the command palette or put netcoredbg on PATH")
}
