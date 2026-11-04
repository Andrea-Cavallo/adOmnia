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

// pinnedAsset is one release file, its published SHA-256 and the server program inside it
// (a path under extract/; for a bare executable, the file itself).
type pinnedAsset struct{ name, sha256, program string }

// pinnedServer is a language server adOmnia downloads at a fixed release, verifies and extracts into
// its own tools folder (the Install… button). A copy on PATH keeps working as before.
type pinnedServer struct {
	tool, version string
	// releaseURL is the download folder; the asset name is appended.
	releaseURL string
	// assets maps GOOS/GOARCH to the release file; the key "any" serves every platform.
	assets map[string]pinnedAsset
	// binary: the asset is the executable itself (no archive).
	binary bool
	// launch builds the server command from the verified extract folder; nil starts the asset's
	// program with the row's server arguments.
	launch func(extract string) (string, []string, error)
}

func (p pinnedServer) asset() (pinnedAsset, bool) {
	if asset, ok := p.assets["any"]; ok {
		return asset, true
	}
	asset, ok := p.assets[runtime.GOOS+"/"+runtime.GOARCH]
	return asset, ok
}

func (p pinnedServer) directory(toolsRoot string) string {
	return filepath.Join(toolsRoot, p.tool+"-"+p.version)
}

func (p pinnedServer) artifact(asset pinnedAsset) toolmanifest.Artifact {
	return toolmanifest.Artifact{Name: asset.name, Version: p.version, URL: p.releaseURL + asset.name, SHA256: asset.sha256}
}

// local is the downloaded file's name: the archive, or the executable itself.
func (p pinnedServer) local(asset pinnedAsset) string {
	if p.binary {
		return asset.program
	}
	if strings.HasSuffix(asset.name, ".zip") {
		return p.tool + ".zip"
	}
	return p.tool + ".tar.gz"
}

// managed is the verified extract folder, or "" when there is none: a folder without a report
// matching the pinned release is never used.
func (p pinnedServer) managed(toolsRoot string) string {
	asset, ok := p.asset()
	if toolsRoot == "" || !ok {
		return ""
	}
	directory := p.directory(toolsRoot)
	report, err := os.ReadFile(filepath.Join(directory, toolmanifest.ReportFile)) // #nosec G304 -- adOmnia tools folder
	if err != nil {
		return ""
	}
	parsed, err := toolmanifest.ParseReport(report)
	if err != nil || parsed.Tool != p.tool || parsed.Version != p.version ||
		len(parsed.Artifacts) != 1 || parsed.Artifacts[0] != p.artifact(asset) {
		return ""
	}
	if toolmanifest.Ensure(filepath.Join(directory, toolmanifest.ManifestFile), p.tool, p.version, parsed.Artifacts, report) != nil {
		return ""
	}
	return filepath.Join(directory, "extract")
}

// command is the server command of a verified install, or ok=false.
func (p pinnedServer) command(toolsRoot string, args []string) (string, []string, bool) {
	extract := p.managed(toolsRoot)
	if extract == "" {
		return "", nil, false
	}
	if p.launch != nil {
		binary, arguments, err := p.launch(extract)
		return binary, arguments, err == nil
	}
	asset, _ := p.asset()
	binary := filepath.Join(extract, filepath.FromSlash(asset.program))
	if info, err := os.Stat(binary); err != nil || info.IsDir() {
		return "", nil, false
	}
	return binary, args, true
}

