package goide

import (
	"context"
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	"regexp"
	"strings"
	"sync"
	"sync/atomic"
	"time"
)

const maxRecentProjects = 20

var modulePathPattern = regexp.MustCompile(`^[A-Za-z0-9][A-Za-z0-9._~/-]*$`)

type Service struct {
	workspace *WorkspaceManager
	// studioWorkspaces raggruppa le sessioni in workspace Go Studio, separati da quelli di adOmnia.
	studioWorkspaces *studioWorkspaceRegistry
	documents        *DocumentManager
	toolchain        *ToolchainManager
	installer        *ToolchainInstaller
	processes        *ProcessManager
	lsp              *LSPManager
	terminal         *TerminalManager
	debug            *DebugManager
	tests            *TestManager
	runConfigs       *RunConfigManager
	recovery         *RecoveryManager
	history          *LocalHistory
	persistence      *Persistence
	viewMu           sync.RWMutex
	views            map[SessionID]SessionView
	restoreOnce      sync.Once
	restoreErr       error
	recentMu         sync.RWMutex
	recent           []RecentProject
	runMu            sync.RWMutex
	runRequests      map[RunID]RunRequest
	eventMu          sync.RWMutex
	eventSink        func(EventEnvelope)
	sequence         atomic.Uint64
	toolsRoot        string
	goplsMu          sync.RWMutex
	goplsBinaries    map[SessionID]string
	delveBinaries    map[SessionID]string
	lint             lintRegistry
	watcher          *WatchManager
}

func NewService(store Store, eventSink func(EventEnvelope)) *Service {
	service := &Service{
		workspace:        NewWorkspaceManager(),
		studioWorkspaces: newStudioWorkspaceRegistry(),
		documents:        NewDocumentManager(),
		toolchain:        NewToolchainManager(),
		processes:        NewProcessManager(),
		lsp:              NewLSPManager(),
		terminal:         NewTerminalManager(),
		debug:            NewDebugManager(),
		tests:            NewTestManager(),
		runConfigs:       NewRunConfigManager(),
		persistence:      NewPersistence(store),
		views:            make(map[SessionID]SessionView),
		runRequests:      make(map[RunID]RunRequest),
		eventSink:        eventSink,
		goplsBinaries:    make(map[SessionID]string),
		delveBinaries:    make(map[SessionID]string),
		lint:             lintRegistry{custom: make(map[SessionID]string)},
	}
	service.recovery = NewRecoveryManager(nil)
	service.history = NewLocalHistory(nil)
	service.watcher = NewWatchManager(service.filesChanged)
	service.lsp.SetEmitter(service.emit)
	service.debug.SetEmitter(service.emit)
	service.installer = NewToolchainInstaller(func(eventType string, installation ToolchainInstallation) {
		service.emit(eventType, installation.SessionID, installation.ID, installation)
	})
	service.processes.SetEventSink(func(eventType string, execution Execution, payload any) {
		service.emit(eventType, execution.SessionID, string(execution.ID), payload)
	})
	service.terminal.SetEventSink(func(eventType string, terminal TerminalSession, payload any) {
		if payload == nil {
			payload = terminal
		}
		service.emit(eventType, terminal.SessionID, string(terminal.ID), payload)
	})
	return service
}

// ConfigureToolchainStorage imposta lo storage locale isolato per le versioni Go gestite.
func (s *Service) ConfigureToolchainStorage(root string) error {
	if err := s.installer.ConfigureRoot(root); err != nil {
		return err
	}
	s.toolsRoot = filepath.Join(filepath.Dir(filepath.Clean(root)), "tools")
	return nil
}

// GetCapabilities dichiara soltanto le capacità realmente disponibili nello stato corrente.
func (s *Service) GetCapabilities() Capabilities {
	return Capabilities{
		SchemaVersion:    3,
		ProjectOpen:      true,
		ProjectCreate:    true,
		Documents:        true,
		Toolchain:        true,
		Processes:        true,
		LSP:              true,
		Terminal:         true,
		MultipleSessions: true,
	}
}

