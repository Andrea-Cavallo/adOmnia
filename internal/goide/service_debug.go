package goide

import (
	"context"
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	"sort"
	"strings"
)

const delveModule = "github.com/go-delve/delve/cmd/dlv@latest"

// DelveInfo descrive il binario dlv trovato per la sessione.
type DelveInfo struct {
	Available bool   `json:"available"`
	Binary    string `json:"binary,omitempty"`
	Version   string `json:"version,omitempty"`
	Source    string `json:"source,omitempty"`
	Error     string `json:"error,omitempty"`
}

// delveCandidates segue lo stesso ordine di gopls: personalizzato, gestito da adOmnia, GOPATH/bin, PATH.
func (s *Service) delveCandidates(sessionID SessionID) []DelveInfo {
	candidates := make([]DelveInfo, 0, 4)
	s.goplsMu.RLock()
	custom := s.delveBinaries[sessionID]
	s.goplsMu.RUnlock()
	if custom != "" {
		candidates = append(candidates, DelveInfo{Binary: custom, Source: "custom"})
	}
	if s.toolsRoot != "" {
		candidates = append(candidates, DelveInfo{Binary: filepath.Join(s.toolsRoot, "bin", executableName("dlv")), Source: "managed"})
	}
	if info, ok := s.toolchain.LastDetected(sessionID); ok && info.GOPATH != "" {
		for _, gopath := range filepath.SplitList(info.GOPATH) {
			candidates = append(candidates, DelveInfo{Binary: filepath.Join(gopath, "bin", executableName("dlv")), Source: "GOPATH"})
		}
	}
	if found, err := exec.LookPath("dlv"); err == nil {
		candidates = append(candidates, DelveInfo{Binary: found, Source: "PATH"})
	}
	return candidates
}

// DetectDelve individua dlv e ne legge la versione, senza avviare nulla.
func (s *Service) DetectDelve(sessionID string) (DelveInfo, error) {
	session, err := s.session(sessionID)
	if err != nil {
		return DelveInfo{}, err
	}
	for _, candidate := range s.delveCandidates(session.ID) {
		if info, statErr := os.Stat(candidate.Binary); statErr != nil || info.IsDir() {
			if candidate.Source == "custom" {
				return DelveInfo{Binary: candidate.Binary, Source: "custom", Error: "il binario dlv configurato non esiste"}, nil
			}
			continue
		}
		version, versionErr := delveVersion(candidate.Binary)
		if versionErr != nil {
			candidate.Error = versionErr.Error()
			return candidate, nil
		}
		candidate.Available, candidate.Version = true, version
		return candidate, nil
	}
	return DelveInfo{Error: "Delve (dlv) non trovato: installalo da Go → Install Delve oppure indica un binario personalizzato"}, nil
}

func delveVersion(binary string) (string, error) {
	ctx, cancel := context.WithTimeout(context.Background(), goplsVersionTimeout)
	defer cancel()
	command := exec.CommandContext(ctx, binary, "version")
	configureProcess(command, false)
	output, err := command.CombinedOutput()
	if ctx.Err() != nil {
		return "", fmt.Errorf("dlv non risponde a 'dlv version'")
	}
	if err != nil {
		return "", fmt.Errorf("dlv non eseguibile: %s", strings.TrimSpace(string(output)))
	}
	for _, line := range strings.Split(string(output), "\n") {
		if version, ok := strings.CutPrefix(strings.TrimSpace(line), "Version:"); ok {
			return strings.TrimSpace(version), nil
		}
	}
	return "", fmt.Errorf("versione di dlv non riconosciuta")
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
			return fmt.Errorf("percorso dlv non valido: %w", err)
		}
		if info, err := os.Stat(abs); err != nil || info.IsDir() {
			return fmt.Errorf("il percorso indicato non è un eseguibile dlv")
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
	return s.installTool(sessionID, delveModule, confirmed)
}

