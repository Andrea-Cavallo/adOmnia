package codestudio

import (
	"adomnia/internal/ide/flight"
	"adomnia/internal/ide/language"
	"adomnia/internal/ide/preview"
	"adomnia/internal/ide/run"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"maps"
	"os"
	"os/exec"
	"path/filepath"
	"regexp"
	"slices"
	"strings"
	"sync"
	"sync/atomic"
	"time"

	"adomnia/internal/ide/sdk"
	"adomnia/internal/languages/golang"
	"adomnia/internal/languages/java"
)

const maxRecentProjects = 20

var modulePathPattern = regexp.MustCompile(`^[A-Za-z0-9][A-Za-z0-9._~/-]*$`)

type Service struct {
	loadPerf    loadPerformance
	vcsMu       sync.Mutex
	vcsSelected map[SessionID]string
	extensions  extensionHost
	workspace   *WorkspaceManager
	// studioWorkspaces raggruppa le sessioni in workspace Code Studio, separati da quelli di adOmnia.
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
	supervisor       *ProcessSupervisor
	crashMu          sync.Mutex
	crash            CrashStatus
	history          *LocalHistory
	persistence      *Persistence
	viewMu           sync.RWMutex
	views            map[SessionID]SessionView
	restoreMu        sync.Mutex
	restored         atomic.Bool
	saveMu           sync.Mutex
	recentMu         sync.RWMutex
	recent           []RecentProject
	trusted          []string // protetto da recentMu
	// recentChecks limita i controlli di esistenza dei progetti recenti.
	recentChecks  recentAvailabilityCache
	runMu         sync.RWMutex
	runRequests   map[RunID]RunRequest
	sharedEnv     sharedEnvironment
	eventMu       sync.RWMutex
	eventSink     func(EventEnvelope)
	sequence      atomic.Uint64
	toolsRoot     string
	goplsMu       sync.RWMutex
	goplsBinaries map[SessionID]string
	delveBinaries map[SessionID]string
	makeBinaries  map[SessionID]string
	lint          lintRegistry
	sonar         sonarRegistry
	watcher       *WatchManager
	// previews è il Live Server: server statici e dev server dei progetti web, uno per anteprima e sessione.
	previews       *preview.Manager
	previewConfigs previewConfigStore
	// windows registra le sessioni spostate in finestre separate.
	windows *windowRegistry
	// documentObserver riceve apertura, modifiche, salvataggi e chiusure (es. GitHub Copilot).
	documentObserver observerSlot
	// graphState è il Semantic Workspace Graph per sessione (workspace_graph.go).
	graphOnce  sync.Once
	graphState *workspaceGraphs
	// depGraph è la cache del grafo dipendenze (dependencygraph_cache.go).
	depGraph *dependencyGraphCache
	// depFlights unifica i calcoli concorrenti dello stesso grafo (più pannelli che lo chiedono insieme).
	depFlights flight.Group[DependencyGraphReport]
}

