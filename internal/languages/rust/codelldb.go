package rust

import (
	"fmt"
	"os"
	"path/filepath"
	"runtime"
	"strconv"
	"strings"

	"adomnia/internal/ide/lsp"
	"adomnia/internal/ide/sdk"
	"adomnia/internal/ide/toolmanifest"
	"adomnia/internal/jsonutil"
)

// CodeLLDB è il debug adapter DAP di Rust (LLDB incluso). Release e checksum sono pinnati (RS-0.2/
// RS-9.4): l'installazione scarica solo l'artefatto verificato nella cartella strumenti di adOmnia.
// Il comando di installazione scrive il report (`toolmanifest.ReportFile`) e la verifica lega la
// cartella al manifest generico (internal/ide/toolmanifest, lo stesso di basedpyright): un'installazione
// senza report o modificata dopo l'installazione non viene usata.
const (
	codeLLDBName        = "codelldb"
	codeLLDBVersion     = "v1.12.3"
	codeLLDBInstallTask = "install-rust-debugger"
)

type codeLLDBAsset struct{ name, sha256 string }

// codeLLDBAssets: asset della release v1.12.3 per piattaforma (digest dalla pagina della release).
var codeLLDBAssets = map[string]codeLLDBAsset{
	"windows/amd64": {"codelldb-win32-x64.vsix", "a916e509308dac817732f63ca604a8b93ed29cd16f38a2fa9f0b64ed58e8f51a"},
	"linux/amd64":   {"codelldb-linux-x64.vsix", "1cd7f386598022b51a5b93b9ffa23e812b23f519cfe1833384ec4bef4bfd1be1"},
	"darwin/arm64":  {"codelldb-darwin-arm64.vsix", "2f114a990e1b368dd1dbd33c80c0e719767af2d228391ec0df0571c957f9ac91"},
	"darwin/amd64":  {"codelldb-darwin-x64.vsix", "e25cc716b94c62c07fec268ff2785d2b797245b160502baef8b9c970a0c4d8e8"},
}

func codeLLDBDirectory(toolsRoot string) string {
	return filepath.Join(toolsRoot, "codelldb-"+codeLLDBVersion)
}

func managedCodeLLDB(toolsRoot string) string {
	return filepath.Join(codeLLDBDirectory(toolsRoot), "extract", "extension", "adapter", sdk.ExecutableName(codeLLDBName))
}

// codeLLDBAssetURL è l'URL della release pinnata per l'asset dato: lo usano il piano di
// installazione e la verifica, così il report non può dichiarare una fonte diversa.
func codeLLDBAssetURL(assetName string) string {
	return "https://github.com/vadimcn/codelldb/releases/download/" + codeLLDBVersion + "/" + assetName
}

// codeLLDBReport è il report di installazione nel formato generico (toolmanifest.Report): lo
// scrive il comando di installazione dopo aver verificato lo SHA-256 dell'artefatto scaricato.
func codeLLDBReport(asset codeLLDBAsset) ([]byte, error) {
	return jsonutil.Marshal(toolmanifest.Report{
		Tool:    codeLLDBName,
		Version: codeLLDBVersion,
		Artifacts: []toolmanifest.Artifact{{
			Name: asset.name, Version: codeLLDBVersion,
			URL: codeLLDBAssetURL(asset.name), SHA256: strings.ToLower(asset.sha256),
		}},
	})
}

// verifyManagedCodeLLDB controlla che l'adapter gestito sia quello installato e verificato:
// report leggibile, artefatto uguale alla release pinnata per questa piattaforma, manifest generico
// uguale al report (internal/ide/toolmanifest). Un'installazione senza report non è verificabile:
// si reinstalla dal notice dell'editor, mai in silenzio.
func verifyManagedCodeLLDB(toolsRoot string) error {
	directory := codeLLDBDirectory(toolsRoot)
	report, err := os.ReadFile(filepath.Join(directory, toolmanifest.ReportFile))
	if err != nil {
		return fmt.Errorf("the installed CodeLLDB has no verification report (%s): reinstall it from the editor notice", toolmanifest.ReportFile)
	}
	parsed, err := toolmanifest.ParseReport(report)
	if err != nil {
		return fmt.Errorf("the installed CodeLLDB is not verified: %w. Reinstall it from the editor notice", err)
	}
	asset, pinned := codeLLDBAssets[runtime.GOOS+"/"+runtime.GOARCH]
	if !pinned {
		return fmt.Errorf("no CodeLLDB build is pinned for %s/%s: install CodeLLDB manually and put it on the PATH", runtime.GOOS, runtime.GOARCH)
	}
	expected := toolmanifest.Artifact{
		Name: asset.name, Version: codeLLDBVersion,
		URL: codeLLDBAssetURL(asset.name), SHA256: strings.ToLower(asset.sha256),
	}
	if parsed.Tool != codeLLDBName || parsed.Version != codeLLDBVersion || len(parsed.Artifacts) != 1 || parsed.Artifacts[0] != expected {
		return fmt.Errorf("the installed CodeLLDB does not match the pinned %s release: reinstall it from the editor notice", codeLLDBVersion)
	}
	if !hasFile(managedCodeLLDB(toolsRoot)) {
		return fmt.Errorf("the installed CodeLLDB has no adapter binary: reinstall it from the editor notice")
	}
	return toolmanifest.Ensure(filepath.Join(directory, toolmanifest.ManifestFile), codeLLDBName, codeLLDBVersion, parsed.Artifacts, report)
}

