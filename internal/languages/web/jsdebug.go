package web

import (
	"fmt"
	"os"
	"path/filepath"
	"strings"

	"runtime"

	"github.com/Andrea-Cavallo/adOmnia/internal/ide/lsp"
	"github.com/Andrea-Cavallo/adOmnia/internal/ide/toolmanifest"
	"github.com/Andrea-Cavallo/adOmnia/internal/jsonutil"
)

// js-debug è il debug adapter DAP ufficiale di VS Code per JavaScript e TypeScript
// (github.com/microsoft/vscode-js-debug, MIT). La release e la SHA-256 sono pinnate, come per
// CodeLLDB (RS-9.4): l'installazione scarica solo l'artefatto verificato nella cartella strumenti
// di adOmnia, mai nel progetto e mai per iniziativa silenziosa.
const (
	jsDebugName        = "js-debug"
	jsDebugVersion     = "v1.140.0"
	jsDebugInstallTask = "install-web-debugger"
	jsDebugAsset       = "js-debug-dap-v1.140.0.tar.gz"
	jsDebugSHA256      = "27dab92937ec1ab35821ae955aac867544fe06a1b6307229049f2d789af10968"
	// jsDebugServer è il server DAP dentro l'artefatto: si avvia con Node e parla DAP su una porta
	// di loopback scelta da noi (come debugpy e CodeLLDB).
	jsDebugServer = "src/dapDebugServer.js"
)

func jsDebugDirectory(toolsRoot string) string {
	return filepath.Join(toolsRoot, "js-debug-"+jsDebugVersion)
}

// managedJSDebug è il percorso del server DAP nell'installazione gestita.
func managedJSDebug(toolsRoot string) string {
	return filepath.Join(jsDebugDirectory(toolsRoot), "js-debug", filepath.FromSlash(jsDebugServer))
}

// jsDebugAssetURL è l'URL della release pinnata: lo usano il piano di installazione e la verifica,
// così il report non può dichiarare una fonte diversa.
func jsDebugAssetURL() string {
	return "https://github.com/microsoft/vscode-js-debug/releases/download/" + jsDebugVersion + "/" + jsDebugAsset
}

func jsDebugArtifact() toolmanifest.Artifact {
	return toolmanifest.Artifact{
		Name: jsDebugAsset, Version: jsDebugVersion,
		URL: jsDebugAssetURL(), SHA256: jsDebugSHA256,
	}
}

// jsDebugReport è il report di installazione nel formato generico (toolmanifest.Report): lo scrive
// il comando di installazione dopo aver verificato la SHA-256 dell'artefatto scaricato.
func jsDebugReport() ([]byte, error) {
	return jsonutil.Marshal(toolmanifest.Report{
		Tool: jsDebugName, Version: jsDebugVersion, Artifacts: []toolmanifest.Artifact{jsDebugArtifact()},
	})
}

// verifyManagedJSDebug controlla che l'adapter gestito sia quello installato e verificato: report
// leggibile, artefatto uguale alla release pinnata, manifest generico uguale al report. Senza
// report l'installazione non è verificabile: si reinstalla dal notice dell'editor, mai in silenzio.
func verifyManagedJSDebug(toolsRoot string) error {
	directory := jsDebugDirectory(toolsRoot)
	report, err := os.ReadFile(filepath.Join(directory, toolmanifest.ReportFile))
	if err != nil {
		return fmt.Errorf("the installed js-debug has no verification report (%s): reinstall it from the editor notice", toolmanifest.ReportFile)
	}
	parsed, err := toolmanifest.ParseReport(report)
	if err != nil {
		return fmt.Errorf("the installed js-debug is not verified: %w. Reinstall it from the editor notice", err)
	}
	expected := jsDebugArtifact()
	if parsed.Tool != jsDebugName || parsed.Version != jsDebugVersion || len(parsed.Artifacts) != 1 || parsed.Artifacts[0] != expected {
		return fmt.Errorf("the installed js-debug does not match the pinned %s release: reinstall it from the editor notice", jsDebugVersion)
	}
	if !isFile(managedJSDebug(toolsRoot)) {
		return fmt.Errorf("the installed js-debug has no DAP server (%s): reinstall it from the editor notice", jsDebugServer)
	}
	return toolmanifest.Ensure(filepath.Join(directory, toolmanifest.ManifestFile), jsDebugName, jsDebugVersion, parsed.Artifacts, report)
}

