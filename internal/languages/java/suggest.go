package java

import (
	"context"
	"path/filepath"
	"regexp"
	"runtime"
	"strings"

	"adomnia/internal/ide/project"
	"adomnia/internal/ide/run"
	"adomnia/internal/jsonutil"
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
	if isFile(filepath.Join(unit.Root, script)) && isFile(filepath.Join(unit.Root, wrapperSupport(unit.Kind))) {
		return buildTool{Target: "./" + script, Label: "./" + wrapper}, true
	}
	if _, err := lookPath(system); err == nil {
		return buildTool{Target: system, Label: system}, true
	}
	return buildTool{}, false
}

// wrapperSupport è il file senza cui lo script del wrapper non parte (un `mvnw` copiato senza `.mvn/` fallisce
// con "No such file or directory"): in quel caso si usa lo strumento di sistema.
func wrapperSupport(kind string) string {
	if kind == UnitGradle {
		return filepath.Join("gradle", "wrapper", "gradle-wrapper.properties")
	}
	return filepath.Join(".mvn", "wrapper", "maven-wrapper.properties")
}

// resolve è il percorso dell'eseguibile: il wrapper dentro l'unità o lo strumento trovato nel PATH.
func (t buildTool) resolve(unit project.Unit) string {
	if strings.HasPrefix(t.Target, "./") {
		return filepath.Join(unit.Root, filepath.FromSlash(strings.TrimPrefix(t.Target, "./")))
	}
	if found, err := lookPath(t.Target); err == nil {
		return found
	}
	return t.Target
}

// suggestEntry è una proposta prima di diventare una Configuration.
type suggestEntry struct {
	action, name string
	arguments    []string
	// id distingue più proposte della stessa azione (una per classe main).
	id string
	// main è la classe da eseguire: la proposta diventa una configurazione di kind "main" nel suo modulo.
	main *mainClass
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
		entries = []suggestEntry{
			{action: "test", name: "test", arguments: []string{"test"}},
			{action: "build", name: "package", arguments: []string{"package"}},
			{action: "build", name: "compile", arguments: []string{"compile"}, id: ":compile"},
			{action: "build", name: "clean install", arguments: []string{"clean", "install"}, id: ":clean-install"},
			{action: "build", name: "clean", arguments: []string{"clean"}, id: ":clean"},
		}
		pom := readPom(unit.Manifest)
		switch {
		case pom.usesSpringBoot():
			entries = append([]suggestEntry{{action: "run", name: "Spring Boot", arguments: []string{"spring-boot:run"}}}, entries...)
		case pom.usesGroup("io.quarkus"):
			entries = append([]suggestEntry{{action: "run", name: "Quarkus dev", arguments: []string{"quarkus:dev"}}}, entries...)
		case pom.usesGroup("io.micronaut"):
			entries = append([]suggestEntry{{action: "run", name: "Micronaut", arguments: []string{"mn:run"}}}, entries...)
		}
		entries = append(entries, mainEntries(unit)...)
	} else {
		entries = []suggestEntry{
			{action: "test", name: "test", arguments: []string{"test"}},
			{action: "build", name: "build", arguments: []string{"build"}},
			{action: "build", name: "clean build", arguments: []string{"clean", "build"}, id: ":clean-build"},
			{action: "build", name: "clean", arguments: []string{"clean"}, id: ":clean"},
		}
		if gradleUsesSpringBoot(unit.Manifest) {
			entries = append([]suggestEntry{{action: "run", name: "Spring Boot", arguments: []string{"bootRun"}}}, entries...)
		} else if gradleMentions(unit.Manifest, "io.quarkus") {
			entries = append([]suggestEntry{{action: "run", name: "Quarkus dev", arguments: []string{"quarkusDev"}}}, entries...)
		} else if gradleMentions(unit.Manifest, "io.micronaut") {
			entries = append([]suggestEntry{{action: "run", name: "Micronaut", arguments: []string{"run"}}}, entries...)
		} else if gradleUsesApplication(unit.Manifest) {
			entries = append([]suggestEntry{{action: "run", name: "application", arguments: []string{"run"}}}, entries...)
		}
		entries = append(entries, mainEntries(unit)...)
	}
	label := "Maven"
	if unit.Kind == UnitGradle {
		label = "Gradle"
	}
	suggestions := make([]run.Suggestion, 0, len(entries))
	for _, item := range entries {
		if item.main != nil {
			suggestions = append(suggestions, mainSuggestion(unit, item))
			continue
		}
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

// mainEntries propone una configurazione "main" per ogni classe con `main` trovata nei moduli. Le app Spring
// Boot dei moduli Maven restano `spring-boot:run` (con `-f` per il modulo): la working directory è quella dell'unità.
func mainEntries(unit project.Unit) []suggestEntry {
	var entries []suggestEntry
	for _, found := range findMainClasses(unit.Root) {
		simple := found.Class[strings.LastIndex(found.Class, ".")+1:]
		module := moduleFlag(unit.Root, found.Module)
		switch {
		case found.Spring && unit.Kind == UnitGradle:
			// bootRun è già proposto per l'unità.
		case found.Spring && module == nil:
			// L'app Spring Boot dell'unità radice è già proposta come "Spring Boot".
		case found.Spring:
			entries = append(entries, suggestEntry{action: "run", name: "Spring Boot " + simple, id: ":" + found.Class, arguments: append(module, "spring-boot:run")})
		default:
			entries = append(entries, suggestEntry{action: "run", name: "main " + simple, id: ":" + found.Class, main: &found})
		}
	}
	return entries
}

// mainSuggestion è la proposta di una classe main: kind "main", classe nelle LanguageOptions, working
// directory = modulo che la contiene (UnitRoot, da cui l'host ricava il percorso relativo).
func mainSuggestion(unit project.Unit, item suggestEntry) run.Suggestion {
	simple := item.main.Class[strings.LastIndex(item.main.Class, ".")+1:]
	options, _ := jsonutil.Marshal(MainOptions{MainClass: item.main.Class})
	return run.Suggestion{
		ID: ID + "|" + unit.Root + "|" + item.action + item.id, Language: ID, Action: item.action, UnitRoot: item.main.Module,
		Title: "Java · main " + simple,
		Configuration: run.Configuration{
			Language: ID, Name: "Main " + simple, Kind: KindMain, LanguageOptions: options,
		},
	}
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
