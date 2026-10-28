package rust

import (
	"encoding/json/v2"
	"fmt"
	"path/filepath"
	"strings"

	"github.com/Andrea-Cavallo/adOmnia/internal/ide/run"
)

// Debug dei test Rust (RS-5.5): `cargo test --no-run --message-format=json` compila il solo target
// di test scelto e ne estrae l'eseguibile dai messaggi `compiler-artifact` (mai indovinando
// `target/debug/deps/…`, RS-6.2); CodeLLDB avvia quel binario con il filtro `--exact` di libtest.

// testDebugArtifact compila l'eseguibile del test e restituisce percorso e argomenti di libtest per
// eseguire quel solo test (o quel modulo). I doctest non hanno eseguibile compilato: non si
// debuggano (limite dichiarato).
func testDebugArtifact(cargo, workingDirectory string, options DebugOptions) (string, []string, error) {
	selection, err := testTargetSelection(options.Test, options.TestFile, workingDirectory)
	if err != nil {
		return "", nil, err
	}
	filter, exact := libtestFilter(options.Test)
	libtestArguments := []string{}
	if exact {
		libtestArguments = append(libtestArguments, "--exact")
	}
	libtestArguments = append(libtestArguments, filter)

	arguments := []string{"test", "--no-run", "--message-format=json"}
	arguments = append(arguments, selection...)
	if options.Package != "" {
		arguments = append(arguments, "--package", options.Package)
	}
	arguments = append(arguments, featureArguments(Options{Features: options.Features, AllFeatures: options.AllFeatures, NoDefaultFeatures: options.NoDefaultFeatures})...)
	if options.Profile != "" {
		arguments = append(arguments, "--profile", options.Profile)
	}
	if options.Target != "" {
		arguments = append(arguments, "--target", options.Target)
	}
	if err := run.CheckBatchSafe(cargo, arguments); err != nil {
		return "", nil, err
	}
	output, err := runCargoBuild(cargo, workingDirectory, arguments)
	if err != nil {
		return "", nil, fmt.Errorf("building the test binary failed: %w", err)
	}
	artifact, err := parseTestArtifactPath(output)
	if err != nil {
		return "", nil, err
	}
	return artifact, libtestArguments, nil
}

// testTargetSelection è la selezione del target di test per `cargo test --no-run`: un solo target
// significa un solo eseguibile, quindi l'artefatto non si indovina. Il sorgente del test
// (`TestFile`) decide: `tests/<stem>.rs` → il target di integrazione, `src/bin/<n>.rs` → il bin,
// il resto di `src/` → il lib (o il bin per i package solo-bin). Senza `TestFile` si risale dal
// nome del test (`tests/<stem>.rs/…` è esplicito) e poi dalla forma del package.
func testTargetSelection(testName, testFile, workingDirectory string) ([]string, error) {
	if strings.Contains(testName, " (line ") {
		return nil, fmt.Errorf("doc tests cannot be debugged (they have no compiled binary): run them from the Tests panel")
	}
	file := strings.TrimPrefix(filepath.ToSlash(strings.TrimSpace(testFile)), "./")
	if stem, ok := integrationTestStem(file); ok {
		return []string{"--test", stem}, nil
	}
	if file == "" {
		// Nome dell'albero: `tests/<stem>.rs/it_works` porta il file di integrazione nel nome.
		if rest, found := strings.CutPrefix(filepath.ToSlash(testName), "tests/"); found {
			if end := strings.Index(rest, "/"); end > 0 {
				if stem, ok := integrationTestStem("tests/" + rest[:end]); ok {
					return []string{"--test", stem}, nil
				}
			}
		}
	}
	if stem, ok := binaryTestStem(file); ok {
		return []string{"--bin", stem}, nil
	}
	// Gli unit test di `src/main.rs` stanno nel binario del package, non nel lib.
	if file == "src/main.rs" {
		if name := DefaultBinary(workingDirectory); name != "" {
			return []string{"--bin", name}, nil
		}
		return nil, fmt.Errorf("could not find the binary target for %q", testName)
	}
	if hasFile(filepath.Join(workingDirectory, "src", "lib.rs")) {
		return []string{"--lib"}, nil
	}
	if name := DefaultBinary(workingDirectory); name != "" {
		return []string{"--bin", name}, nil
	}
	return nil, fmt.Errorf("could not find the test target for %q: open a test inside a Cargo package", testName)
}

// integrationTestStem è il nome del target di integrazione (`tests/foo.rs` → "foo"); il file deve
// stare esattamente in `tests/` e non può chiamarsi come un'opzione di cargo.
func integrationTestStem(file string) (string, bool) {
	rest, found := strings.CutPrefix(file, "tests/")
	if !found || !strings.HasSuffix(rest, ".rs") {
		return "", false
	}
	stem := strings.TrimSuffix(rest, ".rs")
	if stem == "" || strings.Contains(stem, "/") || strings.HasPrefix(stem, "-") {
		return "", false
	}
	return stem, true
}

// binaryTestStem è il nome del binario di un test in `src/bin/<n>.rs` o `src/bin/<n>/main.rs`.
func binaryTestStem(file string) (string, bool) {
	rest, found := strings.CutPrefix(file, "src/bin/")
	if !found || !strings.HasSuffix(rest, ".rs") {
		return "", false
	}
	stem := strings.TrimSuffix(strings.TrimSuffix(rest, "/main.rs"), ".rs")
	if stem == "" || strings.Contains(stem, "/") || strings.HasPrefix(stem, "-") {
		return "", false
	}
	return stem, true
}

// parseTestArtifactPath legge l'eseguibile del test dai messaggi di cargo: solo gli artefatti con
// `profile.test` (le dipendenze e i proc-macro non sono binari di test).
func parseTestArtifactPath(output []byte) (string, error) {
	executable := ""
	for line := range strings.SplitSeq(string(output), "\n") {
		var message struct {
			Reason     string `json:"reason"`
			Executable string `json:"executable"`
			Profile    struct {
				Test bool `json:"test"`
			} `json:"profile"`
		}
		if json.Unmarshal([]byte(line), &message) != nil || message.Reason != "compiler-artifact" || !message.Profile.Test || message.Executable == "" {
			continue
		}
		if executable != "" && executable != message.Executable {
			return "", fmt.Errorf("cargo test --no-run produced more than one test binary: choose a single test target")
		}
		executable = message.Executable
	}
	if executable == "" {
		return "", fmt.Errorf("cargo test --no-run did not produce a test binary")
	}
	return executable, nil
}
