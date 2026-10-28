package codestudio

import (
	"encoding/json/v2"
	"os"

	"github.com/Andrea-Cavallo/adOmnia/internal/languages/java"
)

// javaDirectLaunch lancia la classe `main` con `java` diretto: classpath e JDK vengono da JDT LS (stesso JDK del
// Debug) e il comando non passa da Maven/Gradle, quindi non c'è il limite della riga di comando né MAVEN_OPTS.
// Ritorna false quando JDT LS non è pronto o non risolve la classe: allora vale il build tool (fallback).
func (s *Service) javaDirectLaunch(session Session, workingDirectory string, request RunRequest, environment []string) (CommandSpec, bool) {
	var options java.MainOptions
	if json.Unmarshal(request.LanguageOptions, &options) != nil {
		return CommandSpec{}, false
	}
	runtime, err := s.resolveJavaRuntime(session, options.MainClass, false)
	if err != nil {
		return CommandSpec{}, false
	}
	launch, err := java.DirectLaunch(options, request.ProgramArguments, runtime)
	if err != nil {
		return CommandSpec{}, false
	}
	launch.TempDir = os.TempDir()
	executable, arguments, cleanup, err := java.BuildLaunch(launch)
	if err != nil {
		return CommandSpec{}, false
	}
	return CommandSpec{
		Executable: executable, Arguments: arguments, WorkingDirectory: workingDirectory, Environment: environment,
		DisplayCommand: java.LaunchDisplay(launch), OnExit: func(Execution) { cleanup() },
	}, true
}