func NewService(store Store, eventSink func(EventEnvelope)) *Service {
	languages := newLanguageRegistry()
	service := &Service{
		workspace:        NewWorkspaceManager(languages),
		studioWorkspaces: newStudioWorkspaceRegistry(),
		documents:        NewDocumentManager(),
		toolchain:        NewToolchainManager(),
		processes:        NewProcessManager(),
		lsp:              NewLSPManager(languages),
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
		makeBinaries:     make(map[SessionID]string),
		lint:             lintRegistry{custom: make(map[SessionID]string)},
		sonar:            sonarRegistry{custom: make(map[SessionID]string), configs: make(map[SessionID]SonarConfig), tokens: make(map[SessionID]string)},
		windows:          newWindowRegistry(),
		depGraph:         newDependencyGraphCache(),
	}
	service.recovery = NewRecoveryManager(nil)
	service.workspace.onDetected = func(started time.Time) { service.noteLoad("detectUnits", started) }
	// Language-server readiness: from process start to the ready state, for every start.
	service.lsp.SetReadyObserver(func(elapsed time.Duration) { service.noteLoadElapsed("lspReady", elapsed) })
	service.supervisor = NewProcessSupervisor()
	service.history = NewLocalHistory(nil)
	service.watcher = NewWatchManager(service.filesChanged)
	service.previews = preview.NewManager(service.processes, service.previewChanged)
	service.previews.SetProcessHooks(registerManagedChild, releaseManagedChild)
	service.lsp.SetEmitter(service.emit)
	// go env finisce in background: il rilevamento aggiornato va alla UI e nella cache salvata.
	service.toolchain.SetNotifier(func(sessionID SessionID, info ToolchainInfo) {
		service.emit("toolchain.detected", sessionID, string(sessionID), info)
		_ = service.saveState()
	})
	service.debug.SetEmitter(service.emit)
	service.installer = NewToolchainInstaller(func(eventType string, installation ToolchainInstallation) {
		service.emit(eventType, SessionID(installation.SessionID), installation.ID, installation)
	})
	service.processes.SetEventSink(func(eventType string, execution Execution, payload any) {
		if eventType == "run.finished" {
			service.supervisor.Finish(execution.ID)
		}
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
	s.IDEContributions()
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
		Languages:        s.languageInfos(),
	}
}

// GetRunSchema descrive i campi specifici del linguaggio per un kind di configurazione;
// uno schema vuoto significa che il linguaggio non aggiunge campi (o non esiste).
func (s *Service) GetRunSchema(languageID, kind string) run.FieldSchema {
	if languageID == "" {
		languageID = golang.ID // come normalizeConfiguration: una configurazione senza linguaggio è Go
	}
	if adapter, ok := s.workspace.languages.Get(languageID); ok {
		if provider, ok := adapter.(run.SchemaProvider); ok {
			return provider.RunSchema(kind)
		}
	}
	return run.FieldSchema{Language: languageID, Kind: kind, Fields: []run.Field{}}
}

func (s *Service) languageInfos() []language.Info {
	adapters := s.workspace.languages.All()
	infos := make([]language.Info, 0, len(adapters))
	for _, adapter := range adapters {
		infos = append(infos, language.InfoOf(adapter))
	}
	return infos
}

// OpenProject apre una sessione non autorizzata all'esecuzione e non avvia alcuno strumento.
func (s *Service) OpenProject(path string) (Session, error) {
	s.IDEContributions()
	if err := s.restore(); err != nil {
		return Session{}, err
	}
	session, err := s.workspace.OpenProject(path, s.studioWorkspaces.activeID())
	if err != nil {
		return Session{}, err
	}
	s.rememberProject(session.Project, session.UpdatedAt)
	if session.Project.Authorization != AuthorizationPermitted && s.isTrusted(session.Project.RealPath) {
		if session, err = s.workspace.SetToolAuthorization(session.ID, true); err != nil {
			return Session{}, err
		}
	}
	if err := s.saveState(); err != nil {
		return Session{}, err
	}
	s.watchSession(session)
	s.emit("session.opened", session.ID, string(session.ID), session)
	return session, nil
}

// CreateProject crea una cartella, inizializza il modulo e applica il template scelto
// soltanto dopo conferma esplicita. Se un passo fallisce la cartella appena creata viene rimossa.
func (s *Service) CreateProject(request CreateProjectRequest) (CreateProjectResult, error) {
	sources, template, err := s.resolveProjectTemplate(request.Template)
	if err != nil {
		return CreateProjectResult{}, err
	}
	var warning string
	if template.Language != "" {
		// Progetti non Go: nessun comando da confermare, solo i file del template.
		target, err := s.workspace.CreateProjectDirectory(request.ParentPath, request.Name)
		if err != nil {
			return CreateProjectResult{}, err
		}
		name := strings.TrimSpace(request.Name)
		if _, err := applyResolvedProjectTemplate("", target, name, name, sources, template); err != nil {
			_ = os.RemoveAll(target)
			return CreateProjectResult{}, err
		}
		session, err := s.OpenProject(target)
		return CreateProjectResult{Session: session}, err
	}
	if !request.Confirmed {
		return CreateProjectResult{}, fmt.Errorf("explicit confirmation required before running go mod init")
	}
	modulePath := strings.TrimSpace(request.ModulePath)
	if !modulePathPattern.MatchString(modulePath) || strings.Contains(modulePath, "//") {
		return CreateProjectResult{}, fmt.Errorf("invalid module path")
	}
	target, err := s.workspace.CreateProjectDirectory(request.ParentPath, request.Name)
	if err != nil {
		return CreateProjectResult{}, err
	}
	binary, err := exec.LookPath("go")
	if err != nil {
		_ = os.Remove(target)
		return CreateProjectResult{}, errors.New("go not found: install it or configure PATH before creating a module")
	}
	if err := runGoCommand(binary, target, 20*time.Second, "mod", "init", modulePath); err != nil {
		_ = os.RemoveAll(target)
		return CreateProjectResult{}, fmt.Errorf("go mod init fallito: %w", err)
	}
	warning, err = applyResolvedProjectTemplate(binary, target, modulePath, strings.TrimSpace(request.Name), sources, template)
	if err != nil {
		_ = os.RemoveAll(target)
		return CreateProjectResult{}, err
	}
	session, err := s.OpenProject(target)
	if err != nil {
		return CreateProjectResult{}, err
	}
	return CreateProjectResult{Session: session, Warning: warning}, nil
}

// ListSessions restituisce le sessioni ripristinate e attualmente aperte.
// SessionRoot returns the real folder of an open session.
func (s *Service) SessionRoot(sessionID string) (string, error) {
	sessions, err := s.ListSessions()
	if err != nil {
		return "", err
	}
	for _, session := range sessions {
		if string(session.ID) == sessionID {
			if session.Project.RealPath != "" {
				return session.Project.RealPath, nil
			}
			return session.Project.RootPath, nil
		}
	}
	return "", fmt.Errorf("gO session %s is not open", sessionID)
}

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
	s.recentMu.RLock()
	items := slices.Clone(s.recent)
	s.recentMu.RUnlock()
	// La disponibilità è dato derivato: ogni percorso è controllato al più ogni
	// recentCheckTTL e la sua variazione non riscrive lo stato. Il chiamante
	// riceve una copia, mai lo slice interno.
	for index := range items {
		items[index].Available = s.recentAvailability(items[index].RealPath)
	}
	s.recentMu.Lock()
	for index := range s.recent {
		s.recent[index].Available = items[index].Available
	}
	s.recentMu.Unlock()
	return items, nil
}