// StartDebug avvia Delve per il package o il test richiesto; solo per progetti autorizzati e su azione esplicita.
func (s *Service) StartDebug(request DebugRequest) (DebugSessionInfo, error) {
	session, err := s.session(string(request.SessionID))
	if err != nil {
		return DebugSessionInfo{}, err
	}
	if session.Project.Authorization != AuthorizationPermitted {
		return DebugSessionInfo{}, fmt.Errorf("autorizza esplicitamente gli strumenti per questo progetto")
	}
	if request.Mode != "debug" && request.Mode != "test" {
		return DebugSessionInfo{}, fmt.Errorf("modalità di debug non supportata")
	}
	delve, err := s.DetectDelve(string(session.ID))
	if err != nil {
		return DebugSessionInfo{}, err
	}
	if !delve.Available {
		return DebugSessionInfo{}, fmt.Errorf("%s", delve.Error)
	}
	moduleDir, err := s.documents.resolveDirectory(session.Project, request.WorkingDirectory)
	if err != nil {
		return DebugSessionInfo{}, err
	}
	target := strings.TrimSpace(request.Target)
	if target == "" {
		target = "."
	}
	if err := validateRunTarget(session.Project.RealPath, moduleDir, target); err != nil {
		return DebugSessionInfo{}, err
	}
	environment, err := s.languageServerEnvironment(session.ID)
	if err != nil {
		return DebugSessionInfo{}, err
	}
	overrides := make([]string, 0, len(request.Environment))
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

// DebugScopes restituisce gli scope di un frame.
func (s *Service) DebugScopes(debugID string, frameID int) ([]DebugScope, error) {
	return s.debug.Scopes(DebugSessionID(debugID), frameID)
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

// SetBreakpoints imposta i breakpoint di riga di un file del progetto, anche senza debug in corso,
// e li salva nello stato della sessione così sopravvivono al riavvio.
func (s *Service) SetBreakpoints(sessionID, relativePath string, lines []int) ([]BreakpointState, error) {
	session, err := s.session(sessionID)
	if err != nil {
		return nil, err
	}
	path, err := s.documents.ResolveProjectPath(session.Project, relativePath)
	if err != nil {
		return nil, err
	}
	s.seedBreakpoints(session)
	states := s.debug.SetBreakpoints(session.ID, session.Project.RealPath, path, lines)
	if err := s.persistBreakpoints(session.ID, filepath.ToSlash(relativeWithin(session.Project.RealPath, path)), uniqueSortedLines(lines)); err != nil {
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
	for relativePath, lines := range saved {
		states := make([]BreakpointState, 0, len(lines))
		for _, line := range lines {
			states = append(states, BreakpointState{Line: line})
		}
		result = append(result, FileBreakpoints{SessionID: session.ID, RelativePath: relativePath, Breakpoints: states})
	}
	s.viewMu.RUnlock()
	sort.Slice(result, func(left, right int) bool { return result[left].RelativePath < result[right].RelativePath })
	return result, nil
}

const maxBreakpointFiles = 500

func (s *Service) persistBreakpoints(sessionID SessionID, relativePath string, lines []int) error {
	s.viewMu.Lock()
	view := s.views[sessionID]
	breakpoints := make(map[string][]int, len(view.Breakpoints)+1)
	for path, existing := range view.Breakpoints {
		breakpoints[path] = existing
	}
	_, known := breakpoints[relativePath]
	switch {
	case len(lines) == 0:
		delete(breakpoints, relativePath)
	case known || len(breakpoints) < maxBreakpointFiles:
		breakpoints[relativePath] = lines
	}
	view.Breakpoints = breakpoints
	s.views[sessionID] = view
	s.viewMu.Unlock()
	return s.saveState()
}

// seedBreakpoints porta nel debugger i breakpoint salvati, risolti su percorsi assoluti del progetto.
func (s *Service) seedBreakpoints(session Session) {
	s.viewMu.RLock()
	saved := s.views[session.ID].Breakpoints
	byPath := make(map[string][]int, len(saved))
	for relativePath, lines := range saved {
		if path, err := s.documents.ResolveProjectPath(session.Project, relativePath); err == nil {
			byPath[path] = lines
		}
	}
	s.viewMu.RUnlock()
	s.debug.SeedBreakpoints(session.ID, byPath)
}
