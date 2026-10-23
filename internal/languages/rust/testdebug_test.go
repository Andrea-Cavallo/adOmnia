package rust

import (
	"os/exec"
	"path/filepath"
	"strings"
	"testing"

	"adomnia/internal/ide/dap"
)

// TestTestTargetSelection: il target di test si sceglie dal sorgente o dal nome, un solo target →
// un solo eseguibile da far girare a CodeLLDB (RS-5.5, mai indovinare percorso, RS-6.2).
func TestTestTargetSelection(t *testing.T) {
	root := t.TempDir()
	writeFile(t, root, "src/lib.rs", "")
	writeFile(t, root, "src/main.rs", "fn main() {}\n")
	writeFile(t, root, "Cargo.toml", "[package]\nname = \"demo\"\nversion = \"0.1.0\"\n")

	cases := []struct {
		name, file, testName string
		want                 []string
	}{
		{"integration file", "tests/foo.rs", "tests/foo.rs/it_works", []string{"--test", "foo"}},
		{"integration by name", "", "tests/foo.rs/it_works", []string{"--test", "foo"}},
		{"bin source", "src/bin/tool.rs", "tests::runs", []string{"--bin", "tool"}},
		{"nested bin source", "src/bin/tool/main.rs", "tests::runs", []string{"--bin", "tool"}},
		{"main source", "src/main.rs", "tests::runs", []string{"--bin", "demo"}},
		{"lib module", "src/handlers/user.rs", "handlers::user::tests::creates", []string{"--lib"}},
		{"unit test without file", "", "tests::it_works", []string{"--lib"}},
	}
	for _, testCase := range cases {
		got, err := testTargetSelection(testCase.testName, testCase.file, root)
		if err != nil {
			t.Fatalf("%s: %v", testCase.name, err)
		}
		if strings.Join(got, " ") != strings.Join(testCase.want, " ") {
			t.Errorf("%s: selection = %v, want %v", testCase.name, got, testCase.want)
		}
	}

	// Package solo-bin: senza lib gli unit test stanno nel binario del package.
	binOnly := t.TempDir()
	writeFile(t, binOnly, "src/main.rs", "fn main() {}\n")
	writeFile(t, binOnly, "Cargo.toml", "[package]\nname = \"solo\"\nversion = \"0.1.0\"\n")
	if got, err := testTargetSelection("tests::it_works", "", binOnly); err != nil || strings.Join(got, " ") != "--bin solo" {
		t.Fatalf("bin-only package: %v %v", got, err)
	}

	// I doctest non hanno eseguibile compilato: non si debuggano (limite dichiarato).
	if _, err := testTargetSelection("src/lib.rs - parse (line 12)", "src/lib.rs", root); err == nil || !strings.Contains(err.Error(), "doc tests") {
		t.Fatalf("doctests must be refused, got %v", err)
	}
}

func TestParseTestArtifactPathNeedsASingleTestBinary(t *testing.T) {
	// Dipendenze e proc-macro non sono binari di test: solo `profile.test`.
	output := strings.Join([]string{
		`{"reason":"compiler-artifact","executable":"/deps/proc","profile":{"test":false}}`,
		`{"reason":"compiler-artifact","executable":null,"profile":{"test":true}}`,
		`{"reason":"compiler-artifact","executable":"/target/debug/deps/demo-123","profile":{"test":true}}`,
	}, "\n")
	if got, err := parseTestArtifactPath([]byte(output)); err != nil || got != "/target/debug/deps/demo-123" {
		t.Fatalf("artifact = %q, %v", got, err)
	}

	two := output + "\n" + `{"reason":"compiler-artifact","executable":"/other","profile":{"test":true}}`
	if _, err := parseTestArtifactPath([]byte(two)); err == nil {
		t.Fatal("two test binaries must be refused: the target must be unambiguous")
	}
	if _, err := parseTestArtifactPath([]byte(`{"reason":"compiler-artifact","executable":"/bin","profile":{"test":false}}`)); err == nil {
		t.Fatal("no test binary must be an error")
	}
}

// TestTestDebugArtifactBuildsOnlyTheChosenTest: `cargo test --no-run` con la selezione del target e
// il filtro libtest dopo `--exact`, gli argomenti di build come la Run.
func TestTestDebugArtifactBuildsOnlyTheChosenTest(t *testing.T) {
	root := t.TempDir()
	original := runCargoBuild
	var got []string
	runCargoBuild = func(_, _ string, args []string) ([]byte, error) {
		got = args
		return []byte(`{"reason":"compiler-artifact","executable":"/target/debug/deps/demo-123","profile":{"test":true}}`), nil
	}
	defer func() { runCargoBuild = original }()

	artifact, libtestArguments, err := testDebugArtifact("cargo", root, DebugOptions{
		Test: "tests/foo.rs/it_works", TestFile: "tests/foo.rs",
		Features: []string{"serde"}, Profile: "dev",
	})
	if err != nil {
		t.Fatal(err)
	}
	if artifact != "/target/debug/deps/demo-123" {
		t.Fatalf("artifact = %q", artifact)
	}
	if strings.Join(libtestArguments, " ") != "--exact it_works" {
		t.Fatalf("libtest arguments = %v", libtestArguments)
	}
	want := "test --no-run --message-format=json --test foo --features serde --profile dev"
	if strings.Join(got, " ") != want {
		t.Fatalf("cargo arguments = %q, want %q", strings.Join(got, " "), want)
	}
}

