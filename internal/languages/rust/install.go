package rust

import (
	"fmt"
	"regexp"
	"strings"

	"adomnia/internal/ide/lsp"
	"adomnia/internal/ide/sdk"
)

var (
	componentName = regexp.MustCompile(`^[A-Za-z0-9][A-Za-z0-9_-]*$`)
	// channelName accetta stable/beta/nightly, versioni complete o parziali e nightly datate
	// ("nightly-2024-01-01"), ma rifiuta path e metacaratteri di shell.
	channelName = regexp.MustCompile(`^[A-Za-z0-9][A-Za-z0-9.-]*$`)
)

// ComponentInstallPlan è l'installazione di un componente rustup come comando visibile e
// confermato (RS-2.3): `rustup component add <component>`. Nessun `rustup update`/`default`
// implicito, nessun download silenzioso.
func (*Language) ComponentInstallPlan(component string) (lsp.InstallPlan, error) {
	if !componentName.MatchString(component) {
		return lsp.InstallPlan{}, fmt.Errorf("enter a valid rustup component name")
	}
	return rustupInstallPlan("install-rust-component-"+component, "Install the Rust component?", "Installing "+component,
		[]string{"component", "add", component})
}

// ToolchainInstallPlan è l'installazione di un canale rustup (RS-2.3): `rustup toolchain install
// <channel>`. Non cambia mai il default della macchina senza conferma.
func (*Language) ToolchainInstallPlan(channel string) (lsp.InstallPlan, error) {
	if !channelName.MatchString(channel) {
		return lsp.InstallPlan{}, fmt.Errorf("enter a valid toolchain (stable, nightly or a version like 1.85.0)")
	}
	return rustupInstallPlan("install-rust-toolchain", "Install the Rust toolchain?", "Installing toolchain "+channel,
		[]string{"toolchain", "install", channel})
}

func rustupInstallPlan(task, title, label string, arguments []string) (lsp.InstallPlan, error) {
	if _, err := lookPath(sdk.ExecutableName("rustup")); err != nil {
		return lsp.InstallPlan{}, fmt.Errorf("rustup is required to install Rust toolchains and components: install Rust (https://rustup.rs) and try again")
	}
	command := sdk.ExecutableName("rustup") + " " + strings.Join(arguments, " ")
	return lsp.InstallPlan{
		Task:       task,
		Title:      title,
		Label:      label,
		Note:       "Installs via rustup for the active toolchain. Needs network access now; afterwards it works offline. The default toolchain is never changed without your confirmation.",
		Command:    command,
		Executable: sdk.ExecutableName("rustup"),
		Arguments:  arguments,
		Languages:  []string{ID},
	}, nil
}