// RemoveRecentProject rimuove una voce recente senza toccare cartelle o altre sessioni.
func (s *Service) RemoveRecentProject(path string) error {
	if err := s.restore(); err != nil {
		return err
	}
	s.recentMu.Lock()
	filtered := make([]RecentProject, 0, len(s.recent))
	for _, project := range s.recent {
		if !samePath(project.RealPath, path) && !samePath(project.RootPath, path) {
			filtered = append(filtered, project)
		}
	}
	s.recent = append([]RecentProject(nil), filtered...)
	s.recentMu.Unlock()
	s.forgetRecentAvailability(path)
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
		// Revocare la fiducia ferma tutto ciò che lancia processi: anche shell e debug, come la chiusura della sessione.
		s.previews.StopSession(string(session.ID))
		s.processes.StopSession(session.ID)
		s.lsp.StopSession(session.ID)
		s.terminal.CloseSession(session.ID)
		s.debug.StopSession(session.ID)
	}
	s.setTrusted(session.Project.RealPath, allowed)
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
	// Le anteprime appartengono alla sessione: chiuderla le libera, senza chiedere di fermare il dev server a mano.
	s.previews.StopSession(id)
	if s.processes.HasActiveSession(sessionID) {
		return fmt.Errorf("the session has running processes: stop them before closing it")
	}
	// I buffer non salvati di una finestra separata vivono solo lì: il progetto si chiude
	// dopo averlo riportato nella finestra principale, che passa dalla conferma.
	if owner := s.windows.owner(sessionID); owner != MainWindowID {
		return fmt.Errorf("%w: bring it back to the main window before closing it", ErrSessionInOtherWindow)
	}
	if !s.workspace.CloseSession(sessionID) {
		return nil
	}
	s.depGraph.invalidateSession(sessionID)
	graphs := s.graphs()
	graphs.mu.Lock()
	delete(graphs.cached, id)
	graphs.fresh.forget(id)
	delete(graphs.building, id)
	graphs.mu.Unlock()

	s.vcsMu.Lock()
	delete(s.vcsSelected, sessionID)
	s.vcsMu.Unlock()
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
	s.sonar.mu.Lock()
	delete(s.sonar.custom, sessionID)
	delete(s.sonar.configs, sessionID)
	delete(s.sonar.tokens, sessionID)
	s.sonar.mu.Unlock()
	s.runConfigs.CloseSession(sessionID)
	s.tests.CloseSession(sessionID)
	_ = s.history.ForgetSession(sessionID)
	s.windows.forget(sessionID)
	// Best-effort come history: la sessione è già rimossa, un errore qui non deve saltare viste, stato ed evento di chiusura.
	_ = s.recovery.ForgetSession(sessionID)
	s.viewMu.Lock()
	delete(s.views, sessionID)
	s.viewMu.Unlock()
	s.persistence.DeleteSessionView(sessionID)
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
	// Le immagini non sono testi: restano fuori dal language server e dalle integrazioni di codice.
	if document.Document.Language != "image" {
		s.lsp.TrackDocument(session, document.Document, document.Content, false)
		s.observeDocuments(func(observer DocumentObserver) { observer.DocumentOpened(session, document.Document, document.Content) })
	}
	s.emit("document.opened", session.ID, string(document.Document.ID), document.Document)
	return document, nil
}