// OpenProject apre una sessione non autorizzata all'esecuzione e non avvia alcuno strumento.
func (s *Service) OpenProject(path string) (Session, error) {
	if err := s.restore(); err != nil {
		return Session{}, err
	}
	session, err := s.workspace.OpenProject(path, s.studioWorkspaces.activeID())
	if err != nil {
		return Session{}, err
	}
	s.rememberProject(session.Project, session.UpdatedAt)
	if err := s.saveState(); err != nil {
		return Session{}, err
	}
	s.watchSession(session)
	s.emit("session.opened", session.ID, string(session.ID), session)
	return session, nil
}

// CreateProject crea una cartella e inizializza il modulo soltanto dopo conferma esplicita.
func (s *Service) CreateProject(request CreateProjectRequest) (Session, error) {
	if !request.Confirmed {
		return Session{}, fmt.Errorf("conferma esplicita richiesta prima di eseguire go mod init")
	}
	modulePath := strings.TrimSpace(request.ModulePath)
	if !modulePathPattern.MatchString(modulePath) || strings.Contains(modulePath, "//") {
		return Session{}, fmt.Errorf("module path non valido")
	}
	target, err := s.workspace.CreateProjectDirectory(request.ParentPath, request.Name)
	if err != nil {
		return Session{}, err
	}
	binary, err := exec.LookPath("go")
	if err != nil {
		_ = os.Remove(target)
		return Session{}, fmt.Errorf("Go non trovato: installalo o configura il PATH prima di creare un modulo")
	}
	ctx, cancel := context.WithTimeout(context.Background(), 20*time.Second)
	defer cancel()
	command := exec.CommandContext(ctx, binary, "mod", "init", modulePath)
	command.Dir = target
	configureProcess(command, false)
	output, runErr := command.CombinedOutput()
	if runErr != nil {
		_ = os.Remove(target)
		return Session{}, fmt.Errorf("go mod init fallito: %s", strings.TrimSpace(string(output)))
	}
	return s.OpenProject(target)
}

// ListSessions restituisce le sessioni ripristinate e attualmente aperte.
func (s *Service) ListSessions() ([]Session, error) {
	if err := s.restore(); err != nil {
		return nil, err
	}
	return s.workspace.ListSessions(), nil
}

// ListRecentProjects restituisce i progetti recenti verificandone la disponibilità locale.
func (s *Service) ListRecentProjects() ([]RecentProject, error) {
	if err := s.restore(); err != nil {
		return nil, err
	}
	s.recentMu.Lock()
	items := append([]RecentProject(nil), s.recent...)
	changed := false
	for index := range items {
		info, err := os.Stat(items[index].RealPath)
		available := err == nil && info.IsDir()
		if items[index].Available != available {
			items[index].Available = available
			changed = true
		}
	}
	s.recent = items
	s.recentMu.Unlock()
	if changed {
		_ = s.saveState()
	}
	return items, nil
}

// RemoveRecentProject rimuove una voce recente senza toccare cartelle o altre sessioni.
func (s *Service) RemoveRecentProject(path string) error {
	if err := s.restore(); err != nil {
		return err
	}
	s.recentMu.Lock()
	filtered := s.recent[:0]
	for _, project := range s.recent {
		if !samePath(project.RealPath, path) && !samePath(project.RootPath, path) {
			filtered = append(filtered, project)
		}
	}
	s.recent = append([]RecentProject(nil), filtered...)
	s.recentMu.Unlock()
	return s.saveState()
}

// SetToolAuthorization registra un consenso esplicito senza avviare processi.
func (s *Service) SetToolAuthorization(id string, allowed bool) (Session, error) {
	if err := s.restore(); err != nil {
		return Session{}, err
	}
	session, err := s.workspace.SetToolAuthorization(SessionID(id), allowed)
	if err != nil {
		return Session{}, err
	}
	if !allowed {
		s.processes.StopSession(session.ID)
		s.lsp.Stop(session.ID)
	}
	if err := s.saveState(); err != nil {
		return Session{}, err
	}
	s.emit("session.authorization-changed", session.ID, string(session.ID), map[string]any{"authorization": session.Project.Authorization})
	return session, nil
}