// TestDebugAdapterLaunchesTheTestBinary: con Test valorizzato il programma è l'eseguibile del test
// e gli argomenti sono il filtro di libtest, non quelli del programma (RS-5.5).
func TestDebugAdapterLaunchesTheTestBinary(t *testing.T) {
	root := t.TempDir()
	cargo := writeFile(t, root, "cargo.exe", "")
	codelldb := writeFile(t, root, "codelldb", "")
	writeFile(t, root, "src/lib.rs", "")
	originalPath, originalLook := pathCargo, lookPath
	pathCargo = func() string { return cargo }
	lookPath = func(string) (string, error) { return codelldb, nil }
	defer func() { pathCargo, lookPath = originalPath, originalLook }()
	originalRun := runCargoBuild
	runCargoBuild = func(_, _ string, args []string) ([]byte, error) {
		if strings.Join(args, " ") != "test --no-run --message-format=json --lib" {
			t.Fatalf("cargo arguments = %v", args)
		}
		return []byte(`{"reason":"compiler-artifact","executable":"/target/debug/deps/demo-123","profile":{"test":true}}`), nil
	}
	defer func() { runCargoBuild = originalRun }()

	spec, err := New().DebugAdapter(dap.LaunchRequest{
		Root: root, WorkingDirectory: root,
		LanguageOptions: []byte(`{"test":"tests::it_works"}`),
	})
	if err != nil {
		t.Fatal(err)
	}
	if spec.Title != "Debug test tests::it_works" {
		t.Fatalf("title = %q", spec.Title)
	}
	method, args := spec.Launch("")
	if method != "launch" || args["program"] != "/target/debug/deps/demo-123" {
		t.Fatalf("launch = %q %+v", method, args)
	}
	launchArgs, _ := args["args"].([]string)
	if strings.Join(launchArgs, " ") != "--exact tests::it_works" {
		t.Fatalf("test binary arguments = %v", launchArgs)
	}
}

func TestDebugAdapterRejectsFlagLikeTestNames(t *testing.T) {
	root := t.TempDir()
	writeFile(t, root, "cargo.exe", "")
	original := pathCargo
	pathCargo = func() string { return filepath.Join(root, "cargo.exe") }
	defer func() { pathCargo = original }()

	for _, bad := range []string{`{"test":"--nocapture"}`, "{\"test\":\"a\\nb\"}"} {
		if _, err := New().DebugAdapter(dap.LaunchRequest{Root: root, WorkingDirectory: root, LanguageOptions: []byte(bad)}); err == nil {
			t.Fatalf("test name %q must be refused", bad)
		}
	}
}

// TestRealCargoTestDebugBuildsTheTestBinary compila davvero l'eseguibile del test
// (`cargo test --no-run`) e lo esegue con il filtro `--exact`: è ciò che CodeLLDB avvia (RS-5.5,
// opt-in come gli altri test reali).
func TestRealCargoTestDebugBuildsTheTestBinary(t *testing.T) {
	requireRealCargo(t)
	if _, err := exec.LookPath("cargo"); err != nil {
		t.Skip("cargo is not installed (set up Rust to run this check)")
	}
	root := t.TempDir()
	writeFile(t, root, "Cargo.toml", "[package]\nname = \"demo\"\nversion = \"0.1.0\"\nedition = \"2021\"\n")
	writeFile(t, root, "src/lib.rs", "#[cfg(test)]\nmod tests {\n    #[test]\n    fn hit() {}\n    #[test]\n    fn other() {}\n}\n")

	artifact, arguments, err := testDebugArtifact("cargo", root, DebugOptions{Test: "tests/hit"})
	if err != nil {
		t.Fatal(err)
	}
	if !hasFile(artifact) {
		t.Fatalf("the test binary does not exist: %s", artifact)
	}
	if strings.Join(arguments, " ") != "--exact tests::hit" {
		t.Fatalf("libtest arguments = %v", arguments)
	}
	output, err := exec.Command(artifact, arguments...).CombinedOutput()
	if err != nil {
		t.Fatalf("the test binary failed: %v\n%s", err, output)
	}
	if !strings.Contains(string(output), "1 passed") || strings.Contains(string(output), "2 passed") {
		t.Fatalf("the filter must run that single test, got:\n%s", output)
	}
}
