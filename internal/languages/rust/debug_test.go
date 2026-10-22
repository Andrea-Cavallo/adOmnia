package rust

import (
	"path/filepath"
	"strings"
	"testing"

	"adomnia/internal/ide/dap"
)

func TestParseArtifactPathSelectsFinalExecutable(t *testing.T) {
	output := []byte(`{"reason":"compiler-message","message":{...}}
{"reason":"compiler-artifact","package_id":"mylib","target":{"kind":["lib"]},"filenames":["libmylib.rlib"]}
{"reason":"compiler-artifact","package_id":"mylib","target":{"kind":["bin"],"name":"server"},"executable":"/tmp/proj/target/debug/server"}
{"reason":"build-finished","success":true}
`)
	path, err := parseArtifactPath(output)
	if err != nil || path != "/tmp/proj/target/debug/server" {
		t.Fatalf("path=%q err=%v", path, err)
	}
}

func TestParseArtifactPathWithoutExecutable(t *testing.T) {
	if _, err := parseArtifactPath([]byte(`{"reason":"build-finished","success":true}`)); err == nil {
		t.Fatal("a build without a binary must fail")
	}
}

func TestBuildArtifactPathArguments(t *testing.T) {
	root := t.TempDir()
	writeFile(t, root, "cargo.exe", "")
	original := pathCargo
	pathCargo = func() string { return filepath.Join(root, "cargo.exe") }
	defer func() { pathCargo = original }()

	var gotArgs []string
	originalRun := runCargoBuild
	runCargoBuild = func(cargo, wd string, args []string) ([]byte, error) {
		gotArgs = args
		return []byte(`{"reason":"compiler-artifact","executable":"/tmp/proj/target/debug/server"}`), nil
	}
	defer func() { runCargoBuild = originalRun }()

	path, err := buildArtifactPath(filepath.Join(root, "cargo.exe"), root, DebugOptions{Package: "svc", Bin: "server"})
	if err != nil {
		t.Fatal(err)
	}
	if path != "/tmp/proj/target/debug/server" {
		t.Fatalf("path = %q", path)
	}
	if joined := strings.Join(gotArgs, " "); joined != "build --message-format=json --package svc --bin server" {
		t.Fatalf("args = %q", joined)
	}
}

func TestDebugAdapterBuildsAndLaunches(t *testing.T) {
	root := t.TempDir()
	cargo := writeFile(t, root, "cargo.exe", "")
	codelldb := writeFile(t, root, "codelldb", "")
	originalPath := pathCargo
	pathCargo = func() string { return cargo }
	originalLook := lookPath
	lookPath = func(name string) (string, error) { return codelldb, nil }
	defer func() { pathCargo = originalPath; lookPath = originalLook }()
	originalRun := runCargoBuild
	runCargoBuild = func(string, string, []string) ([]byte, error) {
		return []byte(`{"reason":"compiler-artifact","executable":"/tmp/proj/target/debug/server"}`), nil
	}
	defer func() { runCargoBuild = originalRun }()

	spec, err := New().DebugAdapter(dap.LaunchRequest{
		Root: root, WorkingDirectory: root,
		LanguageOptions: []byte(`{"bin":"server","programArguments":["--port","8080"]}`),
	})
	if err != nil {
		t.Fatal(err)
	}
	if spec.AdapterID != ID || spec.Executable != codelldb || spec.Transport != dap.TCPListen {
		t.Fatalf("spec = %+v", spec)
	}
	if spec.PanicFunction != "rust_panic" {
		t.Fatalf("panic function = %q", spec.PanicFunction)
	}
	method, args := spec.Launch("")
	if method != "launch" || args["type"] != "lldb" || args["program"] != "/tmp/proj/target/debug/server" {
		t.Fatalf("launch = %q %+v", method, args)
	}
}

func TestDebugAdapterRejectsMissingTarget(t *testing.T) {
	root := t.TempDir()
	writeFile(t, root, "cargo.exe", "")
	original := pathCargo
	pathCargo = func() string { return filepath.Join(root, "cargo.exe") }
	defer func() { pathCargo = original }()

	if _, err := New().DebugAdapter(dap.LaunchRequest{Root: root, WorkingDirectory: root, LanguageOptions: []byte(`{}`)}); err == nil {
		t.Fatal("a debug request without a bin or example must fail")
	}
}