// CloseSession chiude una sessione soltanto quando non possiede processi attivi.
func (s *Service) CloseSession(id string) error {
	if err := s.restore(); err != nil {
		return err
	}
	sessionID := SessionID(id)
	if s.processes.HasActiveSession(sessionID) {
		return fmt.Errorf("la sessione contiene processi attivi: arrestali prima di chiuderla")
	}
	if !s.workspace.CloseSession(sessionID) {
		return nil
	}
	s.terminal.CloseSession(sessionID)
	s.debug.StopSession(sessionID)
	s.watcher.Stop(sessionID)
	s.documents.CloseSession(sessionID)
	s.lsp.CloseSession(sessionID)
	s.toolchain.CloseSession(sessionID)
	s.goplsMu.Lock()
	delete(s.goplsBinaries, sessionID)
	s.goplsMu.Unlock()
	s.lint.mu.Lock()
	delete(s.lint.custom, sessionID)
	s.lint.mu.Unlock()
	s.runConfigs.CloseSession(sessionID)
	s.tests.CloseSession(sessionID)
	_ = s.history.ForgetSession(sessionID)
	if err := s.recovery.ForgetSession(sessionID); err != nil {
		return err
	}
	s.viewMu.Lock()
	delete(s.views, sessionID)
	s.viewMu.Unlock()
	if err := s.saveState(); err != nil {
		return err
	}
	s.emit("session.closed", sessionID, id, nil)
	return nil
}

// ListDirectory carica in modo lazy un livello dell'albero del progetto.
func (s *Service) ListDirectory(sessionID, relativePath string, includeIgnored bool) ([]FileEntry, error) {
	session, err := s.session(sessionID)
	if err != nil {
		return nil, err
	}
	return s.documents.ListDirectory(session.Project, relativePath, includeIgnored)
}

// OpenDocument apre un file confinato alla sessione indicata.
func (s *Service) OpenDocument(sessionID, relativePath string) (OpenDocument, error) {
	session, err := s.session(sessionID)
	if err != nil {
		return OpenDocument{}, err
	}
	document, err := s.documents.OpenDocument(session, relativePath)
	if err != nil {
		return OpenDocument{}, err
	}
	s.lsp.TrackDocument(session, document.Document, document.Content, false)
	s.emit("document.opened", session.ID, string(document.Document.ID), document.Document)
	return document, nil
}

// SaveDocument salva un documento con controllo delle modifiche esterne.
func (s *Service) SaveDocument(sessionID, documentID, content, diskToken string, force bool) (OpenDocument, error) {
	session, err := s.session(sessionID)
	if err != nil {
		return OpenDocument{}, err
	}
	s.recordOriginalBeforeSave(session, DocumentID(documentID))
	document, err := s.documents.SaveDocument(session, DocumentID(documentID), content, diskToken, force)
	if err != nil {
		return OpenDocument{}, err
	}
	_ = s.history.Record(session.ID, document.Document.RelativePath, content, "Saved")
	s.lsp.DocumentSaved(session.ID, DocumentID(documentID))
	s.emit("document.saved", session.ID, documentID, document.Document)
	return document, nil
}

// CheckDocument rileva modifiche esterne senza sovrascrivere il buffer dell'editor.
func (s *Service) CheckDocument(sessionID, documentID, diskToken string) (DocumentDiskState, error) {
	session, err := s.session(sessionID)
	if err != nil {
		return DocumentDiskState{}, err
	}
	return s.documents.CheckDocument(session, DocumentID(documentID), diskToken)
}

// CloseDocument rilascia un documento già gestito dal frontend.
func (s *Service) CloseDocument(sessionID, documentID string) error {
	if _, err := s.session(sessionID); err != nil {
		return err
	}
	s.documents.CloseDocument(SessionID(sessionID), DocumentID(documentID))
	s.lsp.UntrackDocument(SessionID(sessionID), DocumentID(documentID))
	s.emit("document.closed", SessionID(sessionID), documentID, nil)
	return nil
}

