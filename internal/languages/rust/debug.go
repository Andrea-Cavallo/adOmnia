package rust

import (
	"context"
	"encoding/json/v2"
	"fmt"
	"net"
	"strconv"
	"strings"

	"adomnia/internal/ide/dap"
	"adomnia/internal/ide/process"
	"adomnia/internal/procutil"
)

// DebugOptions sono le opzioni di LanguageOptions del debug Rust: lo stesso target della Run
// (bin o example) più gli argomenti del programma.
type DebugOptions struct {
	Toolchain        string   `json:"toolchain,omitempty"`
	Package          string   `json:"package,omitempty"`
	Bin              string   `json:"bin,omitempty"`
	Example          string   `json:"example,omitempty"`
	// Test è il nome del test da debuggare (RS-5.5): percorso libtest o nome dell'albero, come
	// TestOptions.Run. Con Test valorizzato il target è l'eseguibile del test, non un bin/example.
	Test string `json:"test,omitempty"`
	// TestFile è il sorgente del test relativo al crate (`tests/foo.rs`, `src/lib.rs`, `src/bin/x.rs`):
	// serve a scegliere il target di test senza indovinare. Opzionale.
	TestFile         string   `json:"testFile,omitempty"`
	// Source è un file .rs fuori da un crate: come la Run, passa dal crate fantasma (loose.go).
	Source           string   `json:"source,omitempty"`
	manifest         string
	ProgramArguments []string `json:"programArguments,omitempty"`
	// Come la Run: lo stesso build per debug e per esecuzione (features, profilo, target).
	Features          []string `json:"features,omitempty"`
	AllFeatures       bool     `json:"allFeatures,omitzero"`
	NoDefaultFeatures bool     `json:"noDefaultFeatures,omitzero"`
	Profile           string   `json:"profile,omitempty"`
	Target            string   `json:"target,omitempty"`
	// Adapter è il CodeLLDB già localizzato dall'host (cartella strumenti, PATH, VS Code).
	Adapter string `json:"adapter,omitempty"`
}

// DebugAdapter implementa dap.DebugAdapterProvider con CodeLLDB: un adapter DAP standalone (LLDB
// incluso) che avvia il binario e gestisce breakpoint/step/variabili. Il binario si ottiene con
// `cargo build --message-format=json`, mai indovinando `target/debug/<nome>` (RS-6.2). CodeLLDB
// deve essere installato (release pinnata, RS-0.2): non viene installato nulla in automatico.
func (*Language) DebugAdapter(request dap.LaunchRequest) (dap.AdapterSpec, error) {
	var options DebugOptions
	if len(request.LanguageOptions) > 0 {
		if err := json.Unmarshal(request.LanguageOptions, &options); err != nil {
			return dap.AdapterSpec{}, fmt.Errorf("enter valid Rust debug options")
		}
	}
	if err := validateDebugOptions(options); err != nil {
		return dap.AdapterSpec{}, err
	}
	if options.Source != "" {
		var err error
		options.manifest, options.Bin, err = looseCrate(request.Root, request.WorkingDirectory, options.Source)
		if err != nil {
			return dap.AdapterSpec{}, err
		}
		options.Package, options.Example = "", ""
	}
	// Debug del test (RS-5.5): l'eseguibile è quello del test, non un bin/example.
	if options.Test == "" {
		if options.Bin == "" && options.Example == "" {
			options.Bin = DefaultBinary(request.WorkingDirectory)
		}
		if options.Bin == "" && options.Example == "" {
			return dap.AdapterSpec{}, fmt.Errorf("choose a binary or example to debug")
		}
	}
	toolchain, err := ResolveToolchain(request.Root, request.WorkingDirectory, options.Toolchain)
	if err != nil {
		return dap.AdapterSpec{}, err
	}
	codeLLDB := options.Adapter
	if codeLLDB == "" {
		codeLLDB, _, _ = LocateCodeLLDB("")
	}
	if codeLLDB == "" || !hasFile(codeLLDB) {
		return dap.AdapterSpec{}, fmt.Errorf("CodeLLDB is not installed: install it (see the Rust debugger notice) to debug Rust programs")
	}
	programArguments := options.ProgramArguments
	artifact := ""
	if options.Test != "" {
		var libtestArguments []string
		artifact, libtestArguments, err = testDebugArtifact(toolchain.Cargo, request.WorkingDirectory, options)
		programArguments = libtestArguments
	} else {
		artifact, err = buildArtifactPath(toolchain.Cargo, request.WorkingDirectory, options)
	}
	if err != nil {
		return dap.AdapterSpec{}, err
	}
	// CodeLLDB non annuncia la porta in alcun modo (provato con v1.12.3: nessun output): si riserva
	// una porta libera di loopback, gli si passa con `--port` e il manager si collega a indirizzo
	// noto (come per debugpy). Era il `ReadyPattern` mai verificato di RS-6.1.
	port, err := freeLoopbackPort()
	if err != nil {
		return dap.AdapterSpec{}, err
	}
	address := "127.0.0.1:" + strconv.Itoa(port)
	return dap.AdapterSpec{
		AdapterID:        ID,
		Executable:       codeLLDB,
		Arguments:        []string{"--port", strconv.Itoa(port)},
		WorkingDirectory: request.WorkingDirectory,
		Environment:      append([]string(nil), request.Environment...),
		Transport:        dap.TCPListen,
		Address:          address,
		Title:            debugTitle(options),
		PanicFunction:    "rust_panic",
		Launch: func(string) (string, map[string]any) {
			return "launch", map[string]any{
				"type": "lldb", "request": "launch", "program": artifact,
				"args": append([]string(nil), programArguments...),
				"cwd":  request.WorkingDirectory,
			}
		},
		ExplainError: func(err error) error {
			return fmt.Errorf("CodeLLDB could not launch the program: %w", err)
		},
	}, nil
}

