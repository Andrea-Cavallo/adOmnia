package web

import (
	"context"
	"strings"

	"github.com/Andrea-Cavallo/adOmnia/internal/ide/project"
	"github.com/Andrea-Cavallo/adOmnia/internal/ide/run"
)

// Suggest propone gli script dev, build e test di un package.json come comandi del package manager
// reale (lockfile o campo packageManager), senza shell. I siti statici sono serviti da Live Preview.
func (scriptAdapter) Suggest(_ context.Context, projectRoot string, unit project.Unit) []run.Suggestion {
	if unit.Language != ScriptID || unit.Kind != UnitNode {
		return nil
	}
	info, err := Inspect(projectRoot, unit.Root)
	if err != nil || info.Kind != UnitNode {
		return nil
	}
	label := info.Tool
	if label == "" {
		label = "Node"
	}
	label = strings.ToUpper(label[:1]) + label[1:]
	scripts := []struct{ action, script, idSuffix string }{
		{"run", info.DevScript, ""}, {"build", "build", ""}, {"test", "test", ""},
		// Dopo `build`, Next e Nest si avviano in produzione con il loro script dedicato.
		{"run", productionScript(info), "|production"},
	}
	suggestions := make([]run.Suggestion, 0, len(scripts))
	for _, entry := range scripts {
		if entry.script == "" || info.Scripts[entry.script] == "" || (entry.idSuffix != "" && entry.script == info.DevScript) {
			continue
		}
		arguments := RunScriptArguments(info.PackageManager, entry.script, nil)
		command := info.PackageManager + " " + strings.Join(arguments, " ")
		suggestions = append(suggestions, run.Suggestion{
			ID: ScriptID + "|" + unit.Root + "|" + entry.action + entry.idSuffix, Language: ScriptID, Action: entry.action, UnitRoot: unit.Root,
			Title: label + " · " + command,
			Configuration: run.Configuration{
				Language: ScriptID, Name: label + " " + entry.script, Kind: "command",
				Target: info.PackageManager, ProgramArguments: arguments,
			},
		})
	}
	return suggestions
}

// productionScript è lo script che avvia l'app già compilata, per gli strumenti che ne hanno uno standard.
func productionScript(info Info) string {
	switch info.Tool {
	case ToolNext:
		return "start"
	case ToolNest:
		return "start:prod"
	}
	return ""
}