// QuickOpen cerca file per percorso con risultati limitati.
func (s *Service) QuickOpen(sessionID, query string, limit int) ([]QuickOpenResult, error) {
	session, err := s.session(sessionID)
	if err != nil {
		return nil, err
	}
	return s.documents.QuickOpen(session.Project, query, limit)
}

// DetectToolchain rileva Go soltanto in risposta a un'azione esplicita.
func (s *Service) DetectToolchain(sessionID string) (ToolchainInfo, error) {
	session, err := s.session(sessionID)
	if err != nil {
		return ToolchainInfo{}, err
	}
	info := s.toolchain.Detect(session)
	s.emit("toolchain.detected", session.ID, string(session.ID), info)
	return info, nil
}

// ConfigureToolchain registra una configurazione runtime convalidata per la sessione.
func (s *Service) ConfigureToolchain(sessionID string, config ToolchainConfiguration) error {
	if _, err := s.session(sessionID); err != nil {
		return err
	}
	return s.toolchain.Configure(SessionID(sessionID), config)
}

// ListToolchainReleases legge su richiesta le versioni ufficiali compatibili con la piattaforma.
func (s *Service) ListToolchainReleases(sessionID string) ([]ToolchainRelease, error) {
	session, err := s.session(sessionID)
	if err != nil {
		return nil, err
	}
	if session.Project.Authorization != AuthorizationPermitted {
		return nil, fmt.Errorf("autorizza esplicitamente gli strumenti prima di accedere alla rete")
	}
	ctx, cancel := context.WithTimeout(context.Background(), 20*time.Second)
	defer cancel()
	return s.installer.ListReleases(ctx)
}

// ListInstalledToolchains restituisce le versioni Go locali gestite da adOmnia.
func (s *Service) ListInstalledToolchains(sessionID string) ([]InstalledToolchain, error) {
	if _, err := s.session(sessionID); err != nil {
		return nil, err
	}
	return s.installer.ListInstalled()
}

// InstallToolchain avvia un download ufficiale soltanto dopo conferma esplicita.
func (s *Service) InstallToolchain(request InstallToolchainRequest) (ToolchainInstallation, error) {
	session, err := s.session(string(request.SessionID))
	if err != nil {
		return ToolchainInstallation{}, err
	}
	if session.Project.Authorization != AuthorizationPermitted {
		return ToolchainInstallation{}, fmt.Errorf("autorizza esplicitamente gli strumenti prima dell'installazione")
	}
	ctx, cancel := context.WithTimeout(context.Background(), 20*time.Second)
	releases, err := s.installer.ListReleases(ctx)
	cancel()
	if err != nil {
		return ToolchainInstallation{}, err
	}
	var selected ToolchainRelease
	for _, release := range releases {
		if release.Version == request.Version {
			selected = release
			break
		}
	}
	if selected.Version == "" {
		return ToolchainInstallation{}, fmt.Errorf("versione Go non presente nel catalogo ufficiale")
	}
	return s.installer.Start(request, selected, func(binary string, installErr error) {
		if installErr != nil || !request.Activate {
			return
		}
		_ = s.configureInstalledToolchain(request.SessionID, binary)
	})
}

// CancelToolchainInstall annulla il download o l'estrazione indicati.
func (s *Service) CancelToolchainInstall(installID string) error {
	return s.installer.Cancel(installID)
}

// SelectInstalledToolchain seleziona una versione locale per la sessione senza modificare il PATH globale.
func (s *Service) SelectInstalledToolchain(sessionID, version string) error {
	if _, err := s.session(sessionID); err != nil {
		return err
	}
	installed, err := s.installer.ListInstalled()
	if err != nil {
		return err
	}
	for _, candidate := range installed {
		if candidate.Version == version {
			return s.configureInstalledToolchain(SessionID(sessionID), candidate.GoBinary)
		}
	}
	return fmt.Errorf("toolchain Go installata non trovata")
}

func (s *Service) configureInstalledToolchain(sessionID SessionID, binary string) error {
	config := s.toolchain.Configuration(sessionID)
	config.GoBinary = binary
	if config.Environment == nil {
		config.Environment = make(map[string]string)
	}
	config.Environment["GOROOT"] = filepath.Dir(filepath.Dir(binary))
	config.Environment["GOTOOLCHAIN"] = "local"
	return s.toolchain.Configure(sessionID, config)
}

