package codestudio

import (
	"context"
	"encoding/json"
	"fmt"
	"net"
	"os"
	"path/filepath"
	"strconv"
	"strings"
	"sync"
	"time"

	"adomnia/internal/ide/dap"
	"adomnia/internal/ide/run"
	"adomnia/internal/languages/java"
)

// Debug Java: il Java Debug Server è un plugin di JDT LS. L'host chiede a JDT LS (workspace/executeCommand)
// il progetto, il classpath e il JDK della classe, fa aprire un endpoint DAP e vi collega il DebugManager
// generico: breakpoint, step, variabili e valutazione sono quelli di ogni altro linguaggio.

const (
	javaDebugResolveTimeout = 90 * time.Second
	javaDebugRetryEvery     = 2 * time.Second
	// javaDebugBuildTimeout è quanto si attende che Maven/Gradle compili e la JVM apra la porta JDWP.
	javaDebugBuildTimeout = 10 * time.Minute
)

// JavaDebugRequest chiede il debug di una classe con `main` (MainClass), di un build Maven/Gradle con la JVM
// in attesa del debugger (BuildArguments o TestFile) o di una JVM già in ascolto (AttachPort).
type JavaDebugRequest struct {
	SessionID SessionID `json:"sessionId"`
	// MainClass è il nome qualificato, es. it.acme.App.
	MainClass string `json:"mainClass,omitempty"`
	// AttachHost e AttachPort collegano il debugger a una JVM avviata con -agentlib:jdwp=...,server=y.
	AttachHost string `json:"attachHost,omitempty"`
	AttachPort int    `json:"attachPort,omitempty"`
	// BuildArguments sono gli argomenti Maven/Gradle di una configurazione (test, spring-boot:run, bootRun):
	// l'host li esegue nella console Run con la porta JDWP aperta e vi si collega. WorkingDirectory è il modulo.
	BuildArguments []string `json:"buildArguments,omitempty"`
	// TestFile (relativo al progetto) e TestMethod ("" = tutta la classe) debuggano un test JUnit.
	TestFile   string `json:"testFile,omitempty"`
	TestMethod string `json:"testMethod,omitempty"`
	// WorkingDirectory è la cartella del programma, relativa al progetto ("" = radice).
	WorkingDirectory string            `json:"workingDirectory,omitempty"`
	ProgramArguments []string          `json:"programArguments,omitempty"`
	VMArguments      []string          `json:"vmArguments,omitempty"`
	Environment      map[string]string `json:"environment,omitempty"`
}

