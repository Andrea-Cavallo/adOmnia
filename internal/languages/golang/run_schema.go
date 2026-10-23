package golang

import (
	"encoding/json/v2"
	"fmt"
	"strings"

	"adomnia/internal/ide/run"
)

// RunSchema descrive i campi Go di una configurazione: la UI li genera da qui.
// Le opzioni avanzate (GOOS, tag, flag) non esistono per i kind che non le usano.
func (*Language) RunSchema(kind string) run.FieldSchema {
	schema := run.FieldSchema{Language: ID, Kind: kind}
	if kind == "go-tool" {
		schema.Fields = []run.Field{{Key: "target", Label: "Go command", Type: run.FieldText, Section: run.SectionBasic, Required: true, Help: "Sottocomando di go: generate, vet, tool…"}}
		return schema
	}
	buildKind := kind == "package" || kind == "files" || kind == "run" || kind == "build" || kind == "test"
	if !buildKind {
		return schema
	}
	advanced := func(key, label string, field run.Field) run.Field {
		field.Key, field.Label, field.Section = key, label, run.SectionAdvanced
		return field
	}
	schema.Fields = []run.Field{
		advanced("race", "Race detector", run.Field{Type: run.FieldToggle, Help: "-race; abilita CGO_ENABLED se non impostato"}),
		advanced("coverage", "Coverage", run.Field{Type: run.FieldToggle, Help: "-cover; per run e build i dati finiscono in .gocoverdata"}),
		advanced("goos", "GOOS", run.Field{Type: run.FieldText}),
		advanced("goarch", "GOARCH", run.Field{Type: run.FieldText}),
		advanced("buildTags", "Build tags", run.Field{Type: run.FieldList}),
		advanced("goArguments", "Go tool flags", run.Field{Type: run.FieldList, Help: "Flag passati a go run/build/test"}),
	}
	if kind == "package" || kind == "run" || kind == "build" {
		schema.Fields = append(schema.Fields, advanced("debugFlags", "Debug build flags (Delve)", run.Field{Type: run.FieldList, Help: "Es. -gcflags=all=-N"}))
	}
	if kind == "test" {
		schema.Fields = append(schema.Fields, advanced("profile", "Profile", run.Field{
			Type: run.FieldSelect, Help: "Profilo di test",
			Options: []run.FieldOption{{Value: "", Label: "None"}, {Value: "cpu", Label: "CPU"}, {Value: "mem", Label: "Memory"}, {Value: "block", Label: "Block"}, {Value: "mutex", Label: "Mutex"}, {Value: "trace", Label: "Trace"}},
		}))
	}
	return schema
}

// ValidateRunConfiguration valida i campi propri di Go: sorgenti .go per il kind files e LanguageOptions.
func (*Language) ValidateRunConfiguration(config run.Configuration) error {
	if config.Kind == "go-tool" && !ValidSubcommand(strings.TrimSpace(config.Target)) {
		return fmt.Errorf("specify the go command (e.g. generate, vet, tool)")
	}
	if config.Kind == "files" {
		if len(config.Files) == 0 {
			return fmt.Errorf("indica almeno un file Go da eseguire")
		}
		for _, file := range config.Files {
			if !strings.HasSuffix(strings.ToLower(strings.TrimSpace(file)), ".go") {
				return fmt.Errorf("la lista file accetta solo sorgenti Go: %q", file)
			}
		}
	}
	if len(config.LanguageOptions) == 0 {
		return nil
	}
	var options RunOptions
	if err := json.Unmarshal(config.LanguageOptions, &options); err != nil {
		return fmt.Errorf("invalid Go options: %w", err)
	}
	return ValidateRunOptions(string(config.Kind), options)
}
