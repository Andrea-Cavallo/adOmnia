package java

import (
	"fmt"
	"slices"
	"strconv"
	"strings"
)

// GradleDebugPort è la porta fissa di `--debug-jvm` (Gradle non permette di sceglierla in modo portabile).
const GradleDebugPort = 5005

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
			if argument == "test" || argument == "bootRun" || argument == "run" || argument == "adomniaRun" {
				out := slices.Insert(slices.Clone(arguments), index+1, "--debug-jvm")
				return out, GradleDebugPort, nil
			}
		}
		return nil, 0, fmt.Errorf("Gradle can debug the test, run and bootRun tasks: this configuration has none of them")
	}
	switch {
	case slices.Contains(arguments, "spring-boot:run"):
		return append(slices.Clone(arguments), "-Dspring-boot.run.jvmArguments="+jdwpAgent(port)), port, nil
	case hasGoal(arguments, "test", "verify", "integration-test"):
		agent := jdwpAgent(port)
		return append(slices.Clone(arguments), "-Dmaven.surefire.debug="+agent, "-Dmaven.failsafe.debug="+agent), port, nil
	}
	return nil, 0, fmt.Errorf("Maven can debug test and spring-boot:run configurations; a plain main class is debugged directly with Debug")
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
