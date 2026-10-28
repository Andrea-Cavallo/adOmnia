package rust

import (
	"fmt"
	"os/exec"
	"path/filepath"
	"strings"

	"github.com/Andrea-Cavallo/adOmnia/internal/ide/lsp"
	"github.com/Andrea-Cavallo/adOmnia/internal/ide/sdk"
)

// rust-analyzer è il language server Rust. La fonte preferita è il componente rustup
// (`rustup component add rust-analyzer`), allineato alla toolchain dell'unità; il binario standalone
// è l'alternativa quando la toolchain non è rustup. Il binario nel PATH (lo shim rustup o
// un'installazione standalone) copre entrambi i casi: nessun download silenzioso (RS-4.1).
const (
	rustAnalyzerName        = "rust-analyzer"
	rustAnalyzerInstallTask = "install-rust-language-server"
)

// lookPath è sostituibile nei test.
var lookPath = exec.LookPath

// LocateServer implementa lsp.ServerProvider: il rust-analyzer della toolchain/PATH. Un server
// mancante non è fatale: l'editor continua con le funzioni di Monaco, e la UI offre "Install…".
func (*Language) LocateServer(root, toolsRoot string) lsp.ServerInfo {
	info := lsp.ServerInfo{Language: ID, Name: rustAnalyzerName}
	if binary, err := lookPath(sdk.ExecutableName(rustAnalyzerName)); err == nil && hasFile(binary) {
		info.Available, info.Binary, info.Source = true, binary, "PATH"
		return info
	}
	info.Error = "rust-analyzer is not installed: install it from the editor notice, or run `rustup component add rust-analyzer`"
	return info
}

// ServersPerUnit implementa language.UnitServers: rust-analyzer lavora per workspace Cargo, quindi
// un server per unità (un solo server per un cargo-workspace con tutti i membri), non per progetto
// (RS-4.2).
func (*Language) ServersPerUnit() bool { return true }

// ServerSpec è il fallback per il server non-per-unità: usa la radice come unità.
func (l *Language) ServerSpec(root, toolsRoot string) (lsp.ServerSpec, error) {
	return l.UnitServerSpec(root, root, toolsRoot)
}

// UnitServerSpec costruisce la spec del server per un'unità Cargo. rust-analyzer avvia in stdio e
// riceve la sola cartella dell'unità come workspace; la configurazione arriva a ogni richiesta.
func (l *Language) UnitServerSpec(projectRoot, unitRoot, toolsRoot string) (lsp.ServerSpec, error) {
	info := l.LocateServer(unitRoot, toolsRoot)
	if !info.Available {
		return lsp.ServerSpec{}, fmt.Errorf("%s", info.Error)
	}
	targetDir := rustAnalyzerTargetDir(projectRoot)
	return lsp.ServerSpec{
		Language: ID, Name: info.Name, Binary: info.Binary,
		// Rivalutata a ogni richiesta: l'opzione "Low resources" cambia senza riavviare il server.
		Configuration:    func() any { return rustAnalyzerSettings(targetDir, ProjectLowResources(projectRoot)) },
		WatchesFile:      watchesRustFile,
		TraceEnvironment: []string{"RUSTUP_HOME", "CARGO_HOME", "RUSTUP_TOOLCHAIN"},
	}, nil
}

// rustAnalyzerSettings è la configurazione servita a workspace/configuration (RS-4.3): i default
// sensati per un editor. `targetDir` separato dall'utente è RS-9.2: rust-analyzer e la Run non
// condividono più `target/`, quindi nessun `Blocking waiting for file lock`. Con `lowResources`
// proc-macro e build script restano spenti (RS-9.5): sono la parte più pesante di rust-analyzer
// (build.rs e proc-macro eseguono codice del progetto) e spegnerli non tocca l'editor né la Run.
func rustAnalyzerSettings(targetDir string, lowResources bool) any {
	cargo := map[string]any{
		"buildScripts": map[string]any{"enable": !lowResources},
	}
	if targetDir != "" {
		cargo["targetDir"] = targetDir
	}
	return map[string]any{
		"rust-analyzer": map[string]any{
			"cargo": cargo,
			"check": map[string]any{
				"command": "check",
			},
			"procMacro": map[string]any{
				"enable": !lowResources,
			},
		},
	}
}

// watchesRustFile dice quali file cambiati su disco interessano il server: manifest Cargo, sorgenti
// e il rust-toolchain (che cambia la toolchain del progetto).
func watchesRustFile(path string) bool {
	base := strings.ToLower(filepath.Base(path))
	switch base {
	case "cargo.toml", "cargo.lock", "rust-toolchain.toml", "rust-toolchain", ".cargo":
		return true
	}
	if strings.HasSuffix(base, ".rs") {
		return true
	}
	// .cargo/config.toml cambia alias, env e target-dir del progetto.
	return strings.HasSuffix(filepath.ToSlash(path), ".cargo/config.toml")
}

// InstallPlan installa rust-analyzer con un solo comando visibile: `rustup component add
// rust-analyzer`, allineato alla toolchain. Nessun `rustup update`/`default` implicito (RS-4.1).
func (*Language) InstallPlan(toolsRoot string) (lsp.InstallPlan, error) {
	if _, err := lookPath(sdk.ExecutableName("rustup")); err != nil {
		return lsp.InstallPlan{}, fmt.Errorf("rustup is required to install rust-analyzer: install Rust (https://rustup.rs) and try again")
	}
	command := sdk.ExecutableName("rustup") + " component add rust-analyzer"
	return lsp.InstallPlan{
		Task:       rustAnalyzerInstallTask,
		Title:      "Install the Rust language server?",
		Label:      "Installing rust-analyzer",
		Note:       "Installs the rust-analyzer component for the active toolchain via rustup. Needs network access now; afterwards rust-analyzer works offline.",
		Command:    command,
		Executable: sdk.ExecutableName("rustup"),
		Arguments:  []string{"component", "add", "rust-analyzer"},
		Languages:  []string{ID},
	}, nil
}
