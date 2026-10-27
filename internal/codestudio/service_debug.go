package codestudio

import (
	"fmt"
	"maps"
	"net"
	"os"
	"path"
	"path/filepath"
	"sort"
	"strconv"
	"strings"

	"github.com/Andrea-Cavallo/adOmnia/internal/languages/golang"
)

// DetectDelve individua dlv e ne legge la versione, senza avviare nulla.
func (s *Service) DetectDelve(sessionID string) (DelveInfo, error) {
	session, err := s.session(sessionID)
	if err != nil {
		return DelveInfo{}, err
	}
	s.goplsMu.RLock()
	custom := s.delveBinaries[session.ID]
	s.goplsMu.RUnlock()
	return golang.LocateDelve(custom, s.toolsRoot, s.sessionGOPATH(session.ID)), nil
}

// ConfigureDelve imposta un dlv personalizzato per la sessione; stringa vuota ripristina la ricerca automatica.
func (s *Service) ConfigureDelve(sessionID, binary string) error {
	if _, err := s.session(sessionID); err != nil {
		return err
	}
	binary = strings.TrimSpace(binary)
	if binary != "" {
		abs, err := filepath.Abs(binary)
		if err != nil {
			return fmt.Errorf("invalid dlv path: %w", err)
		}
		if info, err := os.Stat(abs); err != nil || info.IsDir() {
			return fmt.Errorf("the given path is not a dlv executable")
		}
		binary = abs
	}
	s.goplsMu.Lock()
	if binary == "" {
		delete(s.delveBinaries, SessionID(sessionID))
	} else {
		s.delveBinaries[SessionID(sessionID)] = binary
	}
	s.goplsMu.Unlock()
	return nil
}

// InstallDelve esegue `go install` di Delve nella cartella strumenti di adOmnia dopo conferma esplicita.
func (s *Service) InstallDelve(sessionID string, confirmed bool) (Execution, error) {
	return s.installTool(sessionID, golang.DelveModule, confirmed)
}

// StartDebug avvia Delve per il package o il test richiesto; solo per progetti autorizzati e su azione esplicita.
func (s *Service) StartDebug(request DebugRequest) (DebugSessionInfo, error) {
	session, err := s.session(string(request.SessionID))
	if err != nil {
		return DebugSessionInfo{}, err
	}
	if session.Project.Authorization != AuthorizationPermitted {
		return DebugSessionInfo{}, fmt.Errorf("explicitly authorize the tools for this project")
	}
	request.SessionID = session.ID
	// Il server remoto è un dlv già in ascolto: non serve Delve sulla macchina locale.
	if request.Mode == debugModeRemote {
		if err := validateRemoteAddress(request.Address); err != nil {
			return DebugSessionInfo{}, err
		}
		if request.RemoteSourceRoot != "" {
			if strings.ContainsAny(request.RemoteSourceRoot, "\x00\r\n") || (!path.IsAbs(request.RemoteSourceRoot) && !filepath.IsAbs(request.RemoteSourceRoot)) {
				return DebugSessionInfo{}, fmt.Errorf("specify the remote source root as an absolute path")
			}
			request.LocalSourceRoot = session.Project.RealPath
		}
		s.seedBreakpoints(session)
		return s.debug.Start(debugLaunch{session: session, request: request})
	}
	delve, err := s.DetectDelve(string(session.ID))
	if err != nil {
		return DebugSessionInfo{}, err
	}
	if !delve.Available {
		return DebugSessionInfo{}, fmt.Errorf("%s", delve.Error)
	}
	switch request.Mode {
	case debugModeAttach:
		if request.ProcessID <= 0 || request.ProcessID == os.Getpid() {
			return DebugSessionInfo{}, fmt.Errorf("choose a valid process to attach to")
		}
		s.seedBreakpoints(session)
		return s.debug.Start(debugLaunch{session: session, request: request, binary: delve.Binary, moduleDir: session.Project.RealPath, environment: os.Environ()})
	case "debug", "test":
	default:
		return DebugSessionInfo{}, fmt.Errorf("unsupported debug mode")
	}
	moduleDir, err := s.documents.resolveDirectory(session.Project, request.WorkingDirectory)
	if err != nil {
		return DebugSessionInfo{}, err
	}
	target := strings.TrimSpace(request.Target)
	if target == "" {
		target = "."
	}
	if request.Mode == "debug" {
		moduleDir, target, err = s.resolveLanguageRunTarget(session, golang.ID, "debug", moduleDir, target)
		if err != nil {
			return DebugSessionInfo{}, err
		}
	}
	if err := validateRunTarget(session.Project.RealPath, moduleDir, target); err != nil {
		return DebugSessionInfo{}, err
	}
	environment, err := s.languageServerEnvironment(session.ID)
	if err != nil {
		return DebugSessionInfo{}, err
	}
	overrides := make([]string, 0, len(request.Environment))
	if request.EnvFile != "" {
		fromFile, err := loadEnvFile(session.Project.RealPath, moduleDir, request.EnvFile)
		if err != nil {
			return DebugSessionInfo{}, err
		}
		for name, value := range fromFile {
			if _, explicit := request.Environment[name]; !explicit {
				overrides = append(overrides, name+"="+value)
			}
		}
	}
	for name, value := range request.Environment {
		overrides = append(overrides, name+"="+value)
	}
	environment = mergeEnvironment(environment, overrides)
	request.SessionID = session.ID
	s.seedBreakpoints(session)
	return s.debug.Start(debugLaunch{
		session: session, request: request, binary: delve.Binary, moduleDir: moduleDir,
		program: filepath.Clean(filepath.Join(moduleDir, filepath.FromSlash(target))), environment: environment,
	})
}

