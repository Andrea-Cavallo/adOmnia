package rust

import (
	"context"
	"fmt"
	"io"
	"strings"

	"github.com/Andrea-Cavallo/adOmnia/internal/ide/process"
	"github.com/Andrea-Cavallo/adOmnia/internal/ide/sdk"
	"github.com/Andrea-Cavallo/adOmnia/internal/procutil"
)

// Canali installati (RS-2.1). Un `rust-toolchain.toml` che chiede un canale non installato è uno
// stato "mancante" con un'azione esplicita, mai un download implicito: rustup, invocato con un
// override di canale assente, scaricherebbe la toolchain da solo alla prima chiamata
// (RUSTUP_AUTO_INSTALL). Qui il canale si controlla **prima**, leggendo `rustup toolchain list`.

// rustupToolchainList è il probe dei canali installati; sostituibile nei test.
var rustupToolchainList = readInstalledChannels

// readInstalledChannels esegue `rustup toolchain list`. Come il probe di rustc, un rustup bloccato
// esce con il timeout e l'albero di processi viene terminato.
func readInstalledChannels() ([]string, error) {
	ctx, cancel := context.WithTimeout(context.Background(), toolchainProbeTimeout)
	defer cancel()
	command := procutil.CommandContext(ctx, sdk.ExecutableName("rustup"), "toolchain", "list")
	process.Configure(command, false)
	stdout, err := command.StdoutPipe()
	if err != nil {
		return nil, err
	}
	if err := command.Start(); err != nil {
		return nil, err
	}
	output := make(chan []byte, 1)
	go func() {
		data, _ := io.ReadAll(stdout)
		output <- data
	}()
	select {
	case data := <-output:
		if err := command.Wait(); err != nil {
			return nil, err
		}
		return parseToolchainList(string(data)), nil
	case <-ctx.Done():
		_ = process.TerminateTree(command)
		go func() { <-output; _ = command.Wait() }()
		return nil, fmt.Errorf("rustup does not answer a toolchain list probe")
	}
}

// parseToolchainList legge le righe di `rustup toolchain list`:
//
//	stable-x86_64-pc-windows-msvc (default)
//	1.75.0-x86_64-pc-windows-msvc
//	nightly-2026-01-01-x86_64-apple-darwin
//
// Il suffisso ` (default)` e gli spazi non contano.
func parseToolchainList(output string) []string {
	var channels []string
	for line := range strings.SplitSeq(output, "\n") {
		line = strings.TrimSpace(line)
		if line == "" {
			continue
		}
		name, _, _ := strings.Cut(line, " ")
		if name != "" {
			channels = append(channels, name)
		}
	}
	return channels
}

// channelInstalled dice se un canale dichiarato è fra quelli installati. rustup elenca la forma
// completa (`1.75.0-x86_64-pc-windows-msvc`), mentre `rust-toolchain.toml` dichiara solo il canale
// (`1.75.0`): il prefisso con trattino è la corrispondenza corretta, `stable` non deve combaciare
// con `stablex`.
func channelInstalled(channel string, installed []string) bool {
	for _, candidate := range installed {
		if candidate == channel || strings.HasPrefix(candidate, channel+"-") {
			return true
		}
	}
	return false
}

// ToolchainInstallAction è il comando da mostrare quando manca il canale: l'unica azione ammessa.
func ToolchainInstallAction(channel string) string {
	return sdk.ExecutableName("rustup") + " toolchain install " + channel
}

// MarkMissingChannels segna i candidati il cui canale dichiarato non è installato (RS-2.1) con il
// motivo e il comando esplicito. Chiamarla solo con il progetto autorizzato: esegue rustup. Se
// l'elenco non è leggibile (rustup assente o lento) i candidati restano come sono, senza inventare
// uno stato.
func MarkMissingChannels(toolchains []Toolchain) []Toolchain {
	if len(toolchains) == 0 {
		return toolchains
	}
	installed, err := rustupToolchainList()
	if err != nil {
		return toolchains
	}
	for index := range toolchains {
		channel := toolchains[index].Channel
		if channel == "" || toolchains[index].Problem != "" || channelInstalled(channel, installed) {
			continue
		}
		toolchains[index].Problem = fmt.Sprintf("the %s toolchain is not installed: run `%s`", channel, ToolchainInstallAction(channel))
	}
	return toolchains
}

// rustupEnvironment aggiunge RUSTUP_AUTO_INSTALL=0 (RS-2.1): rustup non deve scaricare una toolchain
// mancante durante una Run, un test o una build di debug. Un valore scelto dall'utente resta.
func rustupEnvironment(environment []string) []string {
	out := append([]string(nil), environment...)
	if hasEnvironment(out, "RUSTUP_AUTO_INSTALL") {
		return out
	}
	return append(out, "RUSTUP_AUTO_INSTALL=0")
}
