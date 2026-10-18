package java

import (
	"encoding/json"
	"fmt"
	"strconv"
	"strings"

	"adomnia/internal/ide/run"
)

// Kind delle configurazioni Run Java: una classe `main` scelta dall'utente e un attach a una JVM remota.
const (
	KindMain   = "main"
	KindAttach = "attach"
)

// RunKinds implementa run.Runner.
func (*Language) RunKinds() []string { return []string{KindMain, KindAttach} }

// CommandSpec implementa run.Runner: la working directory della richiesta è il modulo (cartella con
// pom.xml o build.gradle) che contiene la classe.
func (*Language) CommandSpec(request run.Request) (run.CommandSpec, error) {
	if request.Kind == KindAttach {
		return run.CommandSpec{}, fmt.Errorf("a Remote JVM configuration only attaches the debugger: press Debug, not Run")
	}
	var options MainOptions
	if err := json.Unmarshal(request.LanguageOptions, &options); err != nil {
		return run.CommandSpec{}, fmt.Errorf("invalid Java main options: %w", err)
	}
	executable, arguments, display, extra, err := MainCommandWith(request.WorkingDirectory, options, request.ProgramArguments)
	if err != nil {
		return run.CommandSpec{}, err
	}
	return run.CommandSpec{
		Executable: executable, Arguments: arguments, WorkingDirectory: request.WorkingDirectory,
		Environment: append(append([]string(nil), request.Environment...), extra...), DisplayCommand: display,
	}, nil
}

// ValidateRunConfiguration checks provider options before persistence, without running tools.
func (*Language) ValidateRunConfiguration(config run.Configuration) error {
	switch string(config.Kind) {
	case KindMain:
		var options MainOptions
		if err := json.Unmarshal(config.LanguageOptions, &options); err != nil {
			return fmt.Errorf("enter a main class and valid VM options")
		}
		return options.validate()
	case KindAttach:
		var options struct {
			Host string `json:"host"`
			Port string `json:"port"`
		}
		if err := json.Unmarshal(config.LanguageOptions, &options); err != nil {
			return fmt.Errorf("enter a host and a JVM debug port")
		}
		port, err := strconv.Atoi(options.Port)
		if err != nil || port < 1 || port > 65535 {
			return fmt.Errorf("JVM debug port must be between 1 and 65535")
		}
		if strings.ContainsAny(options.Host, "\r\n\x00") {
			return fmt.Errorf("enter a valid JVM host")
		}
	}
	return nil
}

// RunSchema implementa run.SchemaProvider: i campi dei form "Java main class" e "Remote JVM".
func (*Language) RunSchema(kind string) run.FieldSchema {
	schema := run.FieldSchema{Language: ID, Kind: kind, Fields: []run.Field{}}
	switch kind {
	case KindMain:
		schema.Fields = []run.Field{
			{Key: "mainClass", Label: "Main class", Type: run.FieldText, Section: run.SectionBasic, Required: true, Help: "Qualified name, e.g. it.acme.App. Working directory = the Maven/Gradle module that contains it."},
			{Key: "vmOptions", Label: "VM options", Type: run.FieldList, Section: run.SectionBasic, Help: "-Xmx512m -Dspring.profiles.active=dev"},
			{Key: "javaHome", Label: "JDK home", Type: run.FieldPath, Section: run.SectionAdvanced, Help: "Empty = the project JDK (Java menu > Select JDK), then JAVA_HOME / PATH. Debug uses the same JDK."},
		}
	case KindAttach:
		schema.Fields = []run.Field{
			{Key: "host", Label: "Host", Type: run.FieldText, Section: run.SectionBasic, Default: "127.0.0.1", Help: "Where the JVM listens"},
			{Key: "port", Label: "Port", Type: run.FieldText, Section: run.SectionBasic, Required: true, Default: "5005", Help: "Start the JVM with -agentlib:jdwp=transport=dt_socket,server=y,suspend=n,address=*:5005"},
		}
	}
	return schema
}
