package rust

import (
	"errors"
	"os"
	"path/filepath"
	"runtime"
	"slices"
	"strconv"
	"strings"
	"testing"

	idetesting "github.com/Andrea-Cavallo/adOmnia/internal/ide/testing"
)

// L'elenco di `rustup toolchain list` ha il suffisso ` (default)` e la forma completa della tripla:
// il canale dichiarato dal progetto è solo il prefisso (RS-2.1).
func TestParseToolchainListAndChannelMatch(t *testing.T) {
	installed := parseToolchainList(`stable-x86_64-pc-windows-msvc (active, default)
1.75.0-x86_64-pc-windows-msvc
nightly-2026-01-01-x86_64-apple-darwin

`)
	if len(installed) != 3 || installed[0] != "stable-x86_64-pc-windows-msvc" {
		t.Fatalf("installed = %v", installed)
	}
	for channel, want := range map[string]bool{
		"stable":           true,
		"1.75.0":           true,
		"nightly":          true, // nightly-2026-01-01 è un nightly: il prefisso con trattino combacia
		"1.76.0":           false,
		"sta":              false, // un prefisso senza trattino non è il canale
		"stable-x86_64-pc": true,  // un canale dichiarato con la tripla resta un prefisso
	} {
		if got := channelInstalled(channel, installed); got != want {
			t.Fatalf("channelInstalled(%q) = %v, want %v", channel, got, want)
		}
	}
	// `stable` non deve combaciare con un canale che comincia per "stable" senza trattino.
	if channelInstalled("stable", []string{"stablex-x86_64-pc-windows-msvc"}) {
		t.Fatal("a channel must not match a longer name without the dash")
	}
}

// Un canale dichiarato e non installato è uno stato esplicito con il comando, non un download.
func TestMarkMissingChannelsExplainsTheInstallCommand(t *testing.T) {
	original := rustupToolchainList
	rustupToolchainList = func() ([]string, error) {
		return []string{"stable-x86_64-pc-windows-msvc"}, nil
	}
	defer func() { rustupToolchainList = original }()

	toolchains := MarkMissingChannels([]Toolchain{
		{Cargo: "cargo", Channel: "stable", Source: "project"},
		{Cargo: "cargo", Channel: "1.75.0", Source: "project"},
		{Cargo: "cargo", Channel: "", Source: "saved"},
		{Channel: "1.74.0", Source: "project", Problem: "no cargo in PATH"},
	})
	if toolchains[0].Problem != "" {
		t.Fatalf("an installed channel must stay clean: %+v", toolchains[0])
	}
	problem := toolchains[1].Problem
	if !strings.Contains(problem, "1.75.0") || !strings.Contains(problem, "toolchain install 1.75.0") {
		t.Fatalf("missing channel problem = %q", problem)
	}
	if toolchains[2].Problem != "" {
		t.Fatalf("a toolchain without a channel must stay clean: %+v", toolchains[2])
	}
	// Un problema precedente (canale senza cargo) non viene sovrascritto: resta la causa vera.
	if toolchains[3].Problem != "no cargo in PATH" {
		t.Fatalf("an existing problem was overwritten: %q", toolchains[3].Problem)
	}
}

// Se rustup non risponde non si inventa uno stato "mancante": i candidati restano come sono.
func TestMarkMissingChannelsWithoutRustupKeepsCandidates(t *testing.T) {
	original := rustupToolchainList
	rustupToolchainList = func() ([]string, error) { return nil, errors.New("rustup is not installed") }
	defer func() { rustupToolchainList = original }()

	toolchains := MarkMissingChannels([]Toolchain{{Cargo: "cargo", Channel: "1.75.0", Source: "project"}})
	if toolchains[0].Problem != "" {
		t.Fatalf("a missing rustup must not invent a problem: %+v", toolchains[0])
	}
}

// RUSTUP_AUTO_INSTALL=0 impedisce a rustup di scaricare la toolchain alla prima invocazione
// (RS-2.1); una scelta esplicita dell'utente resta.
func TestRustupEnvironmentDisablesAutoInstall(t *testing.T) {
	env := rustupEnvironment([]string{"PATH=x"})
	if len(env) != 2 || env[1] != "RUSTUP_AUTO_INSTALL=0" {
		t.Fatalf("env = %v", env)
	}
	// I nomi delle variabili sono case-insensitive solo su Windows.
	kept := rustupEnvironment([]string{"rustup_auto_install=1"})
	want := 2
	if runtime.GOOS == "windows" {
		want = 1
	}
	if len(kept) != want {
		t.Fatalf("the user choice was overwritten on %s: %v", runtime.GOOS, kept)
	}
}

// RUSTUP_TOOLCHAIN è un candidato quando il progetto non dichiara un canale; il progetto vince
// (RS-2.1).
func TestDiscoverToolchainsReadsRustupToolchainOverride(t *testing.T) {
	originalPathCargo := pathCargo
	pathCargo = func() string { return filepath.Join(t.TempDir(), "cargo") }
	defer func() { pathCargo = originalPathCargo }()
	t.Setenv("RUSTUP_TOOLCHAIN", "1.90.0")

	root := t.TempDir()
	found := DiscoverToolchains(root, root)
	if len(found) != 1 || found[0].Channel != "1.90.0" || found[0].Source != "RUSTUP_TOOLCHAIN" {
		t.Fatalf("candidates = %+v", found)
	}

	writeFile(t, root, "rust-toolchain.toml", "[toolchain]\nchannel = \"1.80.0\"\n")
	found = DiscoverToolchains(root, root)
	if len(found) != 1 || found[0].Channel != "1.80.0" || found[0].Source != "project" {
		t.Fatalf("the project must win over RUSTUP_TOOLCHAIN: %+v", found)
	}
}

// Senza override e senza canale di progetto il candidato resta il cargo del PATH (RS-2.1).
func TestDiscoverToolchainsWithoutChannelAndWithoutOverride(t *testing.T) {
	originalPathCargo := pathCargo
	pathCargo = func() string { return filepath.Join(t.TempDir(), "cargo") }
	defer func() { pathCargo = originalPathCargo }()
	if err := os.Unsetenv("RUSTUP_TOOLCHAIN"); err != nil {
		t.Fatal(err)
	}
	root := t.TempDir()
	found := DiscoverToolchains(root, root)
	if len(found) != 1 || found[0].Channel != "" || found[0].Source != "PATH" {
		t.Fatalf("candidates = %+v", found)
	}
}

// `cargo test` usa lo stesso canale della Run e non lascia che rustup scarichi una toolchain
// mancante (RS-0.2, RS-2.1).
func TestTestCommandPinsTheProjectChannel(t *testing.T) {
	root := t.TempDir()
	writeFile(t, root, "rust-toolchain.toml", "[toolchain]\nchannel = \"1.80.0\"\n")
	cargo := writeFile(t, root, "cargo.exe", "")
	options := `{"toolchain":` + strconv.Quote(cargo) + `}`
	spec, _, err := New().TestCommand(idetesting.Request{Root: root, WorkingDirectory: root, LanguageOptions: []byte(options)})
	if err != nil {
		t.Fatal(err)
	}
	if !slices.Contains(spec.Environment, "RUSTUP_TOOLCHAIN=1.80.0") {
		t.Fatalf("the test command does not pin the project channel: %v", spec.Environment)
	}
	if !slices.Contains(spec.Environment, "RUSTUP_AUTO_INSTALL=0") {
		t.Fatalf("the test command allows an implicit download: %v", spec.Environment)
	}
}
