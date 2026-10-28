package rust

import (
	"strconv"
	"strings"
	"testing"

	"github.com/Andrea-Cavallo/adOmnia/internal/ide/run"
)

// Un `[alias]` di cargo è una configurazione eseguibile: kind `alias`, `cargo <alias>` senza shell
// (RS-3.4).
func TestAliasKindRunsTheCargoAlias(t *testing.T) {
	root := t.TempDir()
	writeFile(t, root, ".cargo/config.toml", "[alias]\ndev = \"run --bin api\"\n")
	cargo := writeFile(t, root, "cargo.exe", "")
	options := `{"toolchain":` + strconv.Quote(cargo) + `,"alias":"dev"}`
	spec, err := New().CommandSpec(run.Request{Kind: "alias", Root: root, WorkingDirectory: root, LanguageOptions: []byte(options)})
	if err != nil {
		t.Fatal(err)
	}
	if spec.Arguments[0] != "dev" || !strings.HasPrefix(spec.Arguments[1], "--message-format") {
		t.Fatalf("arguments = %v", spec.Arguments)
	}
	// L'alias non accetta argomenti del programma: meglio un errore che una riga sbagliata.
	_, err = New().CommandSpec(run.Request{Kind: "alias", Root: root, WorkingDirectory: root,
		LanguageOptions: []byte(options), ProgramArguments: []string{"--release"}})
	if err == nil || !strings.Contains(err.Error(), "without program arguments") {
		t.Fatalf("err = %v", err)
	}
}

func TestAliasKindValidatesTheName(t *testing.T) {
	for _, options := range []string{`{"alias":""}`, `{}`, `{"alias":"--version"}`, `{"alias":"a b"}`} {
		if err := New().ValidateRunConfiguration(run.Configuration{Kind: "alias", LanguageOptions: []byte(options)}); err == nil {
			t.Fatalf("invalid alias accepted: %s", options)
		}
	}
	if err := New().ValidateRunConfiguration(run.Configuration{Kind: "alias", LanguageOptions: []byte(`{"alias":"dev"}`)}); err != nil {
		t.Fatalf("a valid alias was rejected: %v", err)
	}
}

// Gli alias del progetto diventano proposte Detected, in ordine e senza nomi non validi.
func TestSuggestProposesCargoAliases(t *testing.T) {
	root := t.TempDir()
	writeFile(t, root, "Cargo.toml", "[package]\nname = \"demo\"\nversion = \"0.1.0\"\nedition = \"2021\"\n")
	writeFile(t, root, "src/main.rs", "fn main() {}\n")
	writeFile(t, root, ".cargo/config.toml", "[alias]\nzzz = \"check\"\ndev = \"run --bin demo\"\n\"bad name\" = \"check\"\n")
	units, err := New().DetectUnits(t.Context(), root)
	if err != nil || len(units) != 1 {
		t.Fatalf("units = %+v, err = %v", units, err)
	}
	aliases := map[string]string{}
	var order []string
	for _, suggestion := range New().Suggest(t.Context(), root, units[0]) {
		if !strings.HasPrefix(suggestion.ID, "alias:") {
			continue
		}
		aliases[suggestion.ID] = suggestion.Title
		order = append(order, suggestion.ID)
	}
	if len(aliases) != 2 {
		t.Fatalf("aliases = %v", aliases)
	}
	if aliases["alias:dev"] != "Rust · cargo dev" || aliases["alias:zzz"] != "Rust · cargo zzz" {
		t.Fatalf("titles = %v", aliases)
	}
	if strings.Join(order, ",") != "alias:dev,alias:zzz" {
		t.Fatalf("order = %v", order)
	}
}

// Un progetto senza `.cargo/config.toml` non propone alias.
func TestSuggestWithoutAliases(t *testing.T) {
	root := t.TempDir()
	writeFile(t, root, "Cargo.toml", "[package]\nname = \"demo\"\nversion = \"0.1.0\"\nedition = \"2021\"\n")
	writeFile(t, root, "src/main.rs", "fn main() {}\n")
	units, err := New().DetectUnits(t.Context(), root)
	if err != nil || len(units) != 1 {
		t.Fatalf("units = %+v, err = %v", units, err)
	}
	for _, suggestion := range New().Suggest(t.Context(), root, units[0]) {
		if strings.HasPrefix(suggestion.ID, "alias:") {
			t.Fatalf("an alias was proposed without a config file: %+v", suggestion)
		}
	}
}
