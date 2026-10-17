package codestudio

import (
	"context"
	"encoding/json"
	"fmt"
	"os"
	"strconv"
	"strings"
	"time"

	"adomnia/internal/ide/dap"
	"adomnia/internal/languages/java"
)

// Debug Java: il Java Debug Server è un plugin di JDT LS. L'host chiede a JDT LS (workspace/executeCommand)
// il progetto, il classpath e il JDK della classe, fa aprire un endpoint DAP e vi collega il DebugManager
// generico: breakpoint, step, variabili e valutazione sono quelli di ogni altro linguaggio.

const (
	javaDebugResolveTimeout = 90 * time.Second
	javaDebugRetryEvery     = 2 * time.Second
)

// JavaDebugRequest chiede il debug di una classe con `main`.
type JavaDebugRequest struct {
	SessionID SessionID `json:"sessionId"`
	// MainClass è il nome qualificato, es. it.acme.App.
	MainClass string `json:"mainClass"`
	// WorkingDirectory è la cartella del programma, relativa al progetto ("" = radice).
	WorkingDirectory string            `json:"workingDirectory,omitempty"`
	ProgramArguments []string          `json:"programArguments,omitempty"`
	VMArguments      []string          `json:"vmArguments,omitempty"`
	Environment      map[string]string `json:"environment,omitempty"`
}

// StartJavaDebug avvia il debug di una classe con `main` per un progetto autorizzato, su azione esplicita.
func (s *Service) StartJavaDebug(request JavaDebugRequest) (DebugSessionInfo, error) {
	session, err := s.session(string(request.SessionID))
	if err != nil {
		return DebugSessionInfo{}, err
	}
	if session.Project.Authorization != AuthorizationPermitted {
		return DebugSessionInfo{}, fmt.Errorf("explicitly authorize the tools for this project")
	}
	if !validJavaClassName(request.MainClass) {
		return DebugSessionInfo{}, fmt.Errorf("%q is not a Java class name", request.MainClass)
	}
	workingDirectory, err := s.documents.resolveDirectory(session.Project, request.WorkingDirectory)
	if err != nil {
		return DebugSessionInfo{}, err
	}
	if status := s.lsp.Status(session.ID, java.ID); status.State != LanguageServerReady {
		if _, err := s.StartProvidedLanguageServer(string(session.ID), java.ID); err != nil {
			return DebugSessionInfo{}, fmt.Errorf("the Java language server is needed to debug: %w", err)
		}
	}
	options, err := s.resolveJavaDebug(session, request)
	if err != nil {
		return DebugSessionInfo{}, err
	}
	options.ProgramArguments, options.VMArguments, options.Environment = request.ProgramArguments, request.VMArguments, request.Environment
	data, err := json.Marshal(options)
	if err != nil {
		return DebugSessionInfo{}, err
	}
	spec, err := java.New().DebugAdapter(dap.LaunchRequest{WorkingDirectory: workingDirectory, Environment: os.Environ(), LanguageOptions: data})
	if err != nil {
		return DebugSessionInfo{}, err
	}
	s.seedBreakpoints(session)
	return s.debug.DebugManager.Start(dap.Launch{SessionID: session.ID, Root: session.Project.RealPath, Spec: spec})
}

// resolveJavaDebug interroga JDT LS: progetto della classe, classpath, JDK e porta del debug adapter.
// JDT LS importa il progetto in background: finché non ha finito i comandi falliscono, quindi si riprova.
func (s *Service) resolveJavaDebug(session Session, request JavaDebugRequest) (java.DebugOptions, error) {
	ctx, cancel := context.WithTimeout(context.Background(), javaDebugResolveTimeout)
	defer cancel()
	options := java.DebugOptions{MainClass: request.MainClass}
	var lastErr error
	for {
		if ctx.Err() != nil {
			return options, fmt.Errorf("JDT LS could not prepare %s for debugging (the project may still be importing, or it does not compile): %v", request.MainClass, lastErr)
		}
		if lastErr = s.tryResolveJavaDebug(ctx, session, &options); lastErr == nil {
			return options, nil
		}
		select {
		case <-ctx.Done():
		case <-time.After(javaDebugRetryEvery):
		}
	}
}

