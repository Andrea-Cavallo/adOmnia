package rust

import (
	"encoding/json"
	"fmt"
	"path/filepath"
	"regexp"
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
	for _, name := range strings.Split(options.Run, "\n") {
		// Un nome non può essere un'opzione di libtest; più nomi (rerun failed) stanno uno per riga.
		if options.Run != "" && (name == "" || strings.HasPrefix(name, "-") || strings.ContainsAny(name, "\x00\r")) {
			return run.CommandSpec{}, nil, fmt.Errorf("invalid test name %q", name)
		}
	}
	toolchain, err := ResolveToolchain(request.Root, request.WorkingDirectory, options.Toolchain)
	if err != nil {
		return run.CommandSpec{}, nil, err
	}
	// Senza --no-fail-fast cargo si ferma al primo crate con un test fallito e gli altri non compaiono.
	arguments := []string{"test", "--no-fail-fast"}
	if names := strings.Split(options.Run, "\n"); len(names) == 1 && names[0] != "" {
		filter, exact := libtestFilter(names[0])
		arguments = append(arguments, filter)
		if exact {
			arguments = append(arguments, "--", "--exact")
		}
	} else if len(names) > 1 {
		// "Rerun failed": più nomi esatti, che libtest vuole dopo `--`.
		arguments = append(arguments, "--", "--exact")
		for _, name := range names {
			filter, _ := libtestFilter(name)
			arguments = append(arguments, filter)
		}
	}
	if err := run.CheckBatchSafe(toolchain.Cargo, arguments); err != nil {
		return run.CommandSpec{}, nil, err
	}
	// Un workspace virtuale non ha [package]: senza nome gli eventi verrebbero scartati dall'albero.
	pkg := readManifest(request.WorkingDirectory).Name
	if pkg == "" {
		pkg = filepath.Base(request.WorkingDirectory)
	}
	spec := run.CommandSpec{
		Executable: toolchain.Cargo, Arguments: arguments,
		WorkingDirectory: request.WorkingDirectory,
		Environment:      append([]string(nil), request.Environment...),
		DisplayCommand:   "cargo " + strings.Join(arguments, " "),
		// Anche `cargo test` aspetta il lock di `target/`: la stessa spiegazione della Run (RS-3.5).
		ConsoleLine: runConsole(workspacePaths{directory: request.WorkingDirectory, root: request.Root}),
	}
	parser := newLibtestParser(pkg)
	parser.paths = workspacePaths{directory: request.WorkingDirectory, root: request.Root}
	return spec, parser, nil
}

// newLibtestParser crea il parser dell'output libtest; pkg è il nome del crate (Package degli eventi).
func newLibtestParser(pkg string) *libtestParser {
	return &libtestParser{pkg: pkg}
}

var integrationPrefix = regexp.MustCompile(`^tests/[^/]+\.rs/`)

// libtestFilter porta un filtro nella forma che capisce libtest. Accetta sia il percorso libtest
// (`tests::it_works`) sia il nome del nodo dell'albero (`tests/it_works`, `tests/api.rs/health`): le
// Run singole e i "rerun" ripartono dai nomi dell'albero, e un filtro in forma sbagliata esegue 0 test
// in verde. Un nome che finisce con `::` (o `/`) è un modulo: si esegue per prefisso, non esatto.
func libtestFilter(run string) (filter string, exact bool) {
	if strings.Contains(run, " (line ") { // doctest: il nome ha già la forma di libtest
		return run, true
	}
	module := strings.HasSuffix(run, "::") || strings.HasSuffix(run, "/")
	name := integrationPrefix.ReplaceAllString(run, "")
	name = strings.ReplaceAll(strings.TrimRight(name, "/:"), "/", "::")
	if module {
		return name + "::", false
	}
	return name, true
}