// ReadFileDataURL legge un'immagine del progetto come data URL, senza aprire una tab.
func (s *Service) ReadFileDataURL(sessionID, relativePath string) (string, error) {
	session, err := s.session(sessionID)
	if err != nil {
		return "", err
	}
	path, err := s.documents.ResolveProjectPath(session.Project, relativePath)
	if err != nil {
		return "", err
	}
	if _, ok := imageMimeType(path); !ok {
		return "", fmt.Errorf("the file is not a supported image")
	}
	dataURL, _, _, err := readImageFile(path)
	if err != nil {
		return "", err
	}
	return dataURL, nil
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
	s.observeDocuments(func(observer DocumentObserver) { observer.DocumentSaved(DocumentID(documentID)) })
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
	s.observeDocuments(func(observer DocumentObserver) { observer.DocumentClosed(DocumentID(documentID)) })
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
	info := s.toolchain.Detect(session.ID, session.Project.RealPath)
	s.emit("toolchain.detected", session.ID, string(session.ID), info)
	if info.Available && !info.Cached {
		_ = s.saveState()
	}
	return info, nil
}

// ConfigureToolchain registra una configurazione runtime convalidata per la sessione.
func (s *Service) ConfigureToolchain(sessionID string, config ToolchainConfiguration) error {
	if _, err := s.session(sessionID); err != nil {
		return err
	}
	if err := s.toolchain.Configure(SessionID(sessionID), config); err != nil {
		return err
	}
	return s.saveState()
}

// ToolchainSettings restituisce la configurazione del progetto e quella globale per l'editor della toolchain.
func (s *Service) ToolchainSettings(sessionID string) (ToolchainSettings, error) {
	if _, err := s.session(sessionID); err != nil {
		return ToolchainSettings{}, err
	}
	return s.toolchain.Settings(SessionID(sessionID)), nil
}

