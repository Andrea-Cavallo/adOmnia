package rust

import (
	"os"
	"path/filepath"
	"runtime"
	"strings"
	"testing"
)

func TestToolchainChannelReadsTomlAndLegacy(t *testing.T) {
	root := t.TempDir()
	writeFile(t, root, "rust-toolchain.toml", "[toolchain]\nchannel = \"1.85.0\"\ncomponents = [\"clippy\"]\n")
	if got := ToolchainChannel(root, root); got != "1.85.0" {
		t.Fatalf("channel = %q", got)
	}
	legacy := t.TempDir()
	writeFile(t, legacy, "rust-toolchain", "stable\n")
	if got := ToolchainChannel(legacy, legacy); got != "stable" {
		t.Fatalf("legacy channel = %q", got)
	}
}

func TestToolchainChannelWalksAncestors(t *testing.T) {
	root := t.TempDir()
	writeFile(t, root, "rust-toolchain.toml", "[toolchain]\nchannel = \"1.84.0\"\n")
	unit := filepath.Join(root, "crates", "api")
	if err := os.MkdirAll(unit, 0o755); err != nil {
		t.Fatal(err)
	}
	if got := ToolchainChannel(root, unit); got != "1.84.0" {
		t.Fatalf("channel from ancestor = %q", got)
	}
}

func TestParseRustcVerbose(t *testing.T) {
	host, version, err := parseRustcVerbose(`rustc 1.85.0 (4d91de4e4 2025-02-17)
binary: rustc
commit-hash: 4d91de4e4
host: x86_64-pc-windows-msvc
release: 1.85.0
LLVM version: 19.1.7
`)
	if err != nil || host != "x86_64-pc-windows-msvc" || version != "1.85.0" {
		t.Fatalf("host=%q version=%q err=%v", host, version, err)
	}
	// MSVC only matters on a Windows machine: elsewhere the helper is false by design.
	if windowsHostUsesMSVC(host) != (runtime.GOOS == "windows") || windowsHostUsesMSVC("x86_64-unknown-linux-gnu") {
		t.Fatal("MSVC detection wrong")
	}
}

func TestResolveToolchainPrefersSavedThenPath(t *testing.T) {
	root := t.TempDir()
	unit := filepath.Join(root, "crates", "app")
	if err := os.MkdirAll(unit, 0o755); err != nil {
		t.Fatal(err)
	}
	saved := writeFile(t, root, "custom-cargo.exe", "")
	original := pathCargo
	pathCargo = func() string { return filepath.Join(root, "path-cargo.exe") }
	defer func() { pathCargo = original }()

	found, err := ResolveToolchain(root, unit, "")
	if err != nil || !strings.HasSuffix(found.Cargo, "path-cargo.exe") || found.Source != "PATH" {
		t.Fatalf("%+v %v", found, err)
	}
	if err := SetProjectToolchain(root, unit, saved); err != nil {
		t.Fatal(err)
	}
	found, err = ResolveToolchain(root, unit, "")
	if err != nil || found.Cargo != filepath.Clean(saved) || found.Source != "saved" {
		t.Fatalf("%+v %v", found, err)
	}
	if _, err := ResolveToolchain(root, unit, filepath.Join(root, "other.exe")); err == nil {
		t.Fatal("an explicit non-existent cargo must fail")
	}
}

func TestSetProjectToolchainRoundTrip(t *testing.T) {
	root := t.TempDir()
	unit := filepath.Join(root, "crates", "app")
	if err := os.MkdirAll(unit, 0o755); err != nil {
		t.Fatal(err)
	}
	cargo := writeFile(t, root, "cargo.exe", "")
	if err := SetProjectToolchain(root, unit, cargo); err != nil {
		t.Fatal(err)
	}
	if ProjectToolchain(root, unit) != cargo {
		t.Fatal("per-unit selection not persisted")
	}
	if err := SetProjectToolchain(root, unit, ""); err != nil {
		t.Fatal(err)
	}
	if ProjectToolchain(root, unit) != "" {
		t.Fatal("cleared selection still present")
	}
}
