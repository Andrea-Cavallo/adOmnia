package rust

import (
	"encoding/json"
	"fmt"
	"strings"

	"adomnia/internal/ide/run"
	idetesting "adomnia/internal/ide/testing"
)

// TestOptions sono le opzioni di LanguageOptions dei test Rust. Run è un singolo nome di test da
// eseguire in modo esatto (`cargo test <name> -- --exact`), vuoto esegue tutti i test dell'unità.
type TestOptions struct {
	Toolchain string `json:"toolchain,omitempty"`
	Run       string `json:"run,omitempty"`
	Coverage  bool   `json:"coverage,omitempty"`
}

// TestCommand esegue `cargo test` con la toolchain risolta. La compilazione dei test esegue
// build.rs e proc-macro: come ogni test, parte solo su richiesta esplicita con il progetto
// autorizzato (RS-5.1). L'output di libtest viene letto dal parser senza parsing del colore.
func (*Language) TestCommand(request idetesting.Request) (run.CommandSpec, idetesting.EventParser, error) {
	var options TestOptions
	if len(request.LanguageOptions) > 0 {
		if err := json.Unmarshal(request.LanguageOptions, &options); err != nil {
			return run.CommandSpec{}, nil, fmt.Errorf("invalid Rust test options: %w", err)
		}
	}
	if options.Run != "" {
		if strings.HasPrefix(options.Run, "-") || strings.ContainsAny(options.Run, "\x00\r\n") {
			return run.CommandSpec{}, nil, fmt.Errorf("invalid test name %q", options.Run)
		}
	}
	toolchain, err := ResolveToolchain(request.Root, request.WorkingDirectory, options.Toolchain)
	if err != nil {
		return run.CommandSpec{}, nil, err
	}
	arguments := []string{"test"}
	if options.Run != "" {
		arguments = append(arguments, options.Run, "--", "--exact")
	}
	if err := run.CheckBatchSafe(toolchain.Cargo, arguments); err != nil {
		return run.CommandSpec{}, nil, err
	}
	pkg := readManifest(request.WorkingDirectory).Name
	spec := run.CommandSpec{
		Executable: toolchain.Cargo, Arguments: arguments,
		WorkingDirectory: request.WorkingDirectory,
		Environment:      append([]string(nil), request.Environment...),
		DisplayCommand:   "cargo " + strings.Join(arguments, " "),
	}
	return spec, newLibtestParser(pkg), nil
}

// newLibtestParser crea il parser dell'output libtest; pkg è il nome del crate (Package degli eventi).
func newLibtestParser(pkg string) *libtestParser {
	return &libtestParser{pkg: pkg}
}