// LocateCodeLLDB cerca l'adapter: installazione gestita da adOmnia (solo se verificata dal
// manifest, RS-9.4), PATH, estensione CodeLLDB di VS Code già presente. Restituisce percorso e
// origine, "" se manca; warning (se presente) spiega perché l'installazione gestita non si usa.
func LocateCodeLLDB(toolsRoot string) (binary, source string, warning error) {
	if toolsRoot != "" {
		if path := managedCodeLLDB(toolsRoot); hasFile(path) {
			if err := verifyManagedCodeLLDB(toolsRoot); err != nil {
				warning = err
			} else {
				return path, "adOmnia tools", nil
			}
		}
	}
	if path, err := lookPath(sdk.ExecutableName(codeLLDBName)); err == nil && hasFile(path) {
		return path, "PATH", warning
	}
	if home, err := os.UserHomeDir(); err == nil {
		matches, _ := filepath.Glob(filepath.Join(home, ".vscode", "extensions", "vadimcn.vscode-lldb-*", "adapter", sdk.ExecutableName(codeLLDBName)))
		if path := newestCodeLLDB(matches); path != "" {
			return path, "VS Code extension", warning
		}
	}
	return "", "", warning
}

// newestCodeLLDB sceglie l'estensione con la versione più alta: 1.10 vince su 1.9, mentre
// l'ordine lessicale dei glob direbbe il contrario.
func newestCodeLLDB(matches []string) string {
	best, bestVersion := "", []int(nil)
	for _, match := range matches {
		if !hasFile(match) {
			continue
		}
		version := codeLLDBVersionOf(match)
		if best == "" || versionGreater(version, bestVersion) {
			best, bestVersion = match, version
		}
	}
	return best
}

// codeLLDBVersionOf legge la versione numerica dalla cartella dell'estensione
// (`vadimcn.vscode-lldb-1.10.2/adapter/codelldb` → [1 10 2]).
func codeLLDBVersionOf(path string) []int {
	base := filepath.Base(filepath.Dir(filepath.Dir(path)))
	base = strings.TrimPrefix(base, "vadimcn.vscode-lldb-")
	var version []int
	for _, part := range strings.Split(base, ".") {
		number, err := strconv.Atoi(part)
		if err != nil {
			break
		}
		version = append(version, number)
	}
	return version
}

func versionGreater(left, right []int) bool {
	for i := 0; i < len(left) || i < len(right); i++ {
		x, y := 0, 0
		if i < len(left) {
			x = left[i]
		}
		if i < len(right) {
			y = right[i]
		}
		if x != y {
			return x > y
		}
	}
	return false
}

// CodeLLDBInstallPlan è il comando visibile che scarica la release pinnata, ne verifica lo SHA-256
// ed estrae l'adapter in `<tools>/codelldb-<versione>`. Nessun comando globale, nessuna modifica del
// progetto o delle toolchain dell'utente.
func CodeLLDBInstallPlan(toolsRoot string) (lsp.InstallPlan, error) {
	asset, ok := codeLLDBAssets[runtime.GOOS+"/"+runtime.GOARCH]
	if !ok {
		return lsp.InstallPlan{}, fmt.Errorf("no CodeLLDB build is pinned for %s/%s: install CodeLLDB manually and put it on the PATH", runtime.GOOS, runtime.GOARCH)
	}
	directory := codeLLDBDirectory(toolsRoot)
	url := codeLLDBAssetURL(asset.name)
	report, err := codeLLDBReport(asset)
	if err != nil {
		return lsp.InstallPlan{}, err
	}
	executable, arguments := codeLLDBInstallCommand(directory, url, asset.sha256, string(report))
	return lsp.InstallPlan{
		Task:       codeLLDBInstallTask,
		Title:      "Install the Rust debugger?",
		Label:      "Installing CodeLLDB",
		Note:       fmt.Sprintf("Downloads CodeLLDB %s (%s), verifies its SHA-256 and extracts it into the adOmnia tools folder (%s), never into your project or toolchains. Needs network access now; afterwards debugging works offline.", codeLLDBVersion, asset.name, directory),
		Command:    executable + " " + strings.Join(arguments, " "),
		Executable: executable,
		Arguments:  arguments,
		Directory:  toolsRoot,
		Prepare:    func() error { return os.MkdirAll(directory, 0o755) },
		Languages:  []string{ID},
	}, nil
}

func codeLLDBInstallCommand(directory, url, sha256, report string) (string, []string) {
	// Dopo il checksum riuscito il comando scrive il report di installazione (RS-9.4): è la
	// provenienza che la verifica confronta con il manifest generico.
	if runtime.GOOS == "windows" {
		quote := func(value string) string { return "'" + strings.ReplaceAll(value, "'", "''") + "'" }
		script := "$ErrorActionPreference='Stop'; $d=" + quote(directory) + "; $f=Join-Path $d 'codelldb.zip'; " +
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
	script := "set -e; d=" + quote(directory) + "; mkdir -p \"$d\"; curl -fsSL " + quote(url) + " -o \"$d/codelldb.zip\"; " +
		"echo '" + sha256 + "  '\"$d/codelldb.zip\" | " + check + "; " +
		"unzip -oq \"$d/codelldb.zip\" -d \"$d/extract\"; rm -f \"$d/codelldb.zip\"; chmod +x \"$d/extract/extension/adapter/codelldb\"; " +
		"printf '%s' " + quote(report) + " >\"$d/" + toolmanifest.ReportFile + "\""
	return "sh", []string{"-c", script}
}
