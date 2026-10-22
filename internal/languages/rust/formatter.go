package rust

import (
	"os"
	"path/filepath"

	"adomnia/internal/ide/language"
	"adomnia/internal/ide/run"
	"adomnia/internal/ide/sdk"
	"adomnia/internal/ide/toml"
)

// FormatTool implementa language.FormatToolProvider con rustfmt (componente rustup, allineato alla
// toolchain): il contenuto arriva su stdin e il risultato su stdout, nella cartella del file così
// rustfmt legge il rustfmt.toml del progetto. rust-analyzer non formatta in parallelo: un solo
// owner delle modifiche al salvataggio (RS-4.7). Non installa nulla e non scrive file.
func (*Language) FormatTool(request language.FormatRequest) (run.CommandSpec, bool, string, error) {
	rustfmt, err := lookPath(sdk.ExecutableName("rustfmt"))
	if err != nil || !hasFile(rustfmt) {
		return run.CommandSpec{}, false, "rustfmt is not installed: install it from the Rust toolchain dialog (rustup component add rustfmt)", nil
	}
	path := request.Path
	if path == "" {
		path = filepath.Join(request.WorkingDirectory, filepath.FromSlash(request.RelativePath))
	}
	arguments := []string{"--emit", "stdout", "--edition", rustEdition(request.WorkingDirectory)}
	return run.CommandSpec{
		Executable:       rustfmt,
		Arguments:        arguments,
		WorkingDirectory: filepath.Dir(path),
		DisplayCommand:   "rustfmt " + request.RelativePath,
	}, true, "", nil
}

// rustEdition è l'edition dichiarata dal Cargo.toml dell'unità (default 2021): rustfmt la usa per
// interpretare la sintassi.
func rustEdition(unitRoot string) string {
	if data, err := os.ReadFile(filepath.Join(unitRoot, "Cargo.toml")); err == nil {
		if edition := toml.String(toml.Parse(data), "package", "edition"); edition != "" {
			return edition
		}
	}
	return "2021"
}
