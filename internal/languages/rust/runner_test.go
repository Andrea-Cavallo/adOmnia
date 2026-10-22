package rust

import (
	"encoding/json"
	"os"
	"path/filepath"
	"runtime"
	"slices"
	"strconv"
	"strings"
	"testing"

	"adomnia/internal/ide/run"
)

func TestCargoArguments(t *testing.T) {
	got := cargoArguments("bin", Options{Package: "svc", Bin: "server", Features: []string{"tls", "http2"}, Profile: "release", Target: "x86_64-unknown-linux-gnu"})
	if joined := strings.Join(got, " "); joined != "run --message-format=json-diagnostic-rendered-ansi --package svc --bin server --features tls,http2 --profile release --target x86_64-unknown-linux-gnu" {
		t.Fatalf("bin args = %q", joined)
	}
	if joined := strings.Join(cargoArguments("build", Options{AllFeatures: true}), " "); joined != "build --message-format=json-diagnostic-rendered-ansi --all-features" {
		t.Fatalf("build args = %q", joined)
	}
	if joined := strings.Join(cargoArguments("check", Options{NoDefaultFeatures: true, Features: []string{"a"}}), " "); joined != "check --message-format=json-diagnostic-rendered-ansi --no-default-features --features a" {
		t.Fatalf("check args = %q", joined)
	}
}

func TestOptionsValidation(t *testing.T) {
	if _, err := optionsFor("bin", json.RawMessage(`{"bin":"server"}`)); err != nil {
		t.Fatalf("valid bin rejected: %v", err)
	}
	if _, err := optionsFor("example", json.RawMessage(`{"example":"demo"}`)); err != nil {
		t.Fatalf("valid example rejected: %v", err)
	}
	for _, bad := range []string{
		`{"bin":"not a name"}`,
		`{"allFeatures":true,"noDefaultFeatures":true}`,
		`{"features":["bad name"]}`,
		`{"profile":"with space"}`,
	} {
		if _, err := optionsFor("bin", json.RawMessage(bad)); err == nil {
			t.Fatalf("invalid options accepted: %s", bad)
		}
	}
	if _, err := optionsFor("nope", json.RawMessage(`{}`)); err == nil {
		t.Fatal("unknown kind accepted")
	}
}

func TestCommandSpecBuildsCargoRun(t *testing.T) {
	root := t.TempDir()
	writeFile(t, root, "cargo.exe", "")
	original := pathCargo
	pathCargo = func() string { return filepath.Join(root, "cargo.exe") }
	defer func() { pathCargo = original }()

	spec, err := New().CommandSpec(run.Request{
		Kind:             "bin",
		Root:             root,
		WorkingDirectory: root,
		LanguageOptions:  json.RawMessage(`{"bin":"server"}`),
		ProgramArguments: []string{"--port", "8080"},
	})
	if err != nil {
		t.Fatal(err)
	}
	if spec.Executable != filepath.Join(root, "cargo.exe") {
		t.Fatalf("executable = %q", spec.Executable)
	}
	if joined := strings.Join(spec.Arguments, " "); joined != "run --message-format=json-diagnostic-rendered-ansi --bin server -- --port 8080" {
		t.Fatalf("arguments = %q", joined)
	}
}

func TestRunSchemaCoversKinds(t *testing.T) {
	language := New()
	for _, kind := range language.RunKinds() {
		schema := language.RunSchema(kind)
		if schema.Language != ID || schema.Kind != kind {
			t.Fatalf("schema = %+v", schema)
		}
		if len(schema.Fields) == 0 {
			t.Fatalf("kind %s has no fields", kind)
		}
	}
}

func TestSuggestProposesBinsAndBuild(t *testing.T) {
	root := t.TempDir()
	writeFile(t, root, "Cargo.toml", "[package]\nname = \"app\"\n\n[[bin]]\nname = \"server\"\n\n[[example]]\nname = \"demo\"\n")
	writeFile(t, root, "src/main.rs", "fn main() {}\n")
	units, _ := New().DetectUnits(t.Context(), root)
	if len(units) != 1 {
		t.Fatalf("units = %+v", units)
	}
	titles := map[string]bool{}
	for _, s := range New().Suggest(t.Context(), root, units[0]) {
		titles[s.Title] = true
		if s.Language != ID || s.Action == "" || s.ID == "" {
			t.Fatalf("incomplete suggestion: %+v", s)
		}
	}
	for _, want := range []string{"Rust · cargo run --bin server", "Rust · cargo run --example demo", "Rust · cargo build", "Rust · cargo check"} {
		if !titles[want] {
			t.Fatalf("missing %q in %#v", want, titles)
		}
	}
}

func TestSuggestImplicitMainBin(t *testing.T) {
	root := t.TempDir()
	writeFile(t, root, "Cargo.toml", "[package]\nname = \"hello\"\n")
	writeFile(t, root, "src/main.rs", "fn main() {}\n")
	units, _ := New().DetectUnits(t.Context(), root)
	titles := []string{}
	for _, s := range New().Suggest(t.Context(), root, units[0]) {
		titles = append(titles, s.Title)
	}
	if len(titles) == 0 || titles[0] != "Rust · cargo run --bin hello" {
		t.Fatalf("implicit main bin not proposed: %#v", titles)
	}
}

func TestCommandSpecPinsProjectChannelAndKeepsExplicitEnvironment(t *testing.T) {
	root := t.TempDir()
	if err := os.WriteFile(filepath.Join(root, "rust-toolchain.toml"), []byte("[toolchain]\nchannel = \"1.80.0\"\n"), 0o644); err != nil {
		t.Fatal(err)
	}
	cargo := filepath.Join(root, "cargo")
	if runtime.GOOS == "windows" {
		cargo += ".exe"
	}
	if err := os.WriteFile(cargo, []byte("x"), 0o755); err != nil {
		t.Fatal(err)
	}
	request := run.Request{Kind: "build", Root: root, WorkingDirectory: root, LanguageOptions: []byte(`{"toolchain":` + strconv.Quote(cargo) + `}`)}
	spec, err := New().CommandSpec(request)
	if err != nil || !slices.Contains(spec.Environment, "RUSTUP_TOOLCHAIN=1.80.0") {
		t.Fatalf("env = %v, err = %v", spec.Environment, err)
	}
	request.Environment = []string{"rustup_toolchain=nightly"}
	spec, _ = New().CommandSpec(request)
	if len(spec.Environment) != 1 {
		t.Fatalf("user RUSTUP_TOOLCHAIN overridden: %v", spec.Environment)
	}
}