// installPlan is the one visible command that downloads, verifies and extracts the pinned release.
func (p pinnedServer) installPlan(toolsRoot, languageID, hint string) (lsp.InstallPlan, error) {
	if toolsRoot == "" {
		return lsp.InstallPlan{}, fmt.Errorf("%s", hint)
	}
	asset, ok := p.asset()
	if !ok {
		return lsp.InstallPlan{}, fmt.Errorf("no %s build is published for %s/%s: %s", p.tool, runtime.GOOS, runtime.GOARCH, hint)
	}
	artifact := p.artifact(asset)
	report, err := jsonutil.Marshal(toolmanifest.Report{Tool: p.tool, Version: p.version, Artifacts: []toolmanifest.Artifact{artifact}})
	if err != nil {
		return lsp.InstallPlan{}, err
	}
	directory := p.directory(toolsRoot)
	download := toolmanifest.Download{Directory: directory, Archive: p.local(asset), Binary: p.binary, URL: artifact.URL, SHA256: asset.sha256, Report: string(report)}
	if p.launch == nil {
		download.Executables = []string{asset.program}
	}
	executable, arguments := download.Command()
	return lsp.InstallPlan{
		Task: "install-" + languageID + "-language-server", Title: "Install " + p.tool + "?", Label: "Installing " + p.tool + "…",
		Note: fmt.Sprintf("Downloads %s %s (%s), verifies its SHA-256 and puts it in the adOmnia tools folder (%s), never into your project. Needs network access now; afterwards it works offline. The output appears in the Run console.",
			p.tool, p.version, asset.name, directory),
		Command:    executable + " " + strings.Join(arguments, " "),
		Executable: executable, Arguments: arguments,
		Directory: toolsRoot, Prepare: func() error { return os.MkdirAll(directory, 0o755) },
		Languages: []string{languageID},
	}, nil
}

// exe adds the Windows extension to a program name.
func exe(name string) string {
	if runtime.GOOS == "windows" {
		return name + ".exe"
	}
	return name
}

func github(repository, tag string) string {
	return "https://github.com/" + repository + "/releases/download/" + tag + "/"
}

// Every asset below is pinned to its release and to the SHA-256 GitHub publishes for it.

// clangd (Apache-2.0 with LLVM exception) for C, C++ and Objective-C.
var clangdServer = &pinnedServer{tool: "clangd", version: "23.1.0", releaseURL: github("clangd/clangd", "23.1.0"),
	assets: map[string]pinnedAsset{
		"windows/amd64": {"clangd-windows-23.1.0.zip", "23412a240756a162e7b98a282f36aa2a23a88db5ce16a0cbc4fef7253768c810", "clangd_23.1.0/bin/clangd.exe"},
		"linux/amd64":   {"clangd-linux-23.1.0.zip", "e53b1a96196095faedb7642cf64964f7fb9ad4a0c1f00dd2c172a3d9dcbafdfd", "clangd_23.1.0/bin/clangd"},
		"darwin/amd64":  {"clangd-mac-23.1.0.zip", "1082e6638223b785ca2daf0939f13afcd0bb95c84ee9a4bbaff4745365159253", "clangd_23.1.0/bin/clangd"},
		"darwin/arm64":  {"clangd-mac-23.1.0.zip", "1082e6638223b785ca2daf0939f13afcd0bb95c84ee9a4bbaff4745365159253", "clangd_23.1.0/bin/clangd"},
	}}

// LuaLS (MIT).
var luaServer = &pinnedServer{tool: "lua-language-server", version: "3.19.2", releaseURL: github("LuaLS/lua-language-server", "3.19.2"),
	assets: map[string]pinnedAsset{
		"windows/amd64": {"lua-language-server-3.19.2-win32-x64.zip", "4a3dc851b3b31e7b75a23f645d1ba4a2137579a55f5fa4edbb17a3e2a6254044", "bin/lua-language-server.exe"},
		"linux/amd64":   {"lua-language-server-3.19.2-linux-x64.tar.gz", "93ad326b10f6c00911dd8c450fa098332dbd8f9f45d1052f5636a2d54479b947", "bin/lua-language-server"},
		"linux/arm64":   {"lua-language-server-3.19.2-linux-arm64.tar.gz", "17b8e401a874440adeb649e5024c364f2bb9d15156c74a40e56d1ae9a1b2e4f2", "bin/lua-language-server"},
		"darwin/amd64":  {"lua-language-server-3.19.2-darwin-x64.tar.gz", "6f2174ece5ec63bcd9d5b22b2c902445c1cd9045fafe48c62602448ebf4c09cc", "bin/lua-language-server"},
		"darwin/arm64":  {"lua-language-server-3.19.2-darwin-arm64.tar.gz", "79149584320a23bd5fcd5bc31f47a1975acd8a4560a0e89036bb1016fa61687f", "bin/lua-language-server"},
	}}