func (s *Service) tryResolveJavaDebug(ctx context.Context, session Session, options *java.DebugOptions) error {
	call := func(command string, arguments ...any) (json.RawMessage, error) {
		return s.lsp.ExecuteCommand(ctx, session.ID, java.ID, command, arguments...)
	}
	var mains []struct {
		MainClass   string `json:"mainClass"`
		ProjectName string `json:"projectName"`
	}
	raw, err := call(java.CommandResolveMainClass, fileURI(session.Project.RealPath))
	if err != nil {
		return err
	}
	if json.Unmarshal(raw, &mains) != nil {
		return fmt.Errorf("unexpected answer from the Java language server")
	}
	options.ProjectName = ""
	for _, main := range mains {
		if main.MainClass == options.MainClass {
			options.ProjectName = main.ProjectName
			break
		}
	}
	if options.ProjectName == "" {
		return fmt.Errorf("%s is not a main class of this project", options.MainClass)
	}
	var classpath [][]string
	if raw, err = call(java.CommandResolveClasspath, options.MainClass, options.ProjectName); err != nil {
		return err
	}
	if json.Unmarshal(raw, &classpath) != nil || len(classpath) != 2 {
		return fmt.Errorf("unexpected classpath answer from the Java language server")
	}
	options.ModulePaths, options.ClassPaths = classpath[0], classpath[1]
	if raw, err = call(java.CommandResolveJavaExec, options.MainClass, options.ProjectName); err != nil {
		return err
	}
	_ = json.Unmarshal(raw, &options.JavaExec)
	if raw, err = call(java.CommandStartDebugSession); err != nil {
		return err
	}
	port, err := strconv.Atoi(strings.TrimSpace(string(raw)))
	if err != nil || port <= 0 {
		return fmt.Errorf("the Java debug server did not return a port")
	}
	options.Address = "127.0.0.1:" + strconv.Itoa(port)
	return nil
}

// validJavaClassName accetta solo nomi qualificati (identificatori separati da punti): il nome finisce
// negli argomenti del debug adapter e non deve poter contenere altro.
func validJavaClassName(name string) bool {
	if name == "" || len(name) > 300 {
		return false
	}
	for _, part := range strings.Split(name, ".") {
		if part == "" || (part[0] >= '0' && part[0] <= '9') {
			return false
		}
		for _, r := range part {
			if !(r == '_' || r == '$' || r >= 'a' && r <= 'z' || r >= 'A' && r <= 'Z' || r >= '0' && r <= '9') {
				return false
			}
		}
	}
	return true
}

// StartJavaMain esegue una classe con `main` (▶ nel gutter) nel modulo che contiene il file, senza una
// configurazione salvata: stesso comando delle proposte Run, visibile nella console Run.
func (s *Service) StartJavaMain(sessionID, relativeFile, mainClass string) (Execution, error) {
	session, err := s.session(sessionID)
	if err != nil {
		return Execution{}, err
	}
	if session.Project.Authorization != AuthorizationPermitted {
		return Execution{}, fmt.Errorf("explicitly authorize the tools for this project")
	}
	if !validJavaClassName(mainClass) {
		return Execution{}, fmt.Errorf("%q is not a Java class name", mainClass)
	}
	file, err := s.documents.ResolveProjectPath(session.Project, relativeFile)
	if err != nil {
		return Execution{}, err
	}
	module, ok := java.ModuleOf(session.Project.RealPath, file)
	if !ok {
		return Execution{}, fmt.Errorf("no pom.xml or build.gradle contains %s", relativeFile)
	}
	executable, arguments, display, err := java.MainCommand(module, mainClass)
	if err != nil {
		return Execution{}, err
	}
	environment, err := s.executionEnvironment(session.ID, java.ID, nil)
	if err != nil {
		return Execution{}, err
	}
	return s.processes.Start(CommandSpec{
		SessionID: session.ID, Kind: "run", Executable: executable, Arguments: arguments,
		WorkingDirectory: module, Environment: environment, DisplayCommand: display,
	})
}
