package rust

import (
	"path/filepath"
	"testing"
)

func TestRustEnvironmentOf(t *testing.T) {
	root := t.TempDir()
	writeFile(t, root, ".cargo/config.toml", `
[alias]
b = "build"

[env]
RUST_LOG = "debug"

[build]
target-dir = "custom-target"

[target.x86_64-pc-windows-msvc]
runner = "my-runner"
linker = "lld"
`)
	t.Setenv("CARGO_HOME", "/opt/cargo")
	t.Setenv("RUSTUP_HOME", "/opt/rustup")
	t.Setenv("RUSTFLAGS", "-C target-cpu=native")

	env := RustEnvironmentOf(root)
	if env.CargoHome != "/opt/cargo" || env.RustupHome != "/opt/rustup" || env.RustFlags != "-C target-cpu=native" {
		t.Fatalf("env vars = %+v", env)
	}
	if env.Aliases["b"] != "build" {
		t.Fatalf("aliases = %#v", env.Aliases)
	}
	if env.Env["RUST_LOG"] != "debug" {
		t.Fatalf("env = %#v", env.Env)
	}
	if env.Targets["x86_64-pc-windows-msvc"].Runner != "my-runner" || env.Targets["x86_64-pc-windows-msvc"].Linker != "lld" {
		t.Fatalf("targets = %#v", env.Targets)
	}
}

func TestCargoTargetDirPrecedence(t *testing.T) {
	root := t.TempDir()
	writeFile(t, root, ".cargo/config.toml", "[build]\ntarget-dir = \"config-dir\"\n")

	// config.toml da solo.
	if dir := cargoTargetDir(root); dir != "config-dir" {
		t.Fatalf("config target-dir = %q", dir)
	}
	// CARGO_TARGET_DIR ha la precedenza sul config.toml.
	t.Setenv("CARGO_TARGET_DIR", "env-dir")
	if dir := cargoTargetDir(root); dir != "env-dir" {
		t.Fatalf("env target-dir = %q", dir)
	}
}

func TestCargoTargetDirDefault(t *testing.T) {
	if dir := cargoTargetDir(t.TempDir()); dir != "" {
		t.Fatalf("default target-dir must be empty, got %q", dir)
	}
}

func TestRustAnalyzerTargetDirRespectsEnv(t *testing.T) {
	t.Setenv("CARGO_TARGET_DIR", "user-dir")
	if dir := rustAnalyzerTargetDir(t.TempDir()); dir != "user-dir" {
		t.Fatalf("rustAnalyzerTargetDir must respect CARGO_TARGET_DIR, got %q", dir)
	}
}

func TestRustAnalyzerTargetDirIsDedicated(t *testing.T) {
	root := t.TempDir()
	dir := rustAnalyzerTargetDir(root)
	if dir == "" {
		t.Fatal("dedicated target dir must not be empty")
	}
	// Sotto la cache, separato dal target/ del progetto e stabile per lo stesso percorso.
	if filepath.Base(dir) == "target" {
		t.Fatalf("dedicated dir must not be the project target/, got %q", dir)
	}
	if again := rustAnalyzerTargetDir(root); again != dir {
		t.Fatalf("target dir must be stable: %q != %q", again, dir)
	}
}