func debugTitle(options DebugOptions) string {
	switch {
	case options.Test != "":
		return "Debug test " + options.Test
	case options.Bin != "":
		return "Debug " + options.Bin
	case options.Example != "":
		return "Debug " + options.Example
	}
	return "Debug"
}

// runCargoBuild esegue cargo build e restituisce lo stdout; sostituibile nei test.
var runCargoBuild = func(cargo, workingDirectory string, arguments []string) ([]byte, error) {
	command := procutil.CommandContext(context.Background(), cargo, arguments...)
	command.Dir = workingDirectory
	process.Configure(command, false)
	return command.Output()
}

// freeLoopbackPort riserva una porta libera di loopback e la rilascia: l'indirizzo è noto prima di
// avviare il debug adapter, che non annuncia la porta (come per debugpy).
func freeLoopbackPort() (int, error) {
	listener, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		return 0, fmt.Errorf("could not reserve a loopback port for the debug adapter: %w", err)
	}
	port := listener.Addr().(*net.TCPAddr).Port
	if err := listener.Close(); err != nil {
		return 0, fmt.Errorf("could not reserve a loopback port for the debug adapter: %w", err)
	}
	return port, nil
}

// buildArtifactPath compila il target e ne estrae il percorso reale dal messaggio
// `compiler-artifact` (mai indovinare target/debug/<nome>, RS-6.2).
func buildArtifactPath(cargo, workingDirectory string, options DebugOptions) (string, error) {
	arguments := []string{"build", "--message-format=json"}
	if options.manifest != "" {
		arguments = append(arguments, "--manifest-path", options.manifest)
	}
	if options.Package != "" {
		arguments = append(arguments, "--package", options.Package)
	}
	switch {
	case options.Bin != "":
		arguments = append(arguments, "--bin", options.Bin)
	case options.Example != "":
		arguments = append(arguments, "--example", options.Example)
	}
	arguments = append(arguments, featureArguments(Options{Features: options.Features, AllFeatures: options.AllFeatures, NoDefaultFeatures: options.NoDefaultFeatures})...)
	if options.Profile != "" {
		arguments = append(arguments, "--profile", options.Profile)
	}
	if options.Target != "" {
		arguments = append(arguments, "--target", options.Target)
	}
	output, err := runCargoBuild(cargo, workingDirectory, arguments)
	if err != nil {
		return "", fmt.Errorf("building for debug failed: %w", err)
	}
	return parseArtifactPath(output)
}

// parseArtifactPath legge l'ultimo `compiler-artifact` con un eseguibile: è il binario finale
// (i binari delle dipendenze non hanno `executable`).
func parseArtifactPath(output []byte) (string, error) {
	executable := ""
	for _, line := range strings.Split(string(output), "\n") {
		var message struct {
			Reason     string `json:"reason"`
			Executable string `json:"executable"`
		}
		if json.Unmarshal([]byte(line), &message) == nil && message.Reason == "compiler-artifact" && message.Executable != "" {
			executable = message.Executable
		}
	}
	if executable == "" {
		return "", fmt.Errorf("cargo build did not produce a binary")
	}
	return executable, nil
}

// validateDebugOptions applica le stesse regole della Run: nomi di crate, feature, profilo e
// target non possono iniziare con `-` né contenere altro che i caratteri ammessi da cargo. Un nome
// di test non può essere un'opzione di libtest (stessa regola di TestCommand).
func validateDebugOptions(options DebugOptions) error {
	for _, name := range []string{options.Package, options.Bin, options.Example} {
		if name != "" && !crateName.MatchString(name) {
			return fmt.Errorf("enter a valid package, binary or example name")
		}
	}
	if options.Test != "" && (strings.HasPrefix(options.Test, "-") || strings.ContainsAny(options.Test, "\x00\r\n")) {
		return fmt.Errorf("invalid test name %q", options.Test)
	}
	for _, feature := range options.Features {
		if !featureName.MatchString(feature) {
			return fmt.Errorf("enter valid feature names")
		}
	}
	if options.Profile != "" && !profileName.MatchString(options.Profile) {
		return fmt.Errorf("enter a valid profile name (dev, release or a custom profile)")
	}
	if options.Target != "" && !targetTriple.MatchString(options.Target) {
		return fmt.Errorf("enter a valid target triple")
	}
	return nil
}
