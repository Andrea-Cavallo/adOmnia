package rust

import (
	"encoding/json"
	"fmt"
	"regexp"
	"strings"

	"adomnia/internal/ide/run"
)

// Options sono le opzioni di LanguageOptions delle configurazioni Rust. La toolchain è opzionale:
// senza scelta esplicita vale la selezione del progetto, il rust-toolchain del progetto e il PATH
// (RS-0.4: la macchina non entra nel file condiviso delle configurazioni).
type Options struct {
	Toolchain        string   `json:"toolchain,omitempty"`
	Package          string   `json:"package,omitempty"`
	Bin              string   `json:"bin,omitempty"`
	Example          string   `json:"example,omitempty"`
	Bench            string   `json:"bench,omitempty"`
	Features         []string `json:"features,omitempty"`
	AllFeatures      bool     `json:"allFeatures,omitempty"`
	NoDefaultFeatures bool    `json:"noDefaultFeatures,omitempty"`
	Profile          string   `json:"profile,omitempty"`
	Target           string   `json:"target,omitempty"`
}

var (
	crateName   = regexp.MustCompile(`^[A-Za-z0-9_-]+$`)
	featureName = regexp.MustCompile(`^[A-Za-z0-9_][A-Za-z0-9_-]*$`)
	profileName = regexp.MustCompile(`^[A-Za-z0-9_-]+$`)
	targetTriple = regexp.MustCompile(`^[A-Za-z0-9_][A-Za-z0-9_.-]*-[A-Za-z0-9_]+$`)
)

func (*Language) RunKinds() []string { return []string{"bin", "example", "bench", "build", "check", "clippy"} }

// optionsFor interpreta e valida le opzioni del kind. La validazione è statica: la toolchain si
// risolve e si controlla alla partenza (serve il progetto autorizzato per eseguire).
func optionsFor(kind string, data json.RawMessage) (Options, error) {
	var options Options
	if err := json.Unmarshal(data, &options); err != nil {
		return options, fmt.Errorf("enter valid Rust run options")
	}
	if options.Toolchain != "" && strings.ContainsAny(options.Toolchain, "\x00\r\n") {
		return options, fmt.Errorf("enter the path of a cargo executable")
	}
	if options.Package != "" && !crateName.MatchString(options.Package) {
		return options, fmt.Errorf("enter a valid package name")
	}
	if options.AllFeatures && options.NoDefaultFeatures {
		return options, fmt.Errorf("--all-features and --no-default-features are mutually exclusive")
	}
	for _, feature := range options.Features {
		if !featureName.MatchString(feature) {
			return options, fmt.Errorf("enter valid feature names")
		}
	}
	if options.Profile != "" && !profileName.MatchString(options.Profile) {
		return options, fmt.Errorf("enter a valid profile name (dev, release or a custom profile)")
	}
	if options.Target != "" && !targetTriple.MatchString(options.Target) {
		return options, fmt.Errorf("enter a valid target triple")
	}
	switch kind {
	case "bin":
		if options.Bin == "" && options.Package == "" {
			return options, fmt.Errorf("choose a binary to run")
		}
		if options.Bin != "" && !crateName.MatchString(options.Bin) {
			return options, fmt.Errorf("enter a valid binary name")
		}
	case "example":
		if options.Example == "" && options.Package == "" {
			return options, fmt.Errorf("choose an example to run")
		}
		if options.Example != "" && !crateName.MatchString(options.Example) {
			return options, fmt.Errorf("enter a valid example name")
		}
	case "bench":
		if options.Bench != "" && !crateName.MatchString(options.Bench) {
			return options, fmt.Errorf("enter a valid bench name")
		}
	case "build", "check", "clippy":
	default:
		return options, fmt.Errorf("unsupported Rust run kind: %s", kind)
	}
	return options, nil
}

func (*Language) ValidateRunConfiguration(config run.Configuration) error {
	_, err := optionsFor(string(config.Kind), config.LanguageOptions)
	return err
}