// clojure-lsp (MIT), native builds.
var clojureServer = &pinnedServer{tool: "clojure-lsp", version: "2026.10.15-11.42.38", releaseURL: github("clojure-lsp/clojure-lsp", "2026.10.15-11.42.38"),
	assets: map[string]pinnedAsset{
		"windows/amd64": {"clojure-lsp-native-windows-amd64.zip", "63bb6567a2280a563a8de22c3eb833a69159e054b6545a29d25ab588c1b749b1", "clojure-lsp.exe"},
		"linux/amd64":   {"clojure-lsp-native-linux-amd64.zip", "d68acf630465cec9d3685fd958f914d9228d90a07222edd301f1a4740b8e8b76", "clojure-lsp"},
		"linux/arm64":   {"clojure-lsp-native-linux-aarch64.zip", "232ac0cd191070a3b7b5532135ec9f97217b82324de7e97da0b1bf81353a3c94", "clojure-lsp"},
		"darwin/amd64":  {"clojure-lsp-native-macos-amd64.zip", "468c261b48a7276c79cb92a82ddfce5474bc563ba6673df30cabf17a7f239ef3", "clojure-lsp"},
		"darwin/arm64":  {"clojure-lsp-native-macos-aarch64.zip", "84df57e51e27f4ecf20d0cd65aab3296e2ebf28dbaacca4fe216b6cf20485716", "clojure-lsp"},
	}}

// texlab (GPL-3.0) for LaTeX.
var texlabServer = &pinnedServer{tool: "texlab", version: "5.26.0", releaseURL: github("latex-lsp/texlab", "v5.26.0"),
	assets: map[string]pinnedAsset{
		"windows/amd64": {"texlab-x86_64-windows.zip", "cb028d44c3d2b85d36a2ed52d41a0ff43a341b1f04c500c56c4524c4eb72b316", "texlab.exe"},
		"windows/arm64": {"texlab-aarch64-windows.zip", "99b215e9a44169eb8d786c33484b963055e1c3dd40f68e14fcc47ae1c84e92c1", "texlab.exe"},
		"linux/amd64":   {"texlab-x86_64-linux.tar.gz", "8697bd5e479d4584b14b7eed5c320c80ec4e1d91ebefbb6801e6bf38e9971300", "texlab"},
		"linux/arm64":   {"texlab-aarch64-linux.tar.gz", "a85cdfcd22454b8d8550f4b0f0620c45ab51760f302fac7a12bc18a890f70f8c", "texlab"},
		"darwin/amd64":  {"texlab-x86_64-macos.tar.gz", "6091611f756b28e1a57612b130c196df4b0bb6e22dde5cf5d890578513397daf", "texlab"},
		"darwin/arm64":  {"texlab-aarch64-macos.tar.gz", "af7972ffd230711ba04ada9b69cc32ce9111d9196ba69538062872faefdbee56", "texlab"},
	}}

// buf (Apache-2.0) for Protocol Buffers; each asset is the executable itself.
var bufServer = &pinnedServer{tool: "buf", version: "1.75.0", releaseURL: github("bufbuild/buf", "v1.75.0"), binary: true,
	assets: map[string]pinnedAsset{
		"windows/amd64": {"buf-Windows-x86_64.exe", "de35b288e7962ac72aefee5048aff80551a4f0e6ac865a21f838693461ac8b8d", "buf.exe"},
		"windows/arm64": {"buf-Windows-arm64.exe", "57fdfac407c0538707a7d8f7ddc13fcd8770e3c58dcffe7d55e7d8f1804cca61", "buf.exe"},
		"linux/amd64":   {"buf-Linux-x86_64", "fad1e38d6909bbb583a4da81d8c02a01046e2cd663bde7e337dd24277393764b", "buf"},
		"linux/arm64":   {"buf-Linux-aarch64", "00eb190aa82df17f393e05b04889cc60a0b13b3259d336e21a87d5f23ab4fd26", "buf"},
		"darwin/amd64":  {"buf-Darwin-x86_64", "ff6d0979143c661d59178a032c57be883b2ac03dc9bf7d00ffca222b0354bd46", "buf"},
		"darwin/arm64":  {"buf-Darwin-arm64", "f71b009ebd8530b12fd85b060c6c245e15d6e5110ccc8da48d8b6fa71e59330b", "buf"},
	}}