// LocateJSDebug restituisce il server DAP dell'installazione gestita, "" se manca. warning spiega
// perché un'installazione presente non si usa (report o manifest che non tornano). js-debug non è
// distribuito come comando di sistema: non c'è nulla da cercare nel PATH.
func LocateJSDebug(toolsRoot string) (server, source string, warning error) {
	if toolsRoot == "" {
		return "", "", nil
	}
	path := managedJSDebug(toolsRoot)
	if !isFile(path) {
		return "", "", nil
	}
	if err := verifyManagedJSDebug(toolsRoot); err != nil {
		return "", "", err
	}
	return path, "adOmnia tools", nil
}

// JSDebugInstallPlan è il comando visibile che scarica la release pinnata, ne verifica la SHA-256
// ed estrae il server DAP in `<tools>/js-debug-<versione>`. Nessun comando globale, nessuna
// modifica del progetto o dell'ambiente Node dell'utente.
func JSDebugInstallPlan(toolsRoot string) (lsp.InstallPlan, error) {
	if toolsRoot == "" {
		return lsp.InstallPlan{}, fmt.Errorf("adOmnia tools folder not configured")
	}
	directory := jsDebugDirectory(toolsRoot)
	report, err := jsDebugReport()
	if err != nil {
		return lsp.InstallPlan{}, err
	}
	executable, arguments := jsDebugInstallCommand(directory, jsDebugAssetURL(), jsDebugSHA256, string(report))
	return lsp.InstallPlan{
		Task:       jsDebugInstallTask,
		Title:      "Install the JavaScript debugger?",
		Label:      "Installing js-debug",
		Note:       fmt.Sprintf("Downloads js-debug %s (%s), verifies its SHA-256 and extracts it into the adOmnia tools folder (%s), never into your project. It needs Node.js on the PATH and network access now; afterwards debugging works offline.", jsDebugVersion, jsDebugAsset, directory),
		Command:    executable + " " + strings.Join(arguments, " "),
		Executable: executable,
		Arguments:  arguments,
		Directory:  toolsRoot,
		Prepare:    func() error { return os.MkdirAll(directory, 0o755) },
		Languages:  []string{ScriptID},
	}, nil
}

// jsDebugInstallCommand prepara il download, il checksum e l'estrazione con gli strumenti del
// sistema: PowerShell su Windows (Windows 10 1803+ include tar.exe), sh + curl + sha256sum altrove.
func jsDebugInstallCommand(directory, url, sha256, report string) (string, []string) {
	if runtime.GOOS == "windows" {
		quote := func(value string) string { return "'" + strings.ReplaceAll(value, "'", "''") + "'" }
		script := "$ErrorActionPreference='Stop'; $d=" + quote(directory) + "; $f=Join-Path $d 'js-debug.tar.gz'; " +
			"Invoke-WebRequest -UseBasicParsing " + quote(url) + " -OutFile $f; " +
			"if ((Get-FileHash $f -Algorithm SHA256).Hash.ToLower() -ne '" + sha256 + "') { Remove-Item $f; throw 'SHA-256 mismatch: the download was discarded' }; " +
			"$e=Join-Path $d 'extract'; New-Item -ItemType Directory -Force -Path $e | Out-Null; tar -xzf $f -C $e; Remove-Item $f; " +
			"Set-Content -LiteralPath (Join-Path $d " + quote(toolmanifest.ReportFile) + ") -Value " + quote(report)
		return "powershell.exe", []string{"-NoProfile", "-NonInteractive", "-Command", script}
	}
	quote := func(value string) string { return "'" + strings.ReplaceAll(value, "'", `'\''`) + "'" }
	check := "sha256sum -c -"
	if runtime.GOOS == "darwin" {
		check = "shasum -a 256 -c -"
	}
	script := "set -e; d=" + quote(directory) + "; mkdir -p \"$d\"; curl -fsSL " + quote(url) + " -o \"$d/js-debug.tar.gz\"; " +
		"echo '" + sha256 + "  '\"$d/js-debug.tar.gz\" | " + check + "; " +
		"mkdir -p \"$d/extract\"; tar -xzf \"$d/js-debug.tar.gz\" -C \"$d/extract\"; rm -f \"$d/js-debug.tar.gz\"; " +
		"printf '%s' " + quote(report) + " >\"$d/" + toolmanifest.ReportFile + "\""
	return "sh", []string{"-c", script}
}
