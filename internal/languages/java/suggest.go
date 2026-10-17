package java

import (
	"context"
	"path/filepath"
	"runtime"
	"strings"

	"adomnia/internal/ide/project"
	"adomnia/internal/ide/run"
)

// buildTool è il comando con cui si esegue il build di un'unità: il wrapper del progetto se c'è
// (mvnw, gradlew: versione di Maven/Gradle decisa dal progetto), altrimenti lo strumento nel PATH.
type buildTool struct {
	// Target è il valore per una configurazione `command`: un percorso relativo alla cartella dell'unità
	// per il wrapper, un nome per lo strumento di sistema.
	Target string
	// Label è il nome mostrato (`./mvnw`, `mvn`).
	Label string
}

func resolveBuildTool(unit project.Unit) (buildTool, bool) {
	wrapper, system := "mvnw", "mvn"
	if unit.Kind == UnitGradle {
		wrapper, system = "gradlew", "gradle"
	}
	script := wrapper
	if runtime.GOOS == "windows" {
		script += ".cmd"
		if unit.Kind == UnitGradle {
			script = wrapper + ".bat"
		}
	}
	if isFile(filepath.Join(unit.Root, script)) {
		return buildTool{Target: "./" + script, Label: "./" + wrapper}, true
	}
	if _, err := lookPath(system); err == nil {
		return buildTool{Target: system, Label: system}, true
	}
	return buildTool{}, false
}

// Suggest propone test e build dell'unità e, per Spring Boot, il run dell'applicazione. Senza wrapper né
// Maven/Gradle nel PATH non propone nulla: una card che non si può avviare è peggio di nessuna card.
func (*Language) Suggest(_ context.Context, _ string, unit project.Unit) []run.Suggestion {
	if unit.Language != ID || (unit.Kind != UnitMaven && unit.Kind != UnitGradle) {
		return nil
	}
	tool, ok := resolveBuildTool(unit)
	if !ok {
		return nil
	}
	type entry struct {
		action, name string
		arguments    []string
	}
	var entries []entry
	if unit.Kind == UnitMaven {
		entries = []entry{{"test", "test", []string{"test"}}, {"build", "package", []string{"package"}}}
		if readPom(unit.Manifest).usesSpringBoot() {
			entries = append([]entry{{"run", "Spring Boot", []string{"spring-boot:run"}}}, entries...)
		}
	} else {
		entries = []entry{{"test", "test", []string{"test"}}, {"build", "build", []string{"build"}}}
		if gradleUsesSpringBoot(unit.Manifest) {
			entries = append([]entry{{"run", "Spring Boot", []string{"bootRun"}}}, entries...)
		}
	}
	label := "Maven"
	if unit.Kind == UnitGradle {
		label = "Gradle"
	}
	suggestions := make([]run.Suggestion, 0, len(entries))
	for _, item := range entries {
		suggestions = append(suggestions, run.Suggestion{
			ID: ID + "|" + unit.Root + "|" + item.action, Language: ID, Action: item.action, UnitRoot: unit.Root,
			Title: label + " · " + tool.Label + " " + strings.Join(item.arguments, " "),
			Configuration: run.Configuration{
				Language: ID, Name: label + " " + item.name, Kind: "command",
				Target: tool.Target, ProgramArguments: item.arguments,
			},
		})
	}
	return suggestions
}
