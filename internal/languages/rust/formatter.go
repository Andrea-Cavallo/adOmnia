package rust

import (
	"os"
	"path/filepath"

	"github.com/Andrea-Cavallo/adOmnia/internal/ide/language"
	"github.com/Andrea-Cavallo/adOmnia/internal/ide/run"
	"github.com/Andrea-Cavallo/adOmnia/internal/ide/sdk"
	"github.com/Andrea-Cavallo/adOmnia/internal/ide/toml"
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
	arguments := []string{"--emit", "stdout", "--edition", rustEdition(filepath.Dir(path))}
	return run.CommandSpec{
		Executable:       rustfmt,
		Arguments:        arguments,
		WorkingDirectory: filepath.Dir(path),
		DisplayCommand:   "rustfmt " + request.RelativePath,
	}, true, "", nil
}

// rustEdition è l'edition dichiarata dal Cargo.toml del crate che contiene il file (default 2021):
// risale dalle cartelle fino al manifest, così un file in `src/` di un crate 2024 non viene
// formattato come 2021. rustfmt la usa per interpretare la sintassi.
func rustEdition(dir string) string {
	for dir != "" {
		if data, err := os.ReadFile(filepath.Join(dir, "Cargo.toml")); err == nil {
			if edition := toml.String(toml.Parse(data), "package", "edition"); edition != "" {
				return edition
			}
		}
		parent := filepath.Dir(dir)
		if parent == dir {
			break
		}
		dir = parent
	}
	return "2021"
}
