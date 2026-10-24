package java

import (
	"fmt"
	"slices"
	"strconv"
	"strings"
)

// GradleDebugPort è la porta fissa di `--debug-jvm` (Gradle non permette di sceglierla in modo portabile).
const GradleDebugPort = 5005

// QuarkusDebugPort è la porta JDWP di default del dev mode di Quarkus (`quarkus.debug.port`):
// è già in ascolto senza bisogno di iniettare un agent.
const QuarkusDebugPort = 5005

// jdwpAgent è l'argomento JVM che mette il processo in attesa di un debugger sulla porta.
func jdwpAgent(port int) string {
	return "-agentlib:jdwp=transport=dt_socket,server=y,suspend=y,address=127.0.0.1:" + strconv.Itoa(port)
}

// DebugArguments aggiunge ai comandi Maven/Gradle di un'unità l'apertura di una porta JDWP in attesa del
// debugger: test (surefire/failsafe), Spring Boot e task JavaExec. Maven sceglie la porta, Gradle usa
// GradleDebugPort (il chiamante la passa in `port` solo per Maven e legge il numero effettivo dal risultato).
func DebugArguments(unitKind string, arguments []string, port int) ([]string, int, error) {
	if unitKind == UnitGradle {
		for index, argument := range arguments {
			task := argument[strings.LastIndex(argument, ":")+1:]
			// Quarkus dev mode espone già JDWP sulla porta di default: non serve `--debug-jvm`,
			// che anzi aprirebbe una seconda porta che nessuno ascolta.
			if !strings.HasPrefix(argument, "-") && task == "quarkusDev" {
				return slices.Clone(arguments), QuarkusDebugPort, nil
			}
			if !strings.HasPrefix(argument, "-") && (task == "test" || task == "bootRun" || task == "run" || task == "adomniaRun") {
				if slices.Contains(arguments, "--debug-jvm") {
					return slices.Clone(arguments), GradleDebugPort, nil
				}
				out := slices.Insert(slices.Clone(arguments), index+1, "--debug-jvm")
				return out, GradleDebugPort, nil
			}
		}
		return nil, 0, fmt.Errorf("Gradle can debug the test, run, bootRun and quarkusDev tasks: this configuration has none of them")
	}
	switch {
	case slices.Contains(arguments, "quarkus:dev"):
		// Quarkus dev mode ha già il debugger in ascolto sulla porta di default: si lasciano
		// gli argomenti intatti e ci si collega, senza iniettare un agent JDWP.
		return slices.Clone(arguments), QuarkusDebugPort, nil
	case slices.Contains(arguments, "spring-boot:run"):
		const prefix = "-Dspring-boot.run.jvmArguments="
		out := make([]string, 0, len(arguments)+1)
		vm := ""
		for _, argument := range arguments {
			if strings.HasPrefix(argument, prefix) {
				vm = strings.TrimPrefix(argument, prefix)
			} else {
				out = append(out, argument)
			}
		}
		if strings.Contains(vm, "-agentlib:jdwp") || strings.Contains(vm, "-Xrunjdwp") {
			return nil, 0, fmt.Errorf("remove the existing JDWP agent from Spring Boot VM options before starting Debug")
		}
		vm = strings.TrimSpace(jdwpAgent(port) + " " + vm + " -Dspring.devtools.restart.enabled=false")
		return append(out, prefix+vm), port, nil
	case hasGoal(arguments, "test", "verify", "integration-test"):
		agent := jdwpAgent(port)
		return append(slices.Clone(arguments), "-Dmaven.surefire.debug="+agent, "-Dmaven.failsafe.debug="+agent), port, nil
	}
	return nil, 0, fmt.Errorf("Maven can debug test, spring-boot:run and quarkus:dev configurations; a plain main class is debugged directly with Debug")
}

// GradleTaskModule restringe l'ambito del debug al modulo di un task path (`:app:bootRun` → `<root>/app`).
// Senza task path qualificato, o con una cartella che non è un modulo Gradle, resta la radice: il chiamante
// non deve far fallire il debug per una cartella indovinata male.
func GradleTaskModule(root string, arguments []string) string {
	for _, argument := range arguments {
		if !strings.HasPrefix(argument, ":") {
			continue
		}
		path := strings.Split(strings.Trim(argument, ":"), ":")
		if len(path) < 2 {
			continue
		}
		module := containedDirectory(root, root, strings.Join(path[:len(path)-1], "/"))
		if module == "" {
			continue
		}
		if _, ok := unitIn(module); ok {
			return module
		}
	}
	return root
}

func hasGoal(arguments []string, goals ...string) bool {
	return slices.ContainsFunc(arguments, func(argument string) bool {
		return !strings.HasPrefix(argument, "-") && slices.Contains(goals, argument)
	})
}

// TestDebugArguments sono gli argomenti di build per eseguire un solo test (o tutta la classe) del file.
func TestDebugArguments(unitKind, relativeTestFile, method string) ([]string, error) {
	if method != "" && !methodName.MatchString(method) {
		return nil, fmt.Errorf("invalid test method %q", method)
	}
	return testArguments(unitKind, []string{className(relativeTestFile)}, method), nil
}

// BuildToolOf è l'eseguibile, il nome mostrato e il tipo (UnitMaven/UnitGradle) con cui costruire il modulo.
func BuildToolOf(module string) (executable, label, kind string, err error) {
	unit, ok := unitIn(module)
	if !ok {
		return "", "", "", fmt.Errorf("no pom.xml or build.gradle in %s", module)
	}
	tool, ok := resolveBuildTool(unit)
	if !ok {
		return "", "", "", fmt.Errorf("neither the project wrapper nor the build tool was found: install it or add the wrapper to the project")
	}
	return tool.resolve(unit), tool.Label, unit.Kind, nil
}