// StopDebug termina la sessione di debug con il programma debuggato.
func (s *Service) StopDebug(debugID string) error {
	return s.debug.Stop(DebugSessionID(debugID))
}

// DebugStep esegue continue, pause, next, stepIn o stepOut.
func (s *Service) DebugStep(debugID, action string, threadID int) error {
	return s.debug.Step(DebugSessionID(debugID), action, threadID)
}

// DebugThreads restituisce le goroutine del programma fermo.
func (s *Service) DebugThreads(debugID string) ([]DebugThread, error) {
	return s.debug.Threads(DebugSessionID(debugID))
}

// DebugStackTrace restituisce i frame della goroutine indicata.
func (s *Service) DebugStackTrace(debugID string, threadID int) ([]DebugFrame, error) {
	return s.debug.StackTrace(DebugSessionID(debugID), threadID)
}

// DebugGoroutines restituisce tutte le goroutine della pausa corrente con stato, causa del blocco e origine.
func (s *Service) DebugGoroutines(debugID string) (GoroutineOverview, error) {
	return s.debug.Goroutines(DebugSessionID(debugID))
}

// DebugScopes restituisce gli scope di un frame.
func (s *Service) DebugScopes(debugID string, frameID int) ([]DebugScope, error) {
	id := DebugSessionID(debugID)
	scopes, err := s.debug.Scopes(id, frameID)
	// After a manual Pause the current goroutine often sits in the runtime without a location and Delve
	// fails the whole request while listing globals: retry without them so locals still show.
	if err != nil && strings.Contains(err.Error(), "Unable to list globals") {
		if _, configErr := s.debug.Evaluate(id, "dlv config showGlobalVariables false", frameID, "repl"); configErr == nil {
			scopes, err = s.debug.Scopes(id, frameID)
			_, _ = s.debug.Evaluate(id, "dlv config showGlobalVariables true", frameID, "repl")
		}
	}
	return scopes, err
}

// DebugReadMemory legge length byte a partire da un indirizzo esadecimale o dall'indirizzo di
// un'espressione Go (es. "&buf[0]") valutata nel frame.
func (s *Service) DebugReadMemory(debugID, location string, length, frameID int) (DebugMemory, error) {
	return s.debug.ReadMemory(DebugSessionID(debugID), location, length, frameID)
}

// DebugShowRegisters mostra o nasconde lo scope Registers nelle variabili dei frame.
func (s *Service) DebugShowRegisters(debugID string, show bool) error {
	return s.debug.ShowRegisters(DebugSessionID(debugID), show)
}

// DebugDisassemble restituisce il codice macchina attorno all'istruzione corrente di un frame.
func (s *Service) DebugDisassemble(debugID, address string, before, after int) ([]DebugInstruction, error) {
	return s.debug.Disassemble(DebugSessionID(debugID), address, before, after)
}

