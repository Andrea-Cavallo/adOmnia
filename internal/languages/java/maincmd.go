package java

import (
	"fmt"
	"os"
	"path/filepath"
	"strconv"
	"strings"

	"adomnia/internal/ide/run"
)

// MainOptions sono le LanguageOptions di una configurazione Run di kind "main": la classe da eseguire e le
// opzioni della JVM. Gli argomenti del programma stanno in ProgramArguments, come per ogni altro kind.
type MainOptions struct {
	MainClass string   `json:"mainClass"`
	VMOptions []string `json:"vmOptions,omitempty"`
	// JavaHome sceglie il JDK di questa configurazione; vuoto = quello del progetto, poi JAVA_HOME/PATH.
	JavaHome string `json:"javaHome,omitempty"`
}

const (
	maxMainArguments  = 128
	maxClassNameBytes = 300
)

// ValidClassName accetta solo nomi qualificati (identificatori separati da punti): il nome finisce negli
// argomenti di Maven/Gradle e del debug adapter e non deve poter contenere altro.
func ValidClassName(name string) bool {
	if name == "" || len(name) > maxClassNameBytes {
		return false
	}
	for _, part := range strings.Split(name, ".") {
		if part == "" || (part[0] >= '0' && part[0] <= '9') {
			return false
		}
		for _, r := range part {
			if r != '_' && r != '$' && (r < 'a' || r > 'z') && (r < 'A' || r > 'Z') && (r < '0' || r > '9') {
				return false
			}
		}
	}
	return true
}

// validate controlla classe e opzioni JVM (devono sembrare opzioni, su una sola riga).
func (o MainOptions) validate() error {
	if !ValidClassName(o.MainClass) {
		return fmt.Errorf("%q is not a Java class name: use the qualified name, e.g. it.acme.App", o.MainClass)
	}
	if len(o.VMOptions) > maxMainArguments {
		return fmt.Errorf("too many VM options: at most %d", maxMainArguments)
	}
	if o.JavaHome != "" && !ValidJavaHome(o.JavaHome) {
		return fmt.Errorf("%q is not a JDK folder: it must contain bin/java", o.JavaHome)
	}
	for _, option := range o.VMOptions {
		if !strings.HasPrefix(option, "-") || strings.ContainsAny(option, "\r\n\x00") {
			return fmt.Errorf("VM option %q must start with - (for example -Xmx512m or -Dkey=value)", option)
		}
	}
	return nil
}

// MainCommand esegue una classe `main` del modulo senza opzioni aggiuntive (▶ nel gutter).
func MainCommand(module, mainClass string) (executable string, arguments []string, display string, err error) {
	executable, arguments, display, _, err = MainCommandWith(module, MainOptions{MainClass: mainClass}, nil)
	return
}

// MainCommandWith è il comando che esegue una classe `main` del modulo con opzioni JVM e argomenti.
// Maven compila e usa exec:java, che gira nella JVM di Maven: le opzioni JVM passano da MAVEN_OPTS
// (environment). Gradle usa un task JavaExec registrato da uno script di init, quindi funziona
// anche senza il plugin `application`.
func MainCommandWith(module string, options MainOptions, programArguments []string) (executable string, arguments []string, display string, environment []string, err error) {
	if err := options.validate(); err != nil {
		return "", nil, "", nil, err
	}
	if len(programArguments) > maxMainArguments {
		return "", nil, "", nil, fmt.Errorf("too many program arguments: at most %d", maxMainArguments)
	}
	unit, ok := unitIn(module)
	if !ok {
		return "", nil, "", nil, fmt.Errorf("no pom.xml or build.gradle in %s", filepath.ToSlash(module))
	}
	tool, ok := resolveBuildTool(unit)
	if !ok {
		return "", nil, "", nil, fmt.Errorf("neither the project wrapper nor the build tool was found: install it or add the wrapper to the project")
	}
	if unit.Kind == UnitGradle {
		script, scriptErr := gradleInitScript()
		if scriptErr != nil {
			return "", nil, "", nil, scriptErr
		}
		arguments = gradleMainArguments(script, options, programArguments)
	} else {
		arguments = mavenMainArguments(options, programArguments)
		if len(options.VMOptions) > 0 {
			environment = []string{"MAVEN_OPTS=" + strings.TrimSpace(os.Getenv("MAVEN_OPTS")+" "+strings.Join(options.VMOptions, " "))}
		}
	}
	environment = append(environment, JavaEnvironment(options.JavaHome)...)
	executable = tool.resolve(unit)
	if err := run.CheckBatchSafe(executable, arguments); err != nil {
		return "", nil, "", nil, err
	}
	return executable, arguments, tool.Label + " " + strings.Join(arguments, " "), environment, nil
}

func mavenMainArguments(options MainOptions, programArguments []string) []string {
	arguments := []string{"-B", "compile", execPlugin + ":java", "-Dexec.mainClass=" + options.MainClass}
	if len(programArguments) > 0 {
		arguments = append(arguments, "-Dexec.args="+joinArguments(programArguments))
	}
	return arguments
}

// gradleInitScript scrive (se serve) lo script di init che registra `adomniaRun`: JavaExec sul runtime
// classpath del modulo, con classe, opzioni JVM e argomenti passati come -P numerati (nessun parsing di stringhe).
func gradleInitScript() (string, error) {
	base, err := os.UserCacheDir()
	if err != nil {
		base = os.TempDir()
	}
	dir := filepath.Join(base, "adomnia", "java")
	path := filepath.Join(dir, "adomnia-main.init.gradle")
	if existing, readErr := os.ReadFile(path); readErr == nil && string(existing) == gradleInitSource {
		return path, nil
	}
	if err := os.MkdirAll(dir, 0o755); err != nil {
		return "", fmt.Errorf("cannot prepare the Gradle run script: %w", err)
	}
	if err := os.WriteFile(path, []byte(gradleInitSource), 0o644); err != nil {
		return "", fmt.Errorf("cannot write the Gradle run script: %w", err)
	}
	return path, nil
}

const gradleInitSource = `allprojects {
  plugins.withId('java') {
    tasks.register('adomniaRun', JavaExec) {
      group = 'adomnia'
      classpath = sourceSets.main.runtimeClasspath
      mainClass = providers.gradleProperty('adomniaMain')
      standardInput = System.in
      def collect = { prefix ->
        def values = []
        for (int i = 0; project.hasProperty(prefix + i); i++) { values << project.property(prefix + i).toString() }
        values
      }
      jvmArgs = collect('adomniaVm')
      args = collect('adomniaArg')
    }
  }
}
`

func gradleMainArguments(script string, options MainOptions, programArguments []string) []string {
	arguments := []string{"--console=plain", "-I", script, "-PadomniaMain=" + options.MainClass}
	for i, option := range options.VMOptions {
		arguments = append(arguments, "-PadomniaVm"+strconv.Itoa(i)+"="+option)
	}
	for i, argument := range programArguments {
		arguments = append(arguments, "-PadomniaArg"+strconv.Itoa(i)+"="+argument)
	}
	return append(arguments, "adomniaRun")
}
