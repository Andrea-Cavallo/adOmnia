package rust

import (
	"context"
	"os"
	"path/filepath"
	"slices"

	"github.com/Andrea-Cavallo/adOmnia/internal/ide/project"
	"github.com/Andrea-Cavallo/adOmnia/internal/ide/run"
	"github.com/Andrea-Cavallo/adOmnia/internal/jsonutil"
)

// Suggest propone le configurazioni rilevate per un'unità Cargo: ogni bin ed example dichiarato
// (o implicito per convenzione), più build e check. Non esegue nulla e non modifica file.
func (*Language) Suggest(ctx context.Context, projectRoot string, unit project.Unit) []run.Suggestion {
	manifest := readManifest(unit.Root)
	var suggestions []run.Suggestion

	// Bin: quelli espliciti più il binario implicito src/main.rs (nome = package). Cargo scopre
	// src/main.rs anche accanto a `[[bin]]` dichiarati, tranne se ne riprendono nome o percorso.
	if manifest.IsPackage {
		bins := manifest.Bins
		if hasFile(filepath.Join(unit.Root, "src", "main.rs")) && !containsName(bins, manifest.Name) {
			bins = append([]string{manifest.Name}, bins...)
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
		cargoSuggestion(unit, "build-release", "Rust · cargo build --release", "build", "build", Options{Profile: "release"}),
		cargoSuggestion(unit, "check", "Rust · cargo check", "build", "check", Options{}),
	)
	// Alias di cargo (RS-3.4): `[alias]` del `.cargo/config.toml` sono comandi già pronti. In
	// ordine alfabetico e limitati, così il pannello resta leggibile.
	aliases := cargoAliases(projectRoot, unit.Root)
	names := make([]string, 0, len(aliases))
	for name := range aliases {
		if aliasName.MatchString(name) {
			names = append(names, name)
		}
	}
	slices.Sort(names)
	if len(names) > maxAliasSuggestions {
		names = names[:maxAliasSuggestions]
	}
	for _, name := range names {
		suggestions = append(suggestions, cargoSuggestion(unit, "alias:"+name, "Rust · cargo "+name, "run", "alias", Options{Alias: name}))
	}
	return suggestions
}

// maxAliasSuggestions limita gli alias proposti: un `.cargo/config.toml` può averne molti.
const maxAliasSuggestions = 8

func cargoSuggestion(unit project.Unit, id, title, action, kind string, options Options) run.Suggestion {
	data, _ := jsonutil.Marshal(options)
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

// containsName dice se names contiene name.
func containsName(names []string, name string) bool {
	return slices.Contains(names, name)
}