// DebugVariables espande scope e variabili composte.
func (s *Service) DebugVariables(debugID string, reference int) ([]DebugVariable, error) {
	return s.debug.Variables(DebugSessionID(debugID), reference)
}

// DebugEvaluate valuta un'espressione per watch e console.
func (s *Service) DebugEvaluate(debugID, expression string, frameID int, context string) (EvaluateResult, error) {
	return s.debug.Evaluate(DebugSessionID(debugID), expression, frameID, context)
}

// ListDebugSessions restituisce le sessioni di debug attive del progetto.
func (s *Service) ListDebugSessions(sessionID string) ([]DebugSessionInfo, error) {
	if _, err := s.session(sessionID); err != nil {
		return nil, err
	}
	return s.debug.Active(SessionID(sessionID)), nil
}

// SetBreakpoints imposta i breakpoint di riga di un file del progetto (con condizione, hit count o logpoint),
// anche senza debug in corso, e li salva nello stato della sessione così sopravvivono al riavvio.
func (s *Service) SetBreakpoints(sessionID, relativePath string, breakpoints []Breakpoint) ([]BreakpointState, error) {
	session, err := s.session(sessionID)
	if err != nil {
		return nil, err
	}
	path, err := s.documents.ResolveProjectPath(session.Project, relativePath)
	if err != nil {
		return nil, err
	}
	normalized, err := normalizeBreakpoints(breakpoints)
	if err != nil {
		return nil, err
	}
	s.seedBreakpoints(session)
	states := s.debug.SetBreakpoints(session.ID, session.Project.RealPath, path, normalized)
	if err := s.persistBreakpoints(session.ID, filepath.ToSlash(relativeWithin(session.Project.RealPath, path)), normalized); err != nil {
		return states, err
	}
	return states, nil
}

// ListBreakpoints restituisce i breakpoint salvati della sessione, per file.
func (s *Service) ListBreakpoints(sessionID string) ([]FileBreakpoints, error) {
	session, err := s.session(sessionID)
	if err != nil {
		return nil, err
	}
	s.viewMu.RLock()
	saved := s.views[session.ID].Breakpoints
	result := make([]FileBreakpoints, 0, len(saved))
	for relativePath, breakpoints := range saved {
		result = append(result, FileBreakpoints{SessionID: session.ID, RelativePath: relativePath, Breakpoints: unverifiedStates(breakpoints)})
	}
	s.viewMu.RUnlock()
	sort.Slice(result, func(left, right int) bool { return result[left].RelativePath < result[right].RelativePath })
	return result, nil
}

// ListFunctionBreakpoints restituisce i breakpoint di funzione e il panic breakpoint salvati per il progetto.
func (s *Service) ListFunctionBreakpoints(sessionID string) (FunctionBreakpointsView, error) {
	session, err := s.session(sessionID)
	if err != nil {
		return FunctionBreakpointsView{}, err
	}
	s.viewMu.RLock()
	view := s.views[session.ID]
	s.viewMu.RUnlock()
	return unverifiedFunctionView(session.ID, FunctionBreakpointSettings{Functions: view.FunctionBreakpoints, StopOnPanic: view.StopOnPanic}), nil
}

// SetFunctionBreakpoints sostituisce i breakpoint di funzione e il panic breakpoint, li invia ai debug attivi e li salva.
func (s *Service) SetFunctionBreakpoints(sessionID string, settings FunctionBreakpointSettings) (FunctionBreakpointsView, error) {
	session, err := s.session(sessionID)
	if err != nil {
		return FunctionBreakpointsView{}, err
	}
	normalized, err := normalizeFunctionBreakpoints(settings)
	if err != nil {
		return FunctionBreakpointsView{}, err
	}
	s.seedBreakpoints(session)
	view := s.debug.SetFunctionBreakpoints(session.ID, normalized)
	s.viewMu.Lock()
	saved := s.views[session.ID]
	saved.FunctionBreakpoints, saved.StopOnPanic = normalized.Functions, normalized.StopOnPanic
	s.views[session.ID] = saved
	s.viewMu.Unlock()
	return view, s.persistSessionView(session.ID, saved)
}

