// Package python implements local Python project detection and script/module execution.
// Detection only reads file names; it never imports or executes project code.
package python

import (
	"path/filepath"
	"sort"
	"strings"

	"github.com/Andrea-Cavallo/adOmnia/internal/ide/project"
)

const ID = "python"

type Language struct{}

func New() *Language           { return &Language{} }
func (*Language) ID() string   { return ID }
func (*Language) Name() string { return "Python" }

// ServersPerUnit dichiara che il language server va avviato una volta per unità: basedpyright
// risolve gli import con un solo interprete per processo, quindi due unità con venv diversi nello
// stesso server multi-root si vedrebbero l'ambiente di una sola (PY-4.2). Con un server per unità
// ognuno riceve il proprio `python.pythonPath` e una sola cartella di lavoro.
func (*Language) ServersPerUnit() bool { return true }
func (*Language) DocumentLanguageID(path string) (string, bool) {
	switch strings.ToLower(filepath.Ext(path)) {
	case ".py", ".pyi":
		return ID, true
	}
	return "", false
}

// DirectDependencies implementa language.DirectDependencies: i pacchetti dichiarati dall'unità
// (pyproject.toml e requirements*.txt), normalizzati come PEP 503 — minuscolo, trattini. Le
// dipendenze di sviluppo restano fuori: non descrivono i servizi che il programma usa a runtime.
// Serve a Project Services: un progetto che usa psycopg o redis apre Database Studio e Broker con
// quel servizio già scelto, come accade per un go.mod.
func (*Language) DirectDependencies(unit project.Unit) []string {
	names := dependencyNames(readManifest(unit.Root).Dependencies)
	result := make([]string, 0, len(names))
	for name := range names {
		result = append(result, name)
	}
	sort.Strings(result)
	return result
}
