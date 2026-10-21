package python

import (
	"fmt"
	"path/filepath"

	"adomnia/internal/ide/language"
	"adomnia/internal/ide/run"
)

// RuffVersion è la versione pinnata installata dall'azione esplicita "Install Ruff…". basedpyright
// non formatta: Ruff è uno strumento separato e opzionale (PY-4.5).
const RuffVersion = "0.13.2"

// FormatTool implementa language.FormatToolProvider con `python -m ruff format`: il contenuto arriva
// su stdin e il risultato su stdout, con `--stdin-filename` il percorso reale così Ruff trova il
// pyproject.toml del progetto. Non installa nulla e non scrive file.
func (*Language) FormatTool(request language.FormatRequest) (run.CommandSpec, bool, string, error) {
	interpreter, err := ResolveInterpreter(request.Root, request.WorkingDirectory, "")
	if err != nil {
		return run.CommandSpec{}, false, "select a Python interpreter to format this file", nil
	}
	path := request.Path
	if path == "" {
		path = filepath.Join(request.WorkingDirectory, filepath.FromSlash(request.RelativePath))
	}
	arguments := []string{"-m", "ruff", "format", "--stdin-filename", path, "-"}
	return run.CommandSpec{
		Executable:       interpreter.Path,
		Arguments:        arguments,
		WorkingDirectory: request.WorkingDirectory,
		DisplayCommand:   fmt.Sprintf("%s -m ruff format %s", filepath.Base(interpreter.Path), request.RelativePath),
	}, true, "", nil
}
