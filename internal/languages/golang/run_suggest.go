package golang

import (
	"context"
	"path/filepath"

	"github.com/Andrea-Cavallo/adOmnia/internal/ide/project"
	"github.com/Andrea-Cavallo/adOmnia/internal/ide/run"
)

// Suggest propone Run, Test e Build per un modulo Go. Il target "." viene risolto nel main package
// al momento dell'avvio (ResolveRunTarget), quindi non serve interrogare `go list` qui.
func (*Language) Suggest(_ context.Context, _ string, unit project.Unit) []run.Suggestion {
	if unit.Language != ID || unit.Kind != UnitModule {
		return nil
	}
	name := unit.Name
	if name == "" {
		name = filepath.Base(unit.Root)
	} else {
		name = filepath.Base(name)
	}
	suggestion := func(action, title, kind, target string) run.Suggestion {
		return run.Suggestion{
			ID: ID + "|" + unit.Root + "|" + action, Language: ID, Action: action, UnitRoot: unit.Root,
			Title:         "Go · " + title + " " + name,
			Configuration: run.Configuration{Language: ID, Name: title + " " + name, Kind: run.Kind(kind), Target: target},
		}
	}
	return []run.Suggestion{
		suggestion("run", "Run", "package", "."),
		suggestion("test", "Test", "test", "./..."),
		suggestion("build", "Build", "build", "."),
	}
}
