package rust

import (
	"context"
	"encoding/json"
	"fmt"
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
	ProgramArguments []string `json:"programArguments,omitempty"`
	// Come la Run: lo stesso build per debug e per esecuzione (features, profilo, target).
	Features          []string `json:"features,omitempty"`
	AllFeatures       bool     `json:"allFeatures,omitempty"`
	NoDefaultFeatures bool     `json:"noDefaultFeatures,omitempty"`
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
	if options.Bin == "" && options.Example == "" {
		options.Bin = DefaultBinary(request.WorkingDirectory)
	}
	if options.Bin == "" && options.Example == "" {
		return dap.AdapterSpec{}, fmt.Errorf("choose a binary or example to debug")
	}
	toolchain, err := ResolveToolchain(request.Root, request.WorkingDirectory, options.Toolchain)
	if err != nil {
		return dap.AdapterSpec{}, err
	}
	codeLLDB := options.Adapter
	if codeLLDB == "" {
		codeLLDB, _ = LocateCodeLLDB("")
	}
	if codeLLDB == "" || !hasFile(codeLLDB) {
		return dap.AdapterSpec{}, fmt.Errorf("CodeLLDB is not installed: install it (see the Rust debugger notice) to debug Rust programs")
	}
	artifact, err := buildArtifactPath(toolchain.Cargo, request.WorkingDirectory, options)
	if err != nil {
		return dap.AdapterSpec{}, err
	}
	return dap.AdapterSpec{
		AdapterID:        ID,
		Executable:       codeLLDB,
		Arguments:        []string{"--port", "0"},
		WorkingDirectory: request.WorkingDirectory,
		Environment:      append([]string(nil), request.Environment...),
		Transport:        dap.TCPListen,
		ReadyPattern:     `(?i)listening on port (\d+)`,
		Title:            debugTitle(options),
		PanicFunction:    "rust_panic",
		Launch: func(string) (string, map[string]any) {
			return "launch", map[string]any{
				"type": "lldb", "request": "launch", "program": artifact,
				"args": append([]string(nil), options.ProgramArguments...),
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

// buildArtifactPath compila il target e ne estrae il percorso reale dal messaggio
// `compiler-artifact` (mai indovinare target/debug/<nome>, RS-6.2).
func buildArtifactPath(cargo, workingDirectory string, options DebugOptions) (string, error) {
	arguments := []string{"build", "--message-format=json"}
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
// target non possono iniziare con `-` né contenere altro che i caratteri ammessi da cargo.
func validateDebugOptions(options DebugOptions) error {
	for _, name := range []string{options.Package, options.Bin, options.Example} {
		if name != "" && !crateName.MatchString(name) {
			return fmt.Errorf("enter a valid package, binary or example name")
		}
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
