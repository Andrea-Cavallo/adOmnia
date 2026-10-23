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

// RS-6.5: il debug Rust resta su loopback con una porta riservata nota, lancia il programma (mai
// attach a pid o a host remoti) e la porta dell'indirizzo è quella passata a CodeLLDB. Il cleanup
// del processo/adapter e il timeout di avvio endpoint sono del core DAP (debugDisconnectTimeout,
// debugAddressTimeout, i loro test in dap/manager_test.go).
func TestDebugAdapterIsLoopbackOnlyAndNeverAttaches(t *testing.T) {
	root := t.TempDir()
	cargo := writeFile(t, root, "cargo.exe", "")
	codelldb := writeFile(t, root, "codelldb", "")
	originalPath := pathCargo
	pathCargo = func() string { return cargo }
	originalLook := lookPath
	lookPath = func(string) (string, error) { return codelldb, nil }
	defer func() { pathCargo = originalPath; lookPath = originalLook }()
	originalRun := runCargoBuild
	runCargoBuild = func(string, string, []string) ([]byte, error) {
		return []byte(`{"reason":"compiler-artifact","executable":"/tmp/proj/target/debug/server"}`), nil
	}
	defer func() { runCargoBuild = originalRun }()

	spec, err := New().DebugAdapter(dap.LaunchRequest{
		Root: root, WorkingDirectory: root,
		LanguageOptions: []byte(`{"bin":"server"}`),
	})
	if err != nil {
		t.Fatal(err)
	}
	if !strings.HasPrefix(spec.Address, "127.0.0.1:") {
		t.Fatalf("the DAP endpoint must be loopback-only, got %q", spec.Address)
	}
	if len(spec.Arguments) != 2 || spec.Arguments[0] != "--port" || !strings.HasSuffix(spec.Address, spec.Arguments[1]) {
		t.Fatalf("the adapter must listen on the reserved loopback port: address %q args %v", spec.Address, spec.Arguments)
	}
	method, args := spec.Launch("")
	if method != "launch" || args["request"] != "launch" {
		t.Fatalf("Rust debug launches the program and never attaches: %q %+v", method, args)
	}
	if args["processId"] != nil || args["program"] == nil {
		t.Fatalf("no pid attach, a program is launched: %+v", args)
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

func TestDebugAdapterRejectsFlagLikeNames(t *testing.T) {
	root := t.TempDir()
	if _, err := New().DebugAdapter(dap.LaunchRequest{Root: root, WorkingDirectory: root, LanguageOptions: []byte(`{"bin":"--manifest-path"}`)}); err == nil {
		t.Fatal("a flag-like binary name must be rejected")
	}
}

func TestBuildArtifactPathPassesFeaturesProfileTarget(t *testing.T) {
	var got []string
	original := runCargoBuild
	runCargoBuild = func(_, _ string, args []string) ([]byte, error) {
		got = args
		return []byte(`{"reason":"compiler-artifact","executable":"/x/server"}`), nil
	}
	defer func() { runCargoBuild = original }()
	_, err := buildArtifactPath("cargo", ".", DebugOptions{Bin: "server", Features: []string{"tls"}, Profile: "release", Target: "x86_64-unknown-linux-gnu"})
	if err != nil || strings.Join(got, " ") != "build --message-format=json --bin server --features tls --profile release --target x86_64-unknown-linux-gnu" {
		t.Fatalf("args = %v err = %v", got, err)
	}
}

func TestCodeLLDBInstallPlanVerifiesChecksum(t *testing.T) {
	plan, err := CodeLLDBInstallPlan(t.TempDir())
	if err != nil {
		t.Skip("no pinned CodeLLDB build for this platform")
	}
	if !strings.Contains(plan.Command, "SHA256") && !strings.Contains(plan.Command, "sha256") && !strings.Contains(plan.Command, "shasum") {
		t.Fatalf("install command must verify the checksum: %s", plan.Command)
	}
	if plan.Prepare == nil || len(plan.Arguments) == 0 {
		t.Fatalf("incomplete plan: %+v", plan)
	}
}

func TestDefaultBinaryFromImplicitMain(t *testing.T) {
	root := t.TempDir()
	writeFile(t, root, "Cargo.toml", "[package]\nname = \"svc\"\nversion = \"0.1.0\"\n")
	if got := DefaultBinary(root); got != "" {
		t.Fatalf("without src/main.rs there is no default binary, got %q", got)
	}
	writeFile(t, root, "src/main.rs", "fn main() {}\n")
	if got := DefaultBinary(root); got != "svc" {
		t.Fatalf("default binary = %q", got)
	}
}