// StartJavaDebug avvia il debug Java per un progetto autorizzato, su azione esplicita: lancio di una classe,
// build con JVM in attesa del debugger (test, Spring Boot) o attach a una JVM in ascolto.
func (s *Service) StartJavaDebug(request JavaDebugRequest) (DebugSessionInfo, error) {
	session, err := s.session(string(request.SessionID))
	if err != nil {
		return DebugSessionInfo{}, err
	}
	if session.Project.Authorization != AuthorizationPermitted {
		return DebugSessionInfo{}, fmt.Errorf("explicitly authorize the tools for this project")
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
	switch {
	case request.AttachPort != 0:
		return s.attachJava(session, request.AttachHost, request.AttachPort, workingDirectory, nil)
	case request.TestFile != "" || len(request.BuildArguments) > 0:
		return s.debugJavaBuild(session, request, workingDirectory)
	}
	return s.launchJava(session, request, workingDirectory)
}

func (s *Service) launchJava(session Session, request JavaDebugRequest, workingDirectory string) (DebugSessionInfo, error) {
	if !validJavaClassName(request.MainClass) {
		return DebugSessionInfo{}, fmt.Errorf("%q is not a Java class name", request.MainClass)
	}
	options, err := s.resolveJavaDebug(session, request)
	if err != nil {
		return DebugSessionInfo{}, err
	}
	options.ProgramArguments, options.VMArguments, options.Environment = request.ProgramArguments, request.VMArguments, request.Environment
	return s.openJavaDebugAdapter(session, options, workingDirectory)
}

// attachJava collega il debugger a una JVM in ascolto su host:porta. Se il collegamento fallisce e la JVM è
// un processo avviato dall'host (`started`), lo ferma: con suspend=y resterebbe appeso in attesa.
func (s *Service) attachJava(session Session, host string, port int, workingDirectory string, started *Execution) (DebugSessionInfo, error) {
	host = strings.TrimSpace(host)
	if port < 1 || port > 65535 {
		return DebugSessionInfo{}, fmt.Errorf("the debug port must be between 1 and 65535")
	}
	if host != "" && net.ParseIP(host) == nil && !validHostName(host) {
		return DebugSessionInfo{}, fmt.Errorf("%q is not a host name or IP address", host)
	}
	info, err := s.openJavaAttach(session, host, port, workingDirectory)
	if err != nil && started != nil {
		_ = s.processes.Stop(started.ID)
	}
	return info, err
}

func (s *Service) openJavaAttach(session Session, host string, port int, workingDirectory string) (DebugSessionInfo, error) {
	ctx, cancel := context.WithTimeout(context.Background(), javaDebugResolveTimeout)
	defer cancel()
	address, err := s.startJavaDebugServer(ctx, session)
	if err != nil {
		return DebugSessionInfo{}, err
	}
	return s.openJavaDebugAdapter(session, java.DebugOptions{Address: address, AttachHost: host, AttachPort: port}, workingDirectory)
}

// debugJavaBuild esegue test o Spring Boot con Maven/Gradle nella console Run, con la porta JDWP aperta, e vi
// collega il debugger. Il programma si ferma sui breakpoint come ogni altra sessione.
func (s *Service) debugJavaBuild(session Session, request JavaDebugRequest, workingDirectory string) (DebugSessionInfo, error) {
	module, arguments := workingDirectory, request.BuildArguments
	if request.TestFile != "" {
		file, err := s.documents.ResolveProjectPath(session.Project, request.TestFile)
		if err != nil {
			return DebugSessionInfo{}, err
		}
		found, ok := java.ModuleOf(session.Project.RealPath, file)
		if !ok {
			return DebugSessionInfo{}, fmt.Errorf("no pom.xml or build.gradle contains %s", request.TestFile)
		}
		module = found
		relative, err := filepath.Rel(module, file)
		if err != nil {
			return DebugSessionInfo{}, err
		}
		_, _, kind, err := java.BuildToolOf(module)
		if err != nil {
			return DebugSessionInfo{}, err
		}
		if arguments, err = java.TestDebugArguments(kind, relative, request.TestMethod); err != nil {
			return DebugSessionInfo{}, err
		}
	}
	executable, label, kind, err := java.BuildToolOf(module)
	if err != nil {
		return DebugSessionInfo{}, err
	}
	port := java.GradleDebugPort
	if kind == java.UnitMaven {
		if port, err = freeLocalPort(); err != nil {
			return DebugSessionInfo{}, err
		}
	} else if !localPortFree(port) {
		return DebugSessionInfo{}, fmt.Errorf("port %d is busy: Gradle always listens there for the debugger", port)
	}
	if arguments, port, err = java.DebugArguments(kind, arguments, port); err != nil {
		return DebugSessionInfo{}, err
	}
	if err := run.CheckBatchSafe(executable, arguments); err != nil {
		return DebugSessionInfo{}, err
	}
	environment, err := s.executionEnvironment(session.ID, java.ID, nil)
	if err != nil {
		return DebugSessionInfo{}, err
	}
	listening := newListenWatcher()
	execution, err := s.processes.Start(CommandSpec{
		SessionID: session.ID, Kind: "run", Executable: executable, Arguments: arguments,
		WorkingDirectory: module, Environment: environment, DisplayCommand: label + " " + strings.Join(arguments, " "),
		OutputTap: listening.tap, OnExit: func(Execution) { listening.finish() },
	})
	if err != nil {
		return DebugSessionInfo{}, err
	}
	// Collegarsi prima che la JVM apra la porta fallirebbe (il Java Debug Server non riprova).
	if err := listening.wait(port, javaDebugBuildTimeout); err != nil {
		_ = s.processes.Stop(execution.ID)
		return DebugSessionInfo{}, err
	}
	return s.attachJava(session, "", port, module, &execution)
}

// openJavaDebugAdapter collega il DebugManager generico all'endpoint DAP del Java Debug Server.
func (s *Service) openJavaDebugAdapter(session Session, options java.DebugOptions, workingDirectory string) (DebugSessionInfo, error) {
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

// retryJavaCommand ripete `attempt` finché riesce o scade il tempo: JDT LS importa il progetto in background
// e finché non ha finito i suoi comandi falliscono.
func retryJavaCommand(ctx context.Context, what string, attempt func() error) error {
	var lastErr error
	for {
		if ctx.Err() != nil {
			return fmt.Errorf("JDT LS could not prepare %s for debugging (the project may still be importing, or it does not compile): %v", what, lastErr)
		}
		if lastErr = attempt(); lastErr == nil {
			return nil
		}
		select {
		case <-ctx.Done():
		case <-time.After(javaDebugRetryEvery):
		}
	}
}

// startJavaDebugServer fa aprire a JDT LS un endpoint DAP e ne restituisce l'indirizzo.
func (s *Service) startJavaDebugServer(ctx context.Context, session Session) (string, error) {
	var address string
	err := retryJavaCommand(ctx, "the project", func() (err error) {
		address, err = s.requestJavaDebugAddress(ctx, session)
		return err
	})
	return address, err
}

func (s *Service) requestJavaDebugAddress(ctx context.Context, session Session) (string, error) {
	raw, err := s.lsp.ExecuteCommand(ctx, session.ID, java.ID, java.CommandStartDebugSession)
	if err != nil {
		return "", err
	}
	port, err := strconv.Atoi(strings.TrimSpace(string(raw)))
	if err != nil || port <= 0 {
		return "", fmt.Errorf("the Java debug server did not return a port")
	}
	return "127.0.0.1:" + strconv.Itoa(port), nil
}

// resolveJavaDebug interroga JDT LS: progetto della classe, classpath, JDK e porta del debug adapter.
func (s *Service) resolveJavaDebug(session Session, request JavaDebugRequest) (java.DebugOptions, error) {
	options := java.DebugOptions{MainClass: request.MainClass}
	discoveryCtx, cancelDiscovery := context.WithTimeout(context.Background(), javaDebugResolveTimeout)
	discoveryErr := retryJavaCommand(discoveryCtx, request.MainClass, func() error {
		return java.ResolveDebugProject(fileURI(session.Project.RealPath), &options, func(command string, arguments ...any) (json.RawMessage, error) {
			return s.lsp.ExecuteCommand(discoveryCtx, session.ID, java.ID, command, arguments...)
		})
	})
	cancelDiscovery()
	if discoveryErr != nil {
		return options, discoveryErr
	}
	// A source discovered by JDT LS is not necessarily compiled yet. Wait for the
	// explicit build before resolving runtime paths or opening a debug adapter.
	// Build errors are final for this action, not repeated by the import retry loop.
	buildCtx, cancelBuild := context.WithTimeout(context.Background(), javaDebugBuildTimeout)
	defer cancelBuild()
	err := java.PrepareDebugRuntime(&options, func(command string, arguments ...any) (json.RawMessage, error) {
		return s.lsp.ExecuteCommand(buildCtx, session.ID, java.ID, command, arguments...)
	})
	if err != nil {
		return options, err
	}
	options.Address, err = s.startJavaDebugServer(buildCtx, session)
	return options, err
}

// validJavaClassName: vedi java.ValidClassName.
var validJavaClassName = java.ValidClassName

// validHostName accetta solo lettere, cifre, punti e trattini: il nome finisce nella richiesta DAP.
func validHostName(name string) bool {
	if name == "" || len(name) > 253 {
		return false
	}
	for _, r := range name {
		if !(r == '.' || r == '-' || r >= 'a' && r <= 'z' || r >= 'A' && r <= 'Z' || r >= '0' && r <= '9') {
			return false
		}
	}
	return true
}

// freeLocalPort sceglie una porta TCP libera su loopback (la JVM la aprirà subito dopo).
func freeLocalPort() (int, error) {
	listener, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		return 0, fmt.Errorf("no free local port for the debugger: %w", err)
	}
	defer listener.Close()
	return listener.Addr().(*net.TCPAddr).Port, nil
}

func localPortFree(port int) bool {
	listener, err := net.Listen("tcp", "127.0.0.1:"+strconv.Itoa(port))
	if err != nil {
		return false
	}
	_ = listener.Close()
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
	executable, arguments, display, extra, err := java.MainCommandWith(module, java.MainOptions{MainClass: mainClass}, nil)
	if err != nil {
		return Execution{}, err
	}
	environment, err := s.executionEnvironment(session.ID, java.ID, nil)
	if err != nil {
		return Execution{}, err
	}
	return s.processes.Start(CommandSpec{
		SessionID: session.ID, Kind: "run", Executable: executable, Arguments: arguments,
		WorkingDirectory: module, Environment: append(environment, extra...), DisplayCommand: display,
	})
}

// listenWatcher aspetta che la JVM del build apra la porta JDWP, o che il processo finisca prima.
// Collegarsi per provare consumerebbe l'unica connessione JDWP: si controlla invece che la porta sia
// occupata (non si può più aprire) e si ascolta l'output per la riga "Listening for transport".
type listenWatcher struct {
	mu       sync.Mutex
	tail     string
	ready    chan struct{}
	finished chan struct{}
	once     sync.Once
	end      sync.Once
}

const jdwpListeningMarker = "Listening for transport dt_socket"

func newListenWatcher() *listenWatcher {
	return &listenWatcher{ready: make(chan struct{}), finished: make(chan struct{})}
}

func (w *listenWatcher) tap(_ string, data []byte) {
	w.mu.Lock()
	w.tail += string(data)
	if len(w.tail) > 2*len(jdwpListeningMarker) {
		w.tail = w.tail[len(w.tail)-2*len(jdwpListeningMarker):]
	}
	found := strings.Contains(w.tail, jdwpListeningMarker)
	w.mu.Unlock()
	if found {
		w.once.Do(func() { close(w.ready) })
	}
}

func (w *listenWatcher) finish() { w.end.Do(func() { close(w.finished) }) }

func (w *listenWatcher) wait(port int, timeout time.Duration) error {
	ticker := time.NewTicker(300 * time.Millisecond)
	defer ticker.Stop()
	deadline := time.After(timeout)
	for {
		select {
		case <-w.ready:
			return nil
		case <-w.finished:
			if !localPortFree(port) {
				return nil
			}
			return fmt.Errorf("the build ended before the JVM opened the debug port: see the Run console")
		case <-ticker.C:
			if !localPortFree(port) {
				return nil
			}
		case <-deadline:
			return fmt.Errorf("the JVM did not open the debug port within %s", timeout)
		}
	}
}

// JavaMainClasses elenca le classi lanciabili del progetto. Con JDT LS pronto decide lui (resolveMainClass:
// copre i `main` senza `public`, di istanza e i compact source file di Java 25); senza server restano le regex
// dei sorgenti, e ogni voce dice quale delle due l'ha trovata.
func (s *Service) JavaMainClasses(sessionID string) ([]java.MainClassInfo, error) {
	session, err := s.session(sessionID)
	if err != nil {
		return nil, err
	}
	ctx, cancel := context.WithTimeout(context.Background(), javaDebugResolveTimeout)
	defer cancel()
	if raw, err := s.lsp.ExecuteCommand(ctx, session.ID, java.ID, java.CommandResolveMainClass); err == nil {
		if found := java.ParseResolveMainClass(raw); len(found) > 0 {
			return found, nil
		}
	}
	var found []java.MainClassInfo
	for _, unit := range session.Project.Units {
		if unit.Language == java.ID {
			found = append(found, java.ScanMainClasses(unit.Root)...)
		}
	}
	return found, nil
}