// RemoveInstalledToolchain elimina una versione non in uso dopo conferma esplicita.
func (s *Service) RemoveInstalledToolchain(version string, confirmed bool) error {
	installed, err := s.installer.ListInstalled()
	if err != nil {
		return err
	}
	for _, candidate := range installed {
		if candidate.Version == version && s.toolchain.UsesBinary(candidate.GoBinary) {
			return fmt.Errorf("la toolchain è selezionata da una sessione: scegline un'altra prima di rimuoverla")
		}
	}
	return s.installer.Remove(version, confirmed)
}

// ListDependencies legge i requirement del go.mod scelto senza modificarlo.
func (s *Service) ListDependencies(sessionID, moduleDirectory string) (DependencyState, error) {
	session, err := s.session(sessionID)
	if err != nil {
		return DependencyState{}, err
	}
	return readDependencyState(session.Project, moduleDirectory)
}

// StartDependencyAction esegue go get soltanto dopo anteprima e conferma esplicita.
func (s *Service) StartDependencyAction(request DependencyActionRequest) (Execution, error) {
	if !request.Confirmed {
		return Execution{}, fmt.Errorf("conferma esplicita richiesta prima di modificare le dipendenze")
	}
	session, err := s.session(string(request.SessionID))
	if err != nil {
		return Execution{}, err
	}
	if session.Project.Authorization != AuthorizationPermitted {
		return Execution{}, fmt.Errorf("autorizza esplicitamente gli strumenti per questo progetto")
	}
	state, err := readDependencyState(session.Project, request.ModuleDirectory)
	if err != nil {
		return Execution{}, err
	}
	arguments, err := dependencyArguments(request, state.ModuleDirectory)
	if err != nil {
		return Execution{}, err
	}
	binary, err := s.toolchain.GoBinary(session.ID)
	if err != nil {
		return Execution{}, fmt.Errorf("Go non disponibile: rileva o configura la toolchain prima di modificare le dipendenze")
	}
	environment, err := s.toolchain.Environment(session.ID, nil)
	if err != nil {
		return Execution{}, err
	}
	return s.processes.Start(CommandSpec{
		SessionID: session.ID, Kind: "dependency", Executable: binary, Arguments: arguments,
		WorkingDirectory: state.ModuleDirectory, Environment: environment, DisplayCommand: displayCommand("go", arguments),
	})
}

// supportedRunKinds elenca i comandi rapidi eseguibili da StartRun.
var supportedRunKinds = map[string]bool{
	"build": true, "run": true, "test": true, "vet": true, "generate": true, "install": true, "tidy": true, "binary": true,
}

// runCommandSpec traduce il tipo richiesto nell'eseguibile e negli argomenti strutturati, mai in una riga di shell.
func (s *Service) runCommandSpec(sessionID SessionID, kind, workingDirectory, target string, request RunRequest) (CommandSpec, error) {
	if kind == "binary" {
		executable, err := resolveProjectBinary(workingDirectory, target)
		if err != nil {
			return CommandSpec{}, err
		}
		display := displayCommand(target, nil)
		if len(request.ProgramArguments) > 0 {
			display += fmt.Sprintf(" <%d program args>", len(request.ProgramArguments))
		}
		return CommandSpec{Executable: executable, Arguments: append([]string(nil), request.ProgramArguments...), DisplayCommand: display}, nil
	}
	binary, err := s.toolchain.GoBinary(sessionID)
	if err != nil {
		return CommandSpec{}, fmt.Errorf("Go non disponibile: rileva o configura la toolchain prima di eseguire")
	}
	if kind == "tidy" {
		arguments := []string{"mod", "tidy"}
		return CommandSpec{Executable: binary, Arguments: arguments, DisplayCommand: displayCommand("go", arguments)}, nil
	}
	arguments := append([]string{kind}, request.GoArguments...)
	if len(request.BuildTags) > 0 && kind != "generate" {
		arguments = append(arguments, "-tags", strings.Join(request.BuildTags, ","))
	}
	arguments = append(arguments, target)
	arguments = append(arguments, request.ExtraTargets...)
	display := displayCommand("go", arguments)
	if kind == "run" || kind == "test" {
		arguments = append(arguments, request.ProgramArguments...)
		if kind == "run" && len(request.ProgramArguments) > 0 {
			display += fmt.Sprintf(" <%d program args>", len(request.ProgramArguments))
		} else if kind == "test" {
			display = displayCommand("go", arguments)
		}
	}
	return CommandSpec{Executable: binary, Arguments: arguments, DisplayCommand: display}, nil
}

