package rust

import (
	"context"
	"encoding/json"
	"os"
	"path/filepath"

	"adomnia/internal/ide/project"
	"adomnia/internal/ide/run"
)

// Suggest propone le configurazioni rilevate per un'unità Cargo: ogni bin ed example dichiarato
// (o implicito per convenzione), più build e check. Non esegue nulla e non modifica file.
func (*Language) Suggest(ctx context.Context, projectRoot string, unit project.Unit) []run.Suggestion {
	manifest := readManifest(unit.Root)
	var suggestions []run.Suggestion

	// Bin: quelli espliciti, oppure il binario implicito src/main.rs (nome = package).
	if manifest.IsPackage {
		bins := manifest.Bins
		if len(bins) == 0 && hasFile(filepath.Join(unit.Root, "src", "main.rs")) {
			bins = []string{manifest.Name}
		}
		for _, bin := range bins {
			suggestions = append(suggestions, cargoSuggestion(unit, "bin:"+bin, "Rust · cargo run --bin "+bin, "run", "bin", Options{Bin: bin}))
		}
		for _, example := range manifest.Examples {
			suggestions = append(suggestions, cargoSuggestion(unit, "example:"+example, "Rust · cargo run --example "+example, "run", "example", Options{Example: example}))
		}
	}
	suggestions = append(suggestions,
		cargoSuggestion(unit, "build", "Rust · cargo build", "build", "build", Options{}),
		cargoSuggestion(unit, "check", "Rust · cargo check", "build", "check", Options{}),
	)
	return suggestions
}

func cargoSuggestion(unit project.Unit, id, title, action, kind string, options Options) run.Suggestion {
	data, _ := json.Marshal(options)
	return run.Suggestion{
		ID:       id,
		Language: ID,
		Title:    title,
		Action:   action,
		UnitRoot: unit.Root,
		Configuration: run.Configuration{
			Language:        ID,
			Kind:            run.Kind(kind),
			LanguageOptions: data,
		},
	}
}

func hasFile(path string) bool {
	info, err := os.Stat(path)
	return err == nil && info.Mode().IsRegular()
}