// ListExceptionBreakpoints restituisce i breakpoint su eccezione salvati per il progetto.
func (s *Service) ListExceptionBreakpoints(sessionID string) (ExceptionBreakpointsView, error) {
	session, err := s.session(sessionID)
	if err != nil {
		return ExceptionBreakpointsView{}, err
	}
	s.viewMu.RLock()
	view := s.views[session.ID]
	s.viewMu.RUnlock()
	return ExceptionBreakpointsView{SessionID: session.ID, Filters: append([]string(nil), view.ExceptionBreakpoints...)}, nil
}

// SetExceptionBreakpoints sostituisce i breakpoint su eccezione, li invia ai debug attivi e li salva.
// I filtri sono i nomi del debug adapter (es. debugpy: "raised", "uncaught"): un adapter che non
// li conosce risponde con un messaggio che resta nella vista.
func (s *Service) SetExceptionBreakpoints(sessionID string, settings ExceptionBreakpointSettings) (ExceptionBreakpointsView, error) {
	session, err := s.session(sessionID)
	if err != nil {
		return ExceptionBreakpointsView{}, err
	}
	s.seedBreakpoints(session)
	view := s.debug.SetExceptionBreakpoints(session.ID, settings)
	s.viewMu.Lock()
	saved := s.views[session.ID]
	saved.ExceptionBreakpoints = append([]string(nil), view.Filters...)
	s.views[session.ID] = saved
	s.viewMu.Unlock()
	return view, s.persistSessionView(session.ID, saved)
}

// DebugRunToCursor riprende il programma in pausa fino alla riga indicata di un file del progetto.
func (s *Service) DebugRunToCursor(debugID, relativePath string, line, threadID int) error {
	sessionID, err := s.debug.SessionOf(DebugSessionID(debugID))
	if err != nil {
		return err
	}
	session, err := s.session(string(sessionID))
	if err != nil {
		return err
	}
	path, err := s.documents.ResolveProjectPath(session.Project, relativePath)
	if err != nil {
		return err
	}
	return s.debug.RunToCursor(DebugSessionID(debugID), path, line, threadID)
}

const maxBreakpointFiles = 500

func (s *Service) persistBreakpoints(sessionID SessionID, relativePath string, list []Breakpoint) error {
	s.viewMu.Lock()
	view := s.views[sessionID]
	breakpoints := make(map[string][]Breakpoint, len(view.Breakpoints)+1)
	maps.Copy(breakpoints, view.Breakpoints)
	_, known := breakpoints[relativePath]
	switch {
	case len(list) == 0:
		delete(breakpoints, relativePath)
	case known || len(breakpoints) < maxBreakpointFiles:
		breakpoints[relativePath] = list
	}
	view.Breakpoints = breakpoints
	s.views[sessionID] = view
	s.viewMu.Unlock()
	return s.persistSessionView(sessionID, view)
}

// seedBreakpoints porta nel debugger i breakpoint salvati, risolti su percorsi assoluti del progetto.
func (s *Service) seedBreakpoints(session Session) {
	s.viewMu.RLock()
	view := s.views[session.ID]
	byPath := make(map[string][]Breakpoint, len(view.Breakpoints))
	for relativePath, breakpoints := range view.Breakpoints {
		if path, err := s.documents.ResolveProjectPath(session.Project, relativePath); err == nil {
			byPath[path] = breakpoints
		}
	}
	functions := FunctionBreakpointSettings{Functions: view.FunctionBreakpoints, StopOnPanic: view.StopOnPanic}
	exceptions := ExceptionBreakpointSettings{Filters: view.ExceptionBreakpoints}
	s.viewMu.RUnlock()
	s.debug.SeedBreakpoints(session.ID, byPath, functions, exceptions)
}

// validateRemoteAddress accetta solo host:porta, senza schema né percorso.
func validateRemoteAddress(address string) error {
	host, port, err := net.SplitHostPort(strings.TrimSpace(address))
	if err != nil || host == "" || strings.ContainsAny(host, "/\\ ") {
		return fmt.Errorf("specify the Delve server address as host:port, e.g. 127.0.0.1:2345")
	}
	number, err := strconv.Atoi(port)
	if err != nil || number < 1 || number > 65535 {
		return fmt.Errorf("invalid Delve server port")
	}
	return nil
}