// resolveProjectBinary risolve un binario già compilato, confinato al progetto e non una cartella.
func resolveProjectBinary(workingDirectory, target string) (string, error) {
	path := filepath.Clean(filepath.Join(workingDirectory, filepath.FromSlash(target)))
	info, err := os.Stat(path)
	if err != nil {
		return "", fmt.Errorf("binario non trovato: compila prima il progetto (%s)", target)
	}
	if info.IsDir() {
		return "", fmt.Errorf("%s è una cartella, non un binario", target)
	}
	return path, nil
}

// StartRun avvia build, run, test, vet, generate, install, tidy o un binario compilato con argomenti strutturati.
func (s *Service) StartRun(request RunRequest) (Execution, error) {
	session, err := s.session(string(request.SessionID))
	if err != nil {
		return Execution{}, err
	}
	if session.Project.Authorization != AuthorizationPermitted {
		return Execution{}, fmt.Errorf("autorizza esplicitamente gli strumenti per questo progetto")
	}
	kind := strings.ToLower(strings.TrimSpace(request.Kind))
	if !supportedRunKinds[kind] {
		return Execution{}, fmt.Errorf("tipo di esecuzione non supportato")
	}
	workingDirectory, err := s.documents.resolveDirectory(session.Project, request.WorkingDirectory)
	if err != nil {
		return Execution{}, err
	}
	target := strings.TrimSpace(request.Target)
	if target == "" {
		target = "."
	}
	if err := validateRunTarget(session.Project.RealPath, workingDirectory, target); err != nil {
		return Execution{}, err
	}
	for _, extra := range request.ExtraTargets {
		if err := validateRunTarget(session.Project.RealPath, workingDirectory, extra); err != nil {
			return Execution{}, err
		}
	}
	if err := validateGoArguments(session.Project.RealPath, workingDirectory, request.GoArguments); err != nil {
		return Execution{}, err
	}
	environment, err := s.toolchain.Environment(session.ID, request.Environment)
	if err != nil {
		return Execution{}, err
	}
	spec, err := s.runCommandSpec(session.ID, kind, workingDirectory, target, request)
	if err != nil {
		return Execution{}, err
	}
	spec.SessionID, spec.Kind, spec.WorkingDirectory, spec.Environment = session.ID, kind, workingDirectory, environment
	execution, err := s.processes.Start(spec)
	if err != nil {
		return Execution{}, err
	}
	request.SessionID = session.ID
	request.WorkingDirectory = workingDirectory
	s.runMu.Lock()
	s.runRequests[execution.ID] = request
	s.runMu.Unlock()
	return execution, nil
}

func validateRunTarget(root, workingDirectory, target string) error {
	converted := filepath.FromSlash(strings.TrimSpace(target))
	if filepath.IsAbs(converted) || filepath.VolumeName(converted) != "" {
		return fmt.Errorf("il target deve restare relativo al progetto")
	}
	candidate := filepath.Clean(filepath.Join(workingDirectory, converted))
	if err := ensureWithinRoot(root, candidate); err != nil {
		return err
	}
	if resolved, err := filepath.EvalSymlinks(candidate); err == nil {
		return ensureWithinRoot(root, resolved)
	}
	return nil
}