// neocmakelsp (MIT) for CMake.
var cmakeServer = &pinnedServer{tool: "neocmakelsp", version: "0.12.0", releaseURL: github("neocmakelsp/neocmakelsp", "v0.12.0"),
	assets: map[string]pinnedAsset{
		"windows/amd64": {"neocmakelsp-x86_64-pc-windows-msvc.zip", "8abc3cdfa641478e689b70ae474b0eb784b2d4211026398a2fd4fd2a452be8ae", "neocmakelsp.exe"},
		"windows/arm64": {"neocmakelsp-aarch64-pc-windows-msvc.zip", "13eaedccb4706129658be33ecd83bfc2f76d3b3fa5c30f7c3e0b567c58bb5b49", "neocmakelsp.exe"},
		"linux/amd64":   {"neocmakelsp-x86_64-unknown-linux-gnu.tar.gz", "fae7bf87e114b0748fef5aa8c464b8413a2022925a2a61821bae5e2a9a7fdda2", "neocmakelsp"},
		"linux/arm64":   {"neocmakelsp-aarch64-unknown-linux-gnu.tar.gz", "4a2e989b0c2de01452955ac4f7a5de8a82eda5ca2501d3d40272886f3a3726c8", "neocmakelsp"},
		"darwin/amd64":  {"neocmakelsp-universal-apple-darwin.tar.gz", "39d0887ccc4cec0b8c8cf9c42aa5481aad27fa7198cebaabd3e581403f702ff8", "neocmakelsp"},
		"darwin/arm64":  {"neocmakelsp-universal-apple-darwin.tar.gz", "39d0887ccc4cec0b8c8cf9c42aa5481aad27fa7198cebaabd3e581403f702ff8", "neocmakelsp"},
	}}

// marksman (MIT) for Markdown; each asset is the executable itself.
var marksmanServer = &pinnedServer{tool: "marksman", version: "2026-02-08", releaseURL: github("artempyanykh/marksman", "2026-02-08"), binary: true,
	assets: map[string]pinnedAsset{
		"windows/amd64": {"marksman.exe", "a6d05beb08ebe41b0a9f09c98a438540421436fa5531424c22e0bb1d22529705", "marksman.exe"},
		"linux/amd64":   {"marksman-linux-x64", "be5098e8213219269c47fc0d916a66fa31ce0602ec967475c722260aabf26087", "marksman"},
		"linux/arm64":   {"marksman-linux-arm64", "db8e124527f7f8048e3e6c91821b9c52ef173d92c01e47d221bf1337afd962fb", "marksman"},
		"darwin/amd64":  {"marksman-macos", "6a801c17b5ac0dba69787c5282b3b3bd416e66c96253fae098d311c6bbd1833b", "marksman"},
		"darwin/arm64":  {"marksman-macos", "6a801c17b5ac0dba69787c5282b3b3bd416e66c96253fae098d311c6bbd1833b", "marksman"},
	}}

// LemMinX (EPL-2.0) for XML; Red Hat publishes one native build per platform with vscode-xml.
var lemminxServer = &pinnedServer{tool: "lemminx", version: "0.29.3", releaseURL: github("redhat-developer/vscode-xml", "0.29.3"),
	assets: map[string]pinnedAsset{
		"windows/amd64": {"lemminx-win32.zip", "7eaefaac68253b0ec8e0ad1f1c0f2d0755423d4e99e52497428b52f80df28eb7", "lemminx-win32.exe"},
		"linux/amd64":   {"lemminx-linux-x86_64.zip", "1acc44e24201c1d2f5ccb4e43e7426ed0df6909207a81ff199810e2808104d89", "lemminx-linux-x86_64"},
		"linux/arm64":   {"lemminx-linux-aarch_64.zip", "0b88a49e83c2611282672f5123ce33abf1371c8e3c55cad6ee45ea00626ffa1b", "lemminx-linux-aarch_64"},
		"darwin/amd64":  {"lemminx-osx-x86_64.zip", "9e56123194b5c1fdc7d87f1bd21c83cc996ba7be913def3a2836a13305bcd273", "lemminx-osx-x86_64"},
		"darwin/arm64":  {"lemminx-osx-aarch_64.zip", "185db5630ce85be43ea0fab034e7841b1327c2793db05ab481e029cf493d86ce", "lemminx-osx-aarch_64"},
	}}

