package java

import (
	"context"
	"path/filepath"
	"regexp"
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

// suggestEntry è una proposta prima di diventare una Configuration.
type suggestEntry struct {
	action, name string
	arguments    []string
	// id distingue più proposte della stessa azione (una per classe main).
	id string
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
	var entries []suggestEntry
	if unit.Kind == UnitMaven {
		entries = []suggestEntry{{action: "test", name: "test", arguments: []string{"test"}}, {action: "build", name: "package", arguments: []string{"package"}}}
		if readPom(unit.Manifest).usesSpringBoot() {
			entries = append([]suggestEntry{{action: "run", name: "Spring Boot", arguments: []string{"spring-boot:run"}}}, entries...)
		}
		entries = append(entries, mavenMainEntries(unit)...)
	} else {
		entries = []suggestEntry{{action: "test", name: "test", arguments: []string{"test"}}, {action: "build", name: "build", arguments: []string{"build"}}}
		if gradleUsesSpringBoot(unit.Manifest) {
			entries = append([]suggestEntry{{action: "run", name: "Spring Boot", arguments: []string{"bootRun"}}}, entries...)
		} else if gradleUsesApplication(unit.Manifest) {
			entries = append([]suggestEntry{{action: "run", name: "application", arguments: []string{"run"}}}, entries...)
		}
	}
	label := "Maven"
	if unit.Kind == UnitGradle {
		label = "Gradle"
	}
	suggestions := make([]run.Suggestion, 0, len(entries))
	for _, item := range entries {
		suggestions = append(suggestions, run.Suggestion{
			ID: ID + "|" + unit.Root + "|" + item.action + item.id, Language: ID, Action: item.action, UnitRoot: unit.Root,
			Title: label + " · " + tool.Label + " " + strings.Join(item.arguments, " "),
			Configuration: run.Configuration{
				Language: ID, Name: label + " " + item.name, Kind: "command",
				Target: tool.Target, ProgramArguments: item.arguments,
			},
		})
	}
	return suggestions
}

// mavenMainEntries propone una configurazione per ogni classe con `main` trovata nei moduli: le app Spring
// Boot dei moduli con `spring-boot:run`, le altre con exec:java (compila e poi esegue col classpath del modulo).
// Il modulo si seleziona con `-f`: la working directory resta quella dell'unità.
func mavenMainEntries(unit project.Unit) []suggestEntry {
	var entries []suggestEntry
	for _, main := range findMainClasses(unit.Root) {
		module := moduleFlag(unit.Root, main.Module)
		simple := main.Class[strings.LastIndex(main.Class, ".")+1:]
		switch {
		case main.Spring && module == nil:
			// L'app Spring Boot dell'unità radice è già proposta come "Spring Boot".
		case main.Spring:
			entries = append(entries, suggestEntry{action: "run", name: "Spring Boot " + simple, id: ":" + main.Class, arguments: append(module, "spring-boot:run")})
		default:
			arguments := append(append([]string{}, module...), "-B", "compile", execPlugin+":java", "-Dexec.mainClass="+main.Class)
			entries = append(entries, suggestEntry{action: "run", name: "main " + simple, id: ":" + main.Class, arguments: arguments})
		}
	}
	return entries
}

// execPlugin è exec-maven-plugin con coordinate complete: funziona senza dichiararlo nel pom.
const execPlugin = "org.codehaus.mojo:exec-maven-plugin:3.5.0"

// moduleFlag è `-f <modulo>/pom.xml` per un modulo diverso dall'unità; nil per l'unità stessa.
func moduleFlag(unitRoot, module string) []string {
	relative, err := filepath.Rel(unitRoot, module)
	if err != nil || relative == "." {
		return nil
	}
	return []string{"-f", filepath.ToSlash(filepath.Join(relative, "pom.xml"))}
}

// applicationPlugin riconosce il plugin `application` (id, apply plugin o riga nuda nel blocco plugins).
var applicationPlugin = regexp.MustCompile(`(?m)(\bid\s*\(?\s*["']application["']|apply\s+plugin:\s*["']application["']|plugins\s*\{[^}]*\bapplication\b|^\s*application\s*$)`)

// gradleUsesApplication riconosce il plugin `application`, che porta il task `run`.
func gradleUsesApplication(manifest string) bool {
	data, err := readLimited(manifest)
	return err == nil && applicationPlugin.Match(data)
}