func validateGoArguments(root, workingDirectory string, arguments []string) error {
	pathFlags := map[string]bool{"-o": true, "-overlay": true, "-modfile": true, "-pkgdir": true}
	for index := 0; index < len(arguments); index++ {
		argument := arguments[index]
		if strings.ContainsRune(argument, '\x00') {
			return fmt.Errorf("flag Go non valido")
		}
		flag, value, hasValue := strings.Cut(argument, "=")
		if !pathFlags[flag] {
			continue
		}
		if !hasValue {
			index++
			if index >= len(arguments) {
				return fmt.Errorf("%s richiede un percorso", flag)
			}
			value = arguments[index]
		}
		if strings.TrimSpace(value) == "" {
			return fmt.Errorf("%s richiede un percorso", flag)
		}
		candidate := filepath.FromSlash(value)
		if !filepath.IsAbs(candidate) {
			candidate = filepath.Join(workingDirectory, candidate)
		}
		if err := ensureWithinRoot(root, filepath.Clean(candidate)); err != nil {
			return fmt.Errorf("percorso di %s non consentito: %w", flag, err)
		}
		if resolved, err := filepath.EvalSymlinks(candidate); err == nil {
			if err := ensureWithinRoot(root, resolved); err != nil {
				return fmt.Errorf("percorso di %s non consentito: %w", flag, err)
			}
		}
	}
	return nil
}

// StopRun arresta in modo idempotente l'esecuzione indicata.
func (s *Service) StopRun(runID string) error {
	return s.processes.Stop(RunID(runID))
}

// RestartRun arresta l'esecuzione e riapplica la configurazione strutturata originale.
func (s *Service) RestartRun(runID string) (Execution, error) {
	id := RunID(runID)
	s.runMu.RLock()
	request, ok := s.runRequests[id]
	s.runMu.RUnlock()
	if !ok {
		return Execution{}, fmt.Errorf("configurazione dell'esecuzione non trovata")
	}
	if err := s.processes.Stop(id); err != nil {
		return Execution{}, err
	}
	deadline := time.Now().Add(3 * time.Second)
	for time.Now().Before(deadline) {
		if !containsRun(s.processes.List(request.SessionID), id, "running") {
			break
		}
		time.Sleep(25 * time.Millisecond)
	}
	return s.StartRun(request)
}

// WriteRunInput invia input alla console interattiva indicata.
func (s *Service) WriteRunInput(runID, text string) error {
	return s.processes.WriteStdin(RunID(runID), text)
}

// ListRuns restituisce le esecuzioni della sessione senza valori di environment.
func (s *Service) ListRuns(sessionID string) ([]Execution, error) {
	if _, err := s.session(sessionID); err != nil {
		return nil, err
	}
	return s.processes.List(SessionID(sessionID)), nil
}

// HasActiveRuns permette al frontend di chiedere conferma prima di chiudere una sessione.
func (s *Service) HasActiveRuns(sessionID string) bool {
	return s.processes.HasActiveSession(SessionID(sessionID))
}

// HasAnyActiveRuns indica se una sessione IDE possiede ancora processi attivi.
func (s *Service) HasAnyActiveRuns() bool {
	return s.processes.HasActive()
}

// Shutdown arresta le risorse possedute dal dominio in ordine sicuro.
func (s *Service) Shutdown() {
	s.watcher.Shutdown()
	s.installer.Shutdown()
	s.debug.Shutdown()
	s.terminal.Shutdown()
	s.lsp.Shutdown()
	s.processes.Shutdown()
}

func (s *Service) session(id string) (Session, error) {
	if err := s.restore(); err != nil {
		return Session{}, err
	}
	return s.workspace.GetSession(SessionID(id))
}

func (s *Service) restore() error {
	s.restoreOnce.Do(func() {
		state, err := s.persistence.LoadState()
		if err != nil {
			s.restoreErr = err
			return
		}
		s.studioWorkspaces.replace(state.Workspaces, state.ActiveWorkspace)
		sessions := s.studioWorkspaces.assignSessions(state.Sessions)
		s.workspace.ReplaceSessions(sessions)
		for _, session := range s.workspace.ListSessions() {
			s.watchSession(session)
		}
		s.recentMu.Lock()
		s.recent = append([]RecentProject(nil), state.Recent...)
		s.recentMu.Unlock()
		s.runConfigs.Replace(state.RunConfigs)
		s.viewMu.Lock()
		s.views = make(map[SessionID]SessionView, len(state.SessionUI))
		for sessionID, view := range state.SessionUI {
			s.views[sessionID] = view
		}
		s.viewMu.Unlock()
		if err := s.recovery.Load(); err != nil {
			s.restoreErr = err
		}
	})
	return s.restoreErr
}