// PowerShell Editor Services (MIT) is a PowerShell module, not an executable: adOmnia starts its
// Start-EditorServices.ps1 with pwsh (PowerShell 7) or, on Windows, the built-in powershell 5.1.
var powershellEditorServices = &pinnedServer{tool: "PowerShellEditorServices", version: "4.7.0",
	releaseURL: github("PowerShell/PowerShellEditorServices", "v4.7.0"),
	assets:     map[string]pinnedAsset{"any": {"PowerShellEditorServices.zip", "5084f0326cc88539e9d880b08f6c52ce5be4672bb8ecee8921e35f8895a6b9d7", "PowerShellEditorServices/Start-EditorServices.ps1"}},
	launch:     powershellEditorServicesLaunch,
}

func powershellEditorServicesLaunch(extract string) (string, []string, error) {
	script := filepath.Join(extract, "PowerShellEditorServices", "Start-EditorServices.ps1")
	if info, err := os.Stat(script); err != nil || info.IsDir() {
		return "", nil, fmt.Errorf("Start-EditorServices.ps1 is missing from %s", extract)
	}
	host := ""
	for _, candidate := range []string{"pwsh", "powershell"} {
		if binary, err := lookPath(candidate); err == nil {
			host = binary
			break
		}
	}
	if host == "" {
		return "", nil, fmt.Errorf("PowerShell is not on PATH: install PowerShell 7 (pwsh) to use PowerShell Editor Services")
	}
	session := filepath.Join(filepath.Dir(extract), "session")
	quote := func(value string) string { return "'" + strings.ReplaceAll(value, "'", "''") + "'" }
	command := "& " + quote(script) +
		" -BundledModulesPath " + quote(extract) +
		" -LogPath " + quote(filepath.Join(session, "logs")) +
		" -SessionDetailsPath " + quote(filepath.Join(session, "session.json")) +
		" -FeatureFlags @() -AdditionalModules @() -HostName adOmnia -HostProfileId adOmnia -HostVersion 1.0.0 -Stdio -LogLevel Warning"
	// Bypass is scoped to this process: Windows PowerShell 5.1 refuses scripts by default.
	return host, []string{"-NoLogo", "-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-Command", command}, nil
}

// dotnetTool is a .NET global tool installed with `dotnet tool install --tool-path` into adOmnia's
// tools folder at a pinned version, so nothing changes in the user's global .NET tools.
type dotnetTool struct{ name, version string }

func (t dotnetTool) directory(toolsRoot string) string {
	return filepath.Join(toolsRoot, "dotnet-tools", t.name+"-"+t.version)
}

func (t dotnetTool) managed(toolsRoot string) string {
	if toolsRoot == "" {
		return ""
	}
	binary := filepath.Join(t.directory(toolsRoot), exe(t.name))
	if info, err := os.Stat(binary); err != nil || info.IsDir() {
		return ""
	}
	return binary
}

func (t dotnetTool) installPlan(toolsRoot, languageID, hint string) (lsp.InstallPlan, error) {
	if toolsRoot == "" {
		return lsp.InstallPlan{}, fmt.Errorf("%s", hint)
	}
	dotnet, err := lookPath("dotnet")
	if err != nil {
		return lsp.InstallPlan{}, fmt.Errorf("dotnet is not on PATH: install the .NET SDK to install %s", t.name)
	}
	directory := t.directory(toolsRoot)
	arguments := []string{"tool", "install", t.name, "--version", t.version, "--tool-path", directory}
	return lsp.InstallPlan{
		Task: "install-" + languageID + "-language-server", Title: "Install " + t.name + "?", Label: "Installing " + t.name + "…",
		Note: fmt.Sprintf("Installs the %s %s .NET tool from NuGet into the adOmnia tools folder (%s), not into your global .NET tools or your project. The output appears in the Run console.",
			t.name, t.version, directory),
		Command:    "dotnet " + strings.Join(arguments, " "),
		Executable: dotnet, Arguments: arguments,
		Directory: toolsRoot, Prepare: func() error { return os.MkdirAll(filepath.Dir(directory), 0o755) },
		Languages: []string{languageID},
	}, nil
}

var (
	csharpLS       = &dotnetTool{name: "csharp-ls", version: "0.28.0"}
	fsAutocomplete = &dotnetTool{name: "fsautocomplete", version: "0.86.1"}
)