// ConfigureGlobalToolchain imposta la toolchain predefinita dei progetti senza configurazione propria.
func (s *Service) ConfigureGlobalToolchain(config ToolchainConfiguration) error {
	if err := s.restore(); err != nil {
		return err
	}
	if err := s.toolchain.ConfigureGlobal(config); err != nil {
		return err
	}
	return s.saveState()
}

// UseGlobalToolchain elimina la configurazione del progetto: la sessione torna alla toolchain globale.
func (s *Service) UseGlobalToolchain(sessionID string) error {
	if _, err := s.session(sessionID); err != nil {
		return err
	}
	s.toolchain.ResetSession(SessionID(sessionID))
	return s.saveState()
}

// ListToolchainReleases legge su richiesta le versioni ufficiali compatibili con la piattaforma.
func (s *Service) ListToolchainReleases(sessionID string) ([]ToolchainRelease, error) {
	session, err := s.session(sessionID)
	if err != nil {
		return nil, err
	}
	if session.Project.Authorization != AuthorizationPermitted {
		return nil, fmt.Errorf("explicitly authorize the tools before accessing the network")
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
		return ToolchainInstallation{}, fmt.Errorf("explicitly authorize the tools before installing")
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
		return ToolchainInstallation{}, fmt.Errorf("Go version not in the official catalog")
	}
	return s.installer.Start(request, selected, func(binary string, installErr error) {
		if installErr != nil || !request.Activate {
			return
		}
		_ = s.configureInstalledToolchain(SessionID(request.SessionID), binary)
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
	return fmt.Errorf("installed Go toolchain not found")
}

func (s *Service) configureInstalledToolchain(sessionID SessionID, binary string) error {
	config := s.toolchain.Configuration(sessionID)
	config.GoBinary = binary
	if config.Environment == nil {
		config.Environment = make(map[string]string)
	}
	config.Environment["GOROOT"] = filepath.Dir(filepath.Dir(binary))
	config.Environment["GOTOOLCHAIN"] = "local"
	if err := s.toolchain.Configure(sessionID, config); err != nil {
		return err
	}
	return s.saveState()
}

// RemoveInstalledToolchain elimina una versione non in uso dopo conferma esplicita.
func (s *Service) RemoveInstalledToolchain(version string, confirmed bool) error {
	installed, err := s.installer.ListInstalled()
	if err != nil {
		return err
	}
	for _, candidate := range installed {
		if candidate.Version == version && s.toolchain.UsesBinary(candidate.GoBinary) {
			return fmt.Errorf("the toolchain is selected by a session: choose another one before removing it")
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
		return Execution{}, fmt.Errorf("explicit confirmation required before changing dependencies")
	}
	session, err := s.session(string(request.SessionID))
	if err != nil {
		return Execution{}, err
	}
	if session.Project.Authorization != AuthorizationPermitted {
		return Execution{}, fmt.Errorf("explicitly authorize the tools for this project")
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
		return Execution{}, errors.New("go unavailable: detect or configure the toolchain before changing dependencies")
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

func (s *Service) executionEnvironment(id SessionID, languageID string, overrides map[string]string) ([]string, error) {
	if languageID == golang.ID || languageID == "" {
		return s.toolchain.Environment(id, overrides)
	}
	environment, err := run.Environment(overrides)
	if err != nil || languageID != java.ID {
		return environment, err
	}
	// Run, Debug e Test dello stesso progetto usano lo stesso JDK.
	return append(environment, java.JavaEnvironment(s.projectJavaHome(id))...), nil
}

// Language kinds are declared by adapters.
func (s *Service) runAdapter(id, kind string) (language.Runner, error) {
	if id == "" {
		id = golang.ID
	}
	adapter, ok := s.workspace.languages.Get(id)
	if !ok {
		return nil, fmt.Errorf("language not registered: %s", id)
	}
	runner, ok := adapter.(language.Runner)
	if !ok || !slices.Contains(runner.RunKinds(), kind) {
		return nil, fmt.Errorf("unsupported run type: %s", kind)
	}
	return runner, nil
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
	runner, err := s.runAdapter(request.Language, kind)
	if err != nil {
		return CommandSpec{}, err
	}
	var binary string
	if request.Language == "" || request.Language == golang.ID {
		binary, err = s.toolchain.GoBinary(sessionID)
		if err != nil && request.Remote != nil {
			binary, err = "go", nil // nell'ambiente remoto conta il go del suo PATH, non quello locale
		}
		if err != nil {
			return CommandSpec{}, errors.New("go unavailable: detect or configure the toolchain before running")
		}
	}
	options := request.LanguageOptions
	if len(options) == 0 {
		options, err = json.Marshal(golang.RunOptions{GoArguments: request.GoArguments, BuildTags: request.BuildTags, ExtraTargets: request.ExtraTargets})
		if err != nil {
			return CommandSpec{}, err
		}
	}
	session, err := s.session(string(sessionID))
	if err != nil {
		return CommandSpec{}, err
	}
	environment, err := s.executionEnvironment(sessionID, request.Language, request.Environment)
	if err != nil {
		return CommandSpec{}, err
	}
	if request.Language == java.ID && kind == java.KindMain {
		if spec, ok := s.javaDirectLaunch(session, workingDirectory, request, environment); ok {
			return spec, nil
		}
	}
	return s.runConfigs.core.CommandSpec(runner, run.Request{Environment: environment, Kind: kind, Root: session.Project.RealPath, WorkingDirectory: workingDirectory, Target: target, Executable: binary, ProgramArguments: request.ProgramArguments, LanguageOptions: options})
}

// resolveProjectBinary risolve un binario già compilato, confinato al progetto e non una cartella.
func resolveProjectBinary(workingDirectory, target string) (string, error) {
	path := filepath.Clean(filepath.Join(workingDirectory, filepath.FromSlash(target)))
	info, err := os.Stat(path)
	if err != nil {
		return "", fmt.Errorf("binary not found: build the project first (%s)", target)
	}
	if info.IsDir() {
		return "", fmt.Errorf("%s is a folder, not a binary", target)
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
		return Execution{}, fmt.Errorf("explicitly authorize the tools for this project")
	}
	request.Environment = s.withSharedEnvironment(request.Environment)
	kind := strings.ToLower(strings.TrimSpace(request.Kind))
	if !isToolRunKind(kind) && kind != string(RunKindCommand) && kind != "binary" {
		if _, err := s.runAdapter(request.Language, kind); err != nil {
			return Execution{}, err
		}
	}
	workingDirectory, err := s.documents.resolveDirectory(session.Project, request.WorkingDirectory)
	if err != nil {
		return Execution{}, err
	}
	if isToolRunKind(kind) {
		return s.startToolRun(session, kind, workingDirectory, request)
	}
	if kind == string(RunKindCommand) || kind == string(RunKindGoTool) {
		return s.startCommandRun(session, kind, workingDirectory, request)
	}
	target := strings.TrimSpace(request.Target)
	if target == "" {
		target = "."
	}
	if (kind == "run" || kind == "build") && len(request.ExtraTargets) == 0 {
		workingDirectory, target, err = s.resolveLanguageRunTarget(session, request.Language, kind, workingDirectory, target)
		if err != nil {
			return Execution{}, err
		}
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
	languageID := request.Language
	if kind == "binary" {
		languageID = "generic"
	}
	environment, err := s.executionEnvironment(session.ID, languageID, request.Environment)
	if err != nil {
		return Execution{}, err
	}
	spec, err := s.runCommandSpec(session.ID, kind, workingDirectory, target, request)
	if err != nil {
		return Execution{}, err
	}
	spec.SessionID, spec.Kind, spec.WorkingDirectory = session.ID, kind, workingDirectory
	if spec.Environment == nil {
		spec.Environment = environment
	}
	if spec, err = applyRemote(session, request, spec); err != nil {
		return Execution{}, err
	}
	execution, err := s.processes.Start(spec)
	if err != nil {
		return Execution{}, err
	}
	request.SessionID = session.ID
	request.WorkingDirectory = workingDirectory
	s.rememberRunRequest(execution.ID, request)
	return execution, nil
}

// rememberRunRequest conserva la richiesta strutturata per Rerun.
func (s *Service) rememberRunRequest(runID RunID, request RunRequest) {
	s.runMu.Lock()
	s.runRequests[runID] = request
	s.pruneRunRequestsLocked()
	s.runMu.Unlock()
}

var validateRunTarget = run.ValidateTarget

var validateGoArguments = golang.ValidateGoArguments

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
		return Execution{}, fmt.Errorf("run configuration not found")
	}
	if err := s.processes.Stop(id); err != nil {
		return Execution{}, err
	}
	if !s.processes.WaitStopped(id, 3*time.Second) {
		return Execution{}, errors.New("the previous run did not stop in time: retry")
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
	s.previews.Shutdown()
	s.watcher.Shutdown()
	s.installer.Shutdown()
	s.debug.Shutdown()
	s.terminal.Shutdown()
	s.lsp.Shutdown()
	s.processes.Shutdown()
	// Chiusura pulita: le esecuzioni fermate qui non vanno proposte come interrotte al prossimo avvio.
	s.supervisor.Clear()
}

func (s *Service) session(id string) (Session, error) {
	if err := s.restore(); err != nil {
		return Session{}, err
	}
	return s.workspace.GetSession(SessionID(id))
}

// restore carica lo stato persistito alla prima chiamata. A differenza di
// sync.Once un errore non è definitivo (es. store non ancora pronto): la
// chiamata successiva riprova invece di lasciare Code Studio inutilizzabile.
func (s *Service) restore() error {
	if s.restored.Load() {
		return nil
	}
	started := time.Now()
	s.restoreMu.Lock()
	defer s.restoreMu.Unlock()
	if s.restored.Load() {
		return nil
	}
	state, err := s.persistence.LoadState()
	if err != nil {
		return err
	}
	if err := s.recovery.Load(); err != nil {
		return err
	}
	s.studioWorkspaces.replace(state.Workspaces, state.ActiveWorkspace)
	sessions := s.studioWorkspaces.assignSessions(state.Sessions)
	s.workspace.ReplaceSessions(sessions)
	s.recentMu.Lock()
	s.recent = slices.Clone(state.Recent)
	s.trusted = slices.Clone(state.TrustedPaths)
	s.recentMu.Unlock()
	s.runConfigs.Replace(state.RunConfigs)
	s.previewConfigs.replace(state.PreviewConfigs)
	s.sonar.replaceConfigs(state.SonarConfigs)
	globalToolchain := ToolchainConfiguration{}
	if state.GlobalToolchain != nil {
		globalToolchain = *state.GlobalToolchain
	}
	s.toolchain.Replace(state.Toolchains, globalToolchain)
	s.toolchain.RestoreDetected(state.DetectedToolchains)
	sdk.RestoreVersions(state.ToolVersions)
	views := maps.Clone(state.SessionUI)
	if views == nil {
		views = make(map[SessionID]SessionView)
	}
	s.viewMu.Lock()
	s.views = views
	s.viewMu.Unlock()
	s.restored.Store(true)
	s.noteLoad("restore", started)
	return nil
}

// saveState persiste uno snapshot coerente. saveMu copre snapshot e scrittura
// insieme: senza, due salvataggi concorrenti potrebbero scrivere per ultimo lo
// snapshot più vecchio.
func (s *Service) saveState() error {
	s.saveMu.Lock()
	defer s.saveMu.Unlock()
	s.recentMu.RLock()
	recent := slices.Clone(s.recent)
	trusted := slices.Clone(s.trusted)
	s.recentMu.RUnlock()
	s.viewMu.RLock()
	views := maps.Clone(s.views)
	s.viewMu.RUnlock()
	workspaces, activeWorkspace := s.studioWorkspaces.snapshot()
	toolchains, globalToolchain := s.toolchain.Snapshot()
	return s.persistence.SaveState(persistedState{
		Toolchains:         toolchains,
		GlobalToolchain:    &globalToolchain,
		DetectedToolchains: s.toolchain.DetectedSnapshot(),
		ToolVersions:       sdk.VersionsSnapshot(),
		Sessions:           s.workspace.ListSessions(),
		Recent:             recent,
		RunConfigs:         s.runConfigs.Snapshot(),
		SessionUI:          views,
		Workspaces:         workspaces,
		ActiveWorkspace:    activeWorkspace,
		TrustedPaths:       trusted,
		SonarConfigs:       s.sonar.configSnapshot(),
		PreviewConfigs:     s.previewConfigs.snapshot(),
	})
}

func (s *Service) isTrusted(realPath string) bool {
	s.recentMu.RLock()
	defer s.recentMu.RUnlock()
	return slices.ContainsFunc(s.trusted, func(path string) bool { return samePath(path, realPath) })
}

// setTrusted ricorda (o dimentica) il consenso per la cartella, così vale anche alle riaperture.
func (s *Service) setTrusted(realPath string, allowed bool) {
	s.recentMu.Lock()
	defer s.recentMu.Unlock()
	s.trusted = slices.DeleteFunc(slices.Clone(s.trusted), func(path string) bool { return samePath(path, realPath) })
	if allowed {
		s.trusted = append(s.trusted, realPath)
	}
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

// pruneRunRequestsLocked scarta le richieste delle esecuzioni già uscite dallo
// storico del ProcessManager, così la mappa non cresce senza limite.
func (s *Service) pruneRunRequestsLocked() {
	if len(s.runRequests) <= maxExecutionHistory {
		return
	}
	known := make(map[RunID]struct{}, maxExecutionHistory)
	for _, execution := range s.processes.List("") {
		known[execution.ID] = struct{}{}
	}
	for runID := range s.runRequests {
		if _, ok := known[runID]; !ok {
			delete(s.runRequests, runID)
		}
	}
}

// watchSession avvia in background l'osservazione della cartella del progetto: niente viene eseguito.
// Se il progetto viene chiuso mentre il watcher parte, il controllo finale lo ferma.
func (s *Service) watchSession(session Session) {
	go func() {
		started := time.Now()
		alreadyWatching := s.watcher.Watching(session.ID)
		stillOpen := func() bool {
			_, err := s.workspace.GetSession(session.ID)
			return err == nil
		}
		if err := s.watcher.Watch(session.ID, session.Project.RealPath, stillOpen); err == nil && !alreadyWatching && s.watcher.Watching(session.ID) {
			s.noteLoad("watcherReady", started)
		}
		if _, err := s.workspace.GetSession(session.ID); err != nil {
			s.watcher.Stop(session.ID)
		}
	}()
}

// filesChanged inoltra le modifiche su disco al frontend e a gopls, che così vede anche i file non aperti.
func (s *Service) filesChanged(sessionID SessionID, batch FilesChanged) {
	// I cambiamenti ai sorgenti alterano anche l'analisi -deps del grafo dipendenze.
	s.depGraph.invalidateSession(sessionID)
	if session, err := s.workspace.GetSession(sessionID); err == nil && changesFileList(batch) {
		s.documents.InvalidateFileIndex(session.Project.RealPath)
	}
	s.noteGraphChanges(sessionID, batch)
	s.lsp.NotifyWatchedFiles(sessionID, batch.Changes)
	s.notifyPreviews(sessionID, batch)
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
