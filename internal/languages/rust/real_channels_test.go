package rust

import (
	"os/exec"
	"strings"
	"testing"
)

// Con rustup vero: l'elenco dei canali si legge davvero e un canale assente produce il comando di
// installazione (RS-2.1). Opt-in come gli altri test con gli strumenti reali.
func TestRealRustupToolchainListAndMissingChannel(t *testing.T) {
	if _, err := exec.LookPath("rustup"); err != nil {
		t.Skip("rustup is not installed (set up Rust to run this check)")
	}
	installed, err := readInstalledChannels()
	if err != nil {
		t.Fatalf("rustup toolchain list failed: %v", err)
	}
	if len(installed) == 0 {
		t.Fatal("no toolchain installed for this user: the machine needs at least one channel")
	}
	for _, channel := range installed {
		// Le righe reali sono `stable-x86_64-pc-windows-msvc (active, default)`: il suffisso non
		// deve finire nel nome del canale.
		if strings.ContainsAny(channel, " \t()") {
			t.Fatalf("the toolchain name kept its suffix: %q", channel)
		}
	}
	// Il canale installato non è "mancante"; uno inventato sì, con il comando esplicito.
	declared := make([]Toolchain, 0, len(installed))
	for _, channel := range installed {
		declared = append(declared, Toolchain{Cargo: "cargo", Channel: channel, Source: "project"})
	}
	for _, toolchain := range MarkMissingChannels(declared) {
		if toolchain.Problem != "" {
			t.Fatalf("an installed channel was reported as missing: %+v", toolchain)
		}
	}
	missing := MarkMissingChannels([]Toolchain{{Cargo: "cargo", Channel: "0.0.0-adomnia-not-installed", Source: "project"}})
	if len(missing) != 1 || !strings.Contains(missing[0].Problem, "toolchain install 0.0.0-adomnia-not-installed") {
		t.Fatalf("missing channel = %+v", missing)
	}
}