func (s *Service) saveState() error {
	s.recentMu.RLock()
	recent := append([]RecentProject(nil), s.recent...)
	s.recentMu.RUnlock()
	s.viewMu.RLock()
	views := make(map[SessionID]SessionView, len(s.views))
	for sessionID, view := range s.views {
		views[sessionID] = view
	}
	s.viewMu.RUnlock()
	workspaces, activeWorkspace := s.studioWorkspaces.snapshot()
	return s.persistence.SaveState(persistedState{
		Sessions:        s.workspace.ListSessions(),
		Recent:          recent,
		RunConfigs:      s.runConfigs.Snapshot(),
		SessionUI:       views,
		Workspaces:      workspaces,
		ActiveWorkspace: activeWorkspace,
	})
}

func (s *Service) rememberProject(project Project, openedAt time.Time) {
	s.recentMu.Lock()
	items := make([]RecentProject, 0, min(len(s.recent)+1, maxRecentProjects))
	items = append(items, RecentProject{Name: project.Name, RootPath: project.RootPath, RealPath: project.RealPath, Available: true, OpenedAt: openedAt})
	for _, item := range s.recent {
		if samePath(item.RealPath, project.RealPath) {
			continue
		}
		items = append(items, item)
		if len(items) == maxRecentProjects {
			break
		}
	}
	s.recent = items
	s.recentMu.Unlock()
}

func (s *Service) emit(eventType string, sessionID SessionID, resourceID string, payload any) {
	s.eventMu.RLock()
	sink := s.eventSink
	s.eventMu.RUnlock()
	if sink == nil {
		return
	}
	sink(EventEnvelope{
		Version: 1, Type: eventType, SessionID: sessionID, ResourceID: resourceID,
		Sequence: s.sequence.Add(1), Timestamp: time.Now().UTC(), Payload: payload,
	})
}

func displayCommand(executable string, arguments []string) string {
	parts := []string{executable}
	for _, argument := range arguments {
		if strings.ContainsAny(argument, " \t\"") {
			parts = append(parts, fmt.Sprintf("%q", argument))
		} else {
			parts = append(parts, argument)
		}
	}
	return strings.Join(parts, " ")
}

func containsRun(executions []Execution, runID RunID, status string) bool {
	for _, execution := range executions {
		if execution.ID == runID && execution.Status == status {
			return true
		}
	}
	return false
}

// watchSession avvia in background l'osservazione della cartella del progetto: niente viene eseguito.
// Se il progetto viene chiuso mentre il watcher parte, il controllo finale lo ferma.
func (s *Service) watchSession(session Session) {
	go func() {
		_ = s.watcher.Watch(session.ID, session.Project.RealPath)
		if _, err := s.workspace.GetSession(session.ID); err != nil {
			s.watcher.Stop(session.ID)
		}
	}()
}

// filesChanged inoltra le modifiche su disco al frontend e a gopls, che così vede anche i file non aperti.
func (s *Service) filesChanged(sessionID SessionID, batch FilesChanged) {
	if session, err := s.workspace.GetSession(sessionID); err == nil && changesFileList(batch) {
		s.documents.InvalidateFileIndex(session.Project.RealPath)
	}
	s.lsp.NotifyWatchedFiles(sessionID, batch.Changes)
	s.emit("files.changed", sessionID, string(sessionID), batch)
}

// changesFileList è vero se il batch crea o elimina file: le sole modifiche non cambiano l'elenco.
func changesFileList(batch FilesChanged) bool {
	if batch.Overflow {
		return true
	}
	for _, change := range batch.Changes {
		if change.Kind != FileChanged {
			return true
		}
	}
	return false
}