// CommandSpec costruisce il comando cargo, senza shell. I `--` separano gli argomenti del
// programma (solo run/bench).
func (*Language) CommandSpec(request run.Request) (run.CommandSpec, error) {
	options, err := optionsFor(request.Kind, request.LanguageOptions)
	if err != nil {
		return run.CommandSpec{}, err
	}
	toolchain, err := ResolveToolchain(request.Root, request.WorkingDirectory, options.Toolchain)
	if err != nil {
		return run.CommandSpec{}, err
	}
	args := cargoArguments(request.Kind, options)
	if request.Kind == "bin" || request.Kind == "example" || request.Kind == "bench" {
		args = append(args, "--")
		args = append(args, request.ProgramArguments...)
	}
	return run.CommandSpec{
		Executable: toolchain.Cargo, Arguments: args,
		WorkingDirectory: request.WorkingDirectory,
		Environment:      append([]string(nil), request.Environment...),
	}, nil
}

// cargoArguments costruisce gli argomenti cargo per il kind, senza gli argomenti del programma.
func cargoArguments(kind string, options Options) []string {
	sub := map[string]string{
		"bin": "run", "example": "run", "bench": "bench",
		"build": "build", "check": "check", "clippy": "clippy",
	}[kind]
	args := []string{sub}
	if options.Package != "" {
		args = append(args, "--package", options.Package)
	}
	switch kind {
	case "bin":
		if options.Bin != "" {
			args = append(args, "--bin", options.Bin)
		}
	case "example":
		if options.Example != "" {
			args = append(args, "--example", options.Example)
		}
	case "bench":
		if options.Bench != "" {
			args = append(args, "--bench", options.Bench)
		}
	}
	args = append(args, featureArguments(options)...)
	if options.Profile != "" {
		args = append(args, "--profile", options.Profile)
	}
	if options.Target != "" {
		args = append(args, "--target", options.Target)
	}
	return args
}

func featureArguments(options Options) []string {
	switch {
	case options.AllFeatures:
		return []string{"--all-features"}
	case options.NoDefaultFeatures:
		args := []string{"--no-default-features"}
		if len(options.Features) > 0 {
			args = append(args, "--features", strings.Join(options.Features, ","))
		}
		return args
	case len(options.Features) > 0:
		return []string{"--features", strings.Join(options.Features, ",")}
	}
	return nil
}

// RunSchema descrive i campi dei kind Rust. I campi comuni (cwd, env, args, restart) stanno nel
// form condiviso, qui solo ciò che è specifico di cargo.
func (*Language) RunSchema(kind string) run.FieldSchema {
	fields := []run.Field{
		{Key: "toolchain", Label: "Cargo", Type: run.FieldPath, Section: run.SectionBasic, Help: "Optional path to the cargo executable. Empty means the project toolchain or the PATH."},
		{Key: "package", Label: "Package", Type: run.FieldText, Section: run.SectionAdvanced, Help: "The package to run (--package), for workspaces."},
	}
	switch kind {
	case "bin":
		fields = append(fields, run.Field{Key: "bin", Label: "Binary", Type: run.FieldText, Section: run.SectionBasic, Help: "The binary to run (--bin)."})
	case "example":
		fields = append(fields, run.Field{Key: "example", Label: "Example", Type: run.FieldText, Section: run.SectionBasic, Help: "The example to run (--example)."})
	case "bench":
		fields = append(fields, run.Field{Key: "bench", Label: "Bench", Type: run.FieldText, Section: run.SectionBasic, Help: "The benchmark to run (--bench)."})
	}
	fields = append(fields,
		run.Field{Key: "features", Label: "Features", Type: run.FieldList, Section: run.SectionAdvanced, Help: "The features to enable (--features)."},
		run.Field{Key: "allFeatures", Label: "All features", Type: run.FieldToggle, Section: run.SectionAdvanced, Help: "Enable all features (--all-features)."},
		run.Field{Key: "noDefaultFeatures", Label: "No default features", Type: run.FieldToggle, Section: run.SectionAdvanced, Help: "Disable default features (--no-default-features)."},
		run.Field{Key: "profile", Label: "Profile", Type: run.FieldText, Section: run.SectionAdvanced, Default: "dev", Help: "dev, release or a custom [profile.*]."},
		run.Field{Key: "target", Label: "Target", Type: run.FieldText, Section: run.SectionAdvanced, Help: "Optional cross-compilation target triple (--target)."},
	)
	return run.FieldSchema{Language: ID, Kind: kind, Fields: fields}
}
