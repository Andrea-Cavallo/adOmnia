package main

import (
	"adomnia/internal/copilot"
	"adomnia/internal/git"
	"adomnia/internal/goide"
	"adomnia/internal/goidewindow"
	"adomnia/internal/plugins"
	"adomnia/internal/storage"
	"context"
	"fmt"
	"path/filepath"
	"strings"
	"sync/atomic"

	"github.com/wailsapp/wails/v3/pkg/application"
	"github.com/wailsapp/wails/v3/pkg/events"
)

const (
	goIDEStorageKey    = "state"
	goIDERecoveryKey   = "recovery"
	goIDESupervisorKey = "supervisor"
	goIDEHistoryKey    = "localHistory"
)

// goIDEHistoryStore conserva la local history in una chiave separata, con i propri limiti.
type goIDEHistoryStore struct{}

func (goIDEHistoryStore) Load() ([]byte, error) {
	if storage.DB() == nil {
		return nil, nil
	}
	return storage.Get("goide", goIDEHistoryKey)
}

func (goIDEHistoryStore) Save(data []byte) error {
	if storage.DB() == nil {
		return fmt.Errorf("archivio locale non inizializzato")
	}
	return storage.Put("goide", goIDEHistoryKey, data)
}

// goIDEStore conserva lo stato di sessione, configurazioni Run e layout.
type goIDEStore struct{}

func (goIDEStore) Load() ([]byte, error) {
	if storage.DB() == nil {
		return nil, nil
	}
	return storage.Get("goide", goIDEStorageKey)
}

func (goIDEStore) Save(data []byte) error {
	if storage.DB() == nil {
		return fmt.Errorf("archivio locale non inizializzato")
	}
	return storage.Put("goide", goIDEStorageKey, data)
}

// goIDERecoveryStore conserva i buffer non salvati in una chiave separata, per
// non far crescere lo stato di sessione con contenuti di lavoro.
// goIDESupervisorStore conserva le esecuzioni in corso: dopo un crash restano quelle interrotte.
type goIDESupervisorStore struct{}

func (goIDESupervisorStore) Load() ([]byte, error) {
	if storage.DB() == nil {
		return nil, nil
	}
	return storage.Get("goide", goIDESupervisorKey)
}

func (goIDESupervisorStore) Save(data []byte) error {
	if storage.DB() == nil {
		return fmt.Errorf("archivio locale non inizializzato")
	}
	return storage.Put("goide", goIDESupervisorKey, data)
}

type goIDERecoveryStore struct{}

func (goIDERecoveryStore) Load() ([]byte, error) {
	if storage.DB() == nil {
		return nil, nil
	}
	return storage.Get("goide", goIDERecoveryKey)
}

func (goIDERecoveryStore) Save(data []byte) error {
	if storage.DB() == nil {
		return fmt.Errorf("archivio locale non inizializzato")
	}
	if len(data) == 0 {
		return storage.Delete("goide", goIDERecoveryKey)
	}
	return storage.Put("goide", goIDERecoveryKey, data)
}

// LoadWorkspaces legge le chiavi recovery/<workspace-id>: una per progetto.
func (goIDERecoveryStore) LoadWorkspaces() (map[string][]byte, error) {
	if storage.DB() == nil {
		return nil, nil
	}
	keys, err := storage.List("goide", goide.RecoveryWorkspacePrefix)
	if err != nil {
		return nil, err
	}
	workspaces := make(map[string][]byte, len(keys))
	for _, key := range keys {
		data, err := storage.Get("goide", key)
		if err != nil {
			return nil, err
		}
		workspaces[strings.TrimPrefix(key, goide.RecoveryWorkspacePrefix)] = data
	}
	return workspaces, nil
}

func (goIDERecoveryStore) SaveWorkspace(workspaceID string, data []byte) error {
	if storage.DB() == nil {
		return fmt.Errorf("archivio locale non inizializzato")
	}
	if len(data) == 0 {
		return storage.Delete("goide", goide.RecoveryWorkspacePrefix+workspaceID)
	}
	return storage.Put("goide", goide.RecoveryWorkspacePrefix+workspaceID, data)
}

type GoIDE struct {
	service            *goide.Service
	desktop            *application.App
	mainWindow         *application.WebviewWindow
	dirtyDocumentCount atomic.Int64
	allowAppClose      atomic.Bool
	// windows possiede le finestre Go Studio separate (una per progetto).
	windows *goidewindow.Manager
	// serviceListeners ricevono gli eventi gO lato backend (es. DevContext).
	serviceListeners []func(goide.EventEnvelope)
	// runtimeLock segnala ai prossimi avvii se questo si è chiuso in modo anomalo.
	runtimeLock *goide.RuntimeLock
}

func NewGoIDE() *GoIDE {
	var binding *GoIDE
	service := goide.NewService(goIDEStore{}, func(event goide.EventEnvelope) {
		if binding != nil && binding.desktop != nil {
			binding.desktop.Event.Emit("goide:event", event)
		}
		forwardGoIDEPluginEvent(event)
		if binding != nil {
			for _, listener := range binding.serviceListeners {
				listener(event)
			}
		}
	})
	_ = service.ConfigureToolchainStorage(filepath.Join(dataDir(), "goide", "toolchains"))
	_ = service.ConfigureRecoveryStore(goIDERecoveryStore{})
	_ = service.ConfigureHistoryStore(goIDEHistoryStore{})
	_ = service.ConfigureSupervisorStore(goIDESupervisorStore{})
	binding = &GoIDE{service: service}
	if lock, status, err := goide.AcquireRuntimeLock(filepath.Join(dataDir(), "goide"), nil); err == nil {
		binding.runtimeLock = lock
		service.SetCrashStatus(status)
	}
	return binding
}

func init() {
	plugins.RegisterHookEvents(goide.PluginEvents...)
}

// forwardGoIDEPluginEvent consegna ai plugin, in modo asincrono e in sola lettura, gli eventi del contratto Go Studio.
func forwardGoIDEPluginEvent(event goide.EventEnvelope) {
	if globalPluginManager == nil {
		return
	}
	if eventType, payload, ok := goide.PluginEventFor(event); ok {
		globalPluginManager.FireEvent(PluginEvent{Type: eventType, Payload: payload})
	}
}

// ProjectServices elenca i servizi esterni (database, broker, osservabilità) usati dal progetto.
func (g *GoIDE) ProjectServices(sessionID string) ([]goide.ProjectService, error) {
	return g.service.ProjectServices(sessionID)
}

func (g *GoIDE) attachDesktop(desktop *application.App) {
	g.desktop = desktop
	g.windows = goidewindow.New(desktop, isAppChrome(startupWindowChrome), func(windowID string) {
		g.service.ReleaseWindow(windowID)
	})
}

func (g *GoIDE) attachMainWindow(window *application.WebviewWindow) {
	g.mainWindow = window
	window.RegisterHook(events.Common.WindowClosing, func(event *application.WindowEvent) {
		if !g.allowAppClose.Swap(false) && g.cancelMainClose(event) {
			return
		}
		// La finestra principale si chiude davvero: le finestre Go Studio, già
		// verificate senza buffer non salvati, si chiudono con lei.
		if g.windows != nil {
			g.windows.CloseAll()
		}
	})
}

// onServiceEvent lets other backend services react to gO events (saves,
// closed sessions). Register listeners before the app starts.
func (g *GoIDE) onServiceEvent(listener func(goide.EventEnvelope)) {
	g.serviceListeners = append(g.serviceListeners, listener)
}

// sessionRoot resolves the project folder of an open gO session.
func (g *GoIDE) sessionRoot(sessionID string) (string, error) {
	sessions, err := g.service.ListSessions()
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

// WorkspaceModuleGraph restituisce le dipendenze tra i moduli del progetto, lette dai go.mod.
func (g *GoIDE) WorkspaceModuleGraph(sessionID string) ([]goide.WorkspaceModule, error) {
	return g.service.WorkspaceModuleGraph(sessionID)
}

// PrivateRepoCredentialStatus dice se il gestore credenziali di Git conosce l'host (mai il token).
func (g *GoIDE) PrivateRepoCredentialStatus(host string) (goide.PrivateRepoCredential, error) {
	return g.service.PrivateRepoCredentialStatus(host)
}

// SavePrivateRepoCredential affida username e token di un host privato al gestore credenziali di Git.
func (g *GoIDE) SavePrivateRepoCredential(host, username, token string) (goide.PrivateRepoCredential, error) {
	return g.service.SavePrivateRepoCredential(host, username, token)
}

// RemovePrivateRepoCredential toglie le credenziali di un host dal gestore credenziali di Git.
func (g *GoIDE) RemovePrivateRepoCredential(host string) error {
	return g.service.RemovePrivateRepoCredential(host)
}

// GoAuthWithGitCredentials è il valore GOAUTH che fa usare a go le credenziali di Git.
func (g *GoIDE) GoAuthWithGitCredentials() string {
	return g.service.GoAuthWithGitCredentials()
}

// TestModuleRegistry prova il primo GOPROXY della sessione (registry interno) con proxy, CA e credenziali.
func (g *GoIDE) TestModuleRegistry(sessionID string) (goide.ModuleRegistryCheck, error) {
	return g.service.TestModuleRegistry(sessionID)
}

// AIProjectPolicy restituisce la politica AI del progetto: "allowed", "local-only" o "off".
func (g *GoIDE) AIProjectPolicy(sessionID string) (string, error) {
	root, err := g.sessionRoot(sessionID)
	if err != nil {
		return "", err
	}
	return copilot.LoadAIPolicy(root), nil
}

// SetAIProjectPolicy scrive .adomnia/ai-policy.json (o lo rimuove per "allowed").
func (g *GoIDE) SetAIProjectPolicy(sessionID, policy string) error {
	root, err := g.sessionRoot(sessionID)
	if err != nil {
		return err
	}
	return copilot.SaveAIPolicy(root, policy)
}

// AIExcludedPaths restituisce, tra i percorsi indicati, quelli che non devono mai lasciare la
// macchina verso un provider AI: segreti noti (.env, chiavi, certificati) e .adomnia/aiignore del progetto.
// localProvider indica un modello su questa macchina: conta per la politica "local-only" del progetto.
func (g *GoIDE) AIExcludedPaths(sessionID string, relativePaths []string, localProvider bool) ([]string, error) {
	root, err := g.sessionRoot(sessionID)
	if err != nil {
		return nil, err
	}
	filter := copilot.LoadContextFilterFor(root, localProvider)
	excluded := []string{}
	for _, relativePath := range relativePaths {
		if filter.Excluded(relativePath) {
			excluded = append(excluded, relativePath)
		}
	}
	return excluded, nil
}

// cancelMainClose annulla la chiusura quando restano buffer non salvati o
// processi attivi. I buffer di una finestra separata vivono solo in quella
// finestra: la si porta in primo piano perché sia lei a chiedere conferma.
func (g *GoIDE) cancelMainClose(event *application.WindowEvent) bool {
	if g.desktop == nil {
		return false
	}
	if g.windows != nil {
		if windowID, dirty, ok := g.windows.FirstDirty(); ok {
			event.Cancel()
			_ = g.windows.Focus(windowID)
			g.desktop.Event.Emit(goidewindow.CloseRequestedEvent, map[string]any{"windowId": windowID, "dirtyDocumentCount": dirty})
			return true
		}
	}
	dirtyCount := g.dirtyDocumentCount.Load()
	activeRuns := g.service.HasAnyActiveRuns()
	if dirtyCount == 0 && !activeRuns {
		return false
	}
	event.Cancel()
	g.desktop.Event.Emit("goide:close-requested", map[string]any{
		"dirtyDocumentCount": dirtyCount,
		"activeRuns":         activeRuns,
	})
	return true
}

// OpenSessionWindow sposta il progetto in una finestra Go Studio separata, o
// mette a fuoco quella già aperta. Il frontend chiamante deve aver salvato i
// buffer del progetto: restano nella finestra che li possiede.
func (g *GoIDE) OpenSessionWindow(sessionID string) (string, error) {
	if g.windows == nil {
		return "", fmt.Errorf("runtime desktop non inizializzato")
	}
	sessions, err := g.service.ListSessions()
	if err != nil {
		return "", err
	}
	name := ""
	for _, session := range sessions {
		if string(session.ID) == sessionID {
			name = session.Project.Name
		}
	}
	if name == "" {
		return "", fmt.Errorf("sessione %q non trovata", sessionID)
	}
	windowID, err := goidewindow.WindowIDFor(sessionID)
	if err != nil {
		return "", err
	}
	if _, err := g.service.ClaimSessionWindow(sessionID, windowID, true); err != nil {
		return "", err
	}
	if _, err := g.windows.Open(sessionID, name); err != nil {
		g.service.ReleaseWindow(windowID)
		return "", err
	}
	return windowID, nil
}

// ClaimSessionWindow verifica o assegna la proprietà del progetto a una finestra.
func (g *GoIDE) ClaimSessionWindow(sessionID, windowID string, force bool) (goide.SessionWindow, error) {
	return g.service.ClaimSessionWindow(sessionID, windowID, force)
}

// ListSessionWindows elenca i progetti aperti in finestre separate.
func (g *GoIDE) ListSessionWindows() []goide.SessionWindow {
	return g.service.ListSessionWindows()
}

// FocusSessionWindow porta in primo piano la finestra separata indicata.
func (g *GoIDE) FocusSessionWindow(windowID string) error {
	if g.windows == nil {
		return fmt.Errorf("runtime desktop non inizializzato")
	}
	return g.windows.Focus(windowID)
}

// CloseSessionWindow chiude la finestra separata, con conferma se ha buffer
// non salvati; il progetto torna alla finestra principale.
func (g *GoIDE) CloseSessionWindow(windowID string) error {
	if g.windows == nil {
		return fmt.Errorf("runtime desktop non inizializzato")
	}
	return g.windows.RequestClose(windowID)
}

// ConfirmSessionWindowClose chiude la finestra dopo che ha salvato o scartato i buffer.
func (g *GoIDE) ConfirmSessionWindowClose(windowID string) error {
	if g.windows == nil {
		return fmt.Errorf("runtime desktop non inizializzato")
	}
	return g.windows.ConfirmClose(windowID)
}

// SetWindowDirtyDocumentCount sincronizza i buffer non salvati di una finestra separata.
func (g *GoIDE) SetWindowDirtyDocumentCount(windowID string, count int) {
	if g.windows != nil {
		g.windows.SetDirtyCount(windowID, count)
	}
}

// GetCapabilities restituisce soltanto le capacità Go Studio realmente disponibili.
func (g *GoIDE) GetCapabilities() goide.Capabilities {
	return g.service.GetCapabilities()
}

// OpenProject registra una cartella locale senza avviarne codice o strumenti.
func (g *GoIDE) OpenProject(path string) (goide.Session, error) {
	return g.service.OpenProject(path)
}

// CreateProject crea un modulo Go (opzionalmente da template) soltanto dopo la conferma esplicita inclusa nella richiesta.
func (g *GoIDE) CreateProject(request goide.CreateProjectRequest) (goide.CreateProjectResult, error) {
	return g.service.CreateProject(request)
}

// ListProjectTemplates restituisce i template di progetto integrati e quelli dell'utente.
func (g *GoIDE) ListProjectTemplates() (goide.ProjectTemplateList, error) {
	return g.service.ListProjectTemplates()
}

// ListSessions restituisce le sessioni Go Studio correnti e ripristinate.
func (g *GoIDE) ListSessions() ([]goide.Session, error) {
	return g.service.ListSessions()
}

// ListRecentProjects restituisce i progetti locali aperti di recente.
func (g *GoIDE) ListRecentProjects() ([]goide.RecentProject, error) {
	return g.service.ListRecentProjects()
}

// RemoveRecentProject rimuove una voce recente senza modificare il filesystem.
func (g *GoIDE) RemoveRecentProject(path string) error {
	return g.service.RemoveRecentProject(path)
}

// SetToolAuthorization registra il consenso esplicito all'uso degli strumenti.
func (g *GoIDE) SetToolAuthorization(id string, allowed bool) (goide.Session, error) {
	return g.service.SetToolAuthorization(id, allowed)
}

// CloseSession chiude una sessione senza modificare la cartella del progetto.
func (g *GoIDE) CloseSession(id string) error {
	return g.service.CloseSession(id)
}

// ListDirectory carica un singolo livello dell'albero file.
func (g *GoIDE) ListDirectory(sessionID, relativePath string, includeIgnored bool) ([]goide.FileEntry, error) {
	return g.service.ListDirectory(sessionID, relativePath, includeIgnored)
}

// OpenDocument apre un documento testuale o un'immagine confinato al progetto.
func (g *GoIDE) OpenDocument(sessionID, relativePath string) (goide.OpenDocument, error) {
	return g.service.OpenDocument(sessionID, relativePath)
}

// ReadFileDataURL legge un'immagine del progetto come data URL, per gli asset del Markdown.
func (g *GoIDE) ReadFileDataURL(sessionID, relativePath string) (string, error) {
	return g.service.ReadFileDataURL(sessionID, relativePath)
}

// SaveDocument salva atomicamente il buffer con protezione dalle modifiche esterne.
func (g *GoIDE) SaveDocument(sessionID, documentID, content, diskToken string, force bool) (goide.OpenDocument, error) {
	return g.service.SaveDocument(sessionID, documentID, content, diskToken, force)
}

// CheckDocument rileva cambiamenti su disco senza sovrascrivere il buffer.
func (g *GoIDE) CheckDocument(sessionID, documentID, diskToken string) (goide.DocumentDiskState, error) {
	return g.service.CheckDocument(sessionID, documentID, diskToken)
}

// CloseDocument rilascia la risorsa documento indicata.
func (g *GoIDE) CloseDocument(sessionID, documentID string) error {
	return g.service.CloseDocument(sessionID, documentID)
}

// QuickOpen cerca file del progetto con limite dei risultati.
func (g *GoIDE) QuickOpen(sessionID, query string, limit int) ([]goide.QuickOpenResult, error) {
	return g.service.QuickOpen(sessionID, query, limit)
}

// DetectToolchain rileva la toolchain Go su richiesta dell'utente.
func (g *GoIDE) DetectToolchain(sessionID string) (goide.ToolchainInfo, error) {
	return g.service.DetectToolchain(sessionID)
}

// ConfigureToolchain imposta binario e variabili della sessione dopo validazione.
func (g *GoIDE) ConfigureToolchain(sessionID string, config goide.ToolchainConfiguration) error {
	return g.service.ConfigureToolchain(sessionID, config)
}

// StartConfiguredBuild compila una configurazione con tutti i suoi parametri.
func (g *GoIDE) StartConfiguredBuild(sessionID, configID string) (goide.Execution, error) {
	return g.service.StartConfiguredBuild(sessionID, configID)
}

// ToolchainSettings restituisce la toolchain del progetto e quella globale.
func (g *GoIDE) ToolchainSettings(sessionID string) (goide.ToolchainSettings, error) {
	return g.service.ToolchainSettings(sessionID)
}

// ConfigureGlobalToolchain imposta la toolchain predefinita dei progetti.
func (g *GoIDE) ConfigureGlobalToolchain(config goide.ToolchainConfiguration) error {
	return g.service.ConfigureGlobalToolchain(config)
}

// UseGlobalToolchain riporta il progetto alla toolchain globale.
func (g *GoIDE) UseGlobalToolchain(sessionID string) error {
	return g.service.UseGlobalToolchain(sessionID)
}

// ListToolchainReleases restituisce il catalogo ufficiale compatibile su richiesta esplicita.
func (g *GoIDE) ListToolchainReleases(sessionID string) ([]goide.ToolchainRelease, error) {
	return g.service.ListToolchainReleases(sessionID)
}

// ListInstalledToolchains restituisce le versioni Go isolate disponibili localmente.
func (g *GoIDE) ListInstalledToolchains(sessionID string) ([]goide.InstalledToolchain, error) {
	return g.service.ListInstalledToolchains(sessionID)
}

// InstallToolchain avvia download, checksum ed estrazione della versione scelta.
func (g *GoIDE) InstallToolchain(request goide.InstallToolchainRequest) (goide.ToolchainInstallation, error) {
	return g.service.InstallToolchain(request)
}

// CancelToolchainInstall annulla l'installazione indicata.
func (g *GoIDE) CancelToolchainInstall(installID string) error {
	return g.service.CancelToolchainInstall(installID)
}

// SelectInstalledToolchain seleziona la versione Go attiva per una sessione.
func (g *GoIDE) SelectInstalledToolchain(sessionID, version string) error {
	return g.service.SelectInstalledToolchain(sessionID, version)
}

// RemoveInstalledToolchain elimina una versione gestita non in uso.
func (g *GoIDE) RemoveInstalledToolchain(version string, confirmed bool) error {
	return g.service.RemoveInstalledToolchain(version, confirmed)
}

// ListDependencies legge le dipendenze del modulo senza eseguire comandi.
func (g *GoIDE) ListDependencies(sessionID, moduleDirectory string) (goide.DependencyState, error) {
	return g.service.ListDependencies(sessionID, moduleDirectory)
}

// ListModuleVersions elenca le versioni pubblicate di una dipendenza, dalla più recente.
func (g *GoIDE) ListModuleVersions(sessionID, moduleDirectory, modulePath string) ([]string, error) {
	return g.service.ListModuleVersions(sessionID, moduleDirectory, modulePath)
}

// StartDependencyAction applica un go get strutturato dopo conferma esplicita.
func (g *GoIDE) StartDependencyAction(request goide.DependencyActionRequest) (goide.Execution, error) {
	return g.service.StartDependencyAction(request)
}

// DependencyGraph costruisce il grafo delle dipendenze del modulo senza rete (albero, duplicati, licenze, peso).
func (g *GoIDE) DependencyGraph(sessionID, moduleDirectory string) (goide.DependencyGraphReport, error) {
	return g.service.DependencyGraph(sessionID, moduleDirectory)
}

// DependencyUpdates elenca le versioni più recenti disponibili per i moduli (richiede rete).
func (g *GoIDE) DependencyUpdates(sessionID, moduleDirectory string) ([]goide.DependencyUpdate, error) {
	return g.service.DependencyUpdates(sessionID, moduleDirectory)
}

// DependencyVulnerabilities esegue govulncheck sul modulo (richiede rete e govulncheck installato).
func (g *GoIDE) DependencyVulnerabilities(sessionID, moduleDirectory string) ([]goide.DependencyVulnerability, error) {
	return g.service.DependencyVulnerabilities(sessionID, moduleDirectory)
}

// VulnerabilityScan esegue govulncheck con percorsi di chiamata, versione corretta e catena di dipendenze.
func (g *GoIDE) VulnerabilityScan(sessionID, moduleDirectory string) (goide.VulnReport, error) {
	return g.service.VulnerabilityScan(sessionID, moduleDirectory)
}

// SecurityScan analizza offline i file del progetto: segreti e regole statiche di sicurezza.
func (g *GoIDE) SecurityScan(sessionID string) (goide.SecurityReport, error) {
	return g.service.SecurityScan(sessionID)
}

// SuppressSecurityFinding sopprime un finding con motivazione (salvata in .adomnia/security.json).
func (g *GoIDE) SuppressSecurityFinding(sessionID string, finding goide.SecurityFinding, reason string) error {
	return g.service.SuppressSecurityFinding(sessionID, finding, reason)
}

// UnsuppressSecurityFinding toglie una soppressione registrata dal pannello.
func (g *GoIDE) UnsuppressSecurityFinding(sessionID, fingerprint string) error {
	return g.service.UnsuppressSecurityFinding(sessionID, fingerprint)
}

// SaveSecurityBaseline accetta i finding attuali: le scansioni successive mostrano solo i nuovi.
func (g *GoIDE) SaveSecurityBaseline(sessionID string) (int, error) {
	return g.service.SaveSecurityBaseline(sessionID)
}

// ClearSecurityBaseline rimuove la baseline di sicurezza.
func (g *GoIDE) ClearSecurityBaseline(sessionID string) error {
	return g.service.ClearSecurityBaseline(sessionID)
}

// StartTests avvia go test -json; l'albero dei risultati arriva con gli eventi tests.updated.
func (g *GoIDE) StartTests(request goide.TestRunRequest) (goide.TestRunSnapshot, error) {
	return g.service.StartTests(request)
}

// GetTestRun restituisce un'esecuzione di test con l'output di ogni nodo.
func (g *GoIDE) GetTestRun(runID string) (goide.TestRunSnapshot, error) {
	return g.service.GetTestRun(runID)
}

// GetTestOutput restituisce l'output di un solo test.
func (g *GoIDE) GetTestOutput(runID, nodeID string) (string, error) {
	return g.service.GetTestOutput(runID, nodeID)
}

// ListTestRuns restituisce le esecuzioni di test della sessione, dalla più recente.
func (g *GoIDE) ListTestRuns(sessionID string) ([]goide.TestRunSnapshot, error) {
	return g.service.ListTestRuns(sessionID)
}

// ListProfileFiles elenca i profili pprof (*.pprof) trovati nel progetto, per il Performance Studio.
func (g *GoIDE) ListProfileFiles(sessionID string) ([]goide.ProfileFile, error) {
	return g.service.ListProfileFiles(sessionID)
}

// CaptureLiveProfile salva nel progetto un profilo scaricato da /debug/pprof di un servizio locale.
func (g *GoIDE) CaptureLiveProfile(ctx context.Context, request goide.LiveProfileRequest) (goide.ProfileFile, error) {
	return g.service.CaptureLiveProfile(ctx, request)
}

// LoadProfile interpreta un profilo pprof del progetto in un report per il Performance Studio.
func (g *GoIDE) LoadProfile(sessionID, relativePath string) (goide.ProfileReport, error) {
	return g.service.LoadProfile(sessionID, relativePath)
}

// ListTraceFiles elenca i file di esecuzione trace (`trace.out`, `*.trace`) del progetto.
func (g *GoIDE) ListTraceFiles(sessionID string) ([]goide.ProfileFile, error) {
	return g.service.ListTraceFiles(sessionID)
}

// LoadTrace interpreta un file trace del progetto in una timeline per il viewer.
func (g *GoIDE) LoadTrace(sessionID, relativePath string) (goide.TraceReport, error) {
	return g.service.LoadTrace(sessionID, relativePath)
}

// ListFuzzTargets elenca le funzioni Fuzz* con il corpus in testdata/fuzz e nella cache di Go.
func (g *GoIDE) ListFuzzTargets(sessionID string) ([]goide.FuzzTarget, error) {
	return g.service.ListFuzzTargets(sessionID)
}

// ReadFuzzInput interpreta un input del corpus fuzz.
func (g *GoIDE) ReadFuzzInput(sessionID, packageDir, target, source, name string) (goide.FuzzInputContent, error) {
	return g.service.ReadFuzzInput(sessionID, packageDir, target, source, name)
}

// PromoteFuzzInput copia un input generato in testdata/fuzz, dove ogni go test lo riesegue.
func (g *GoIDE) PromoteFuzzInput(sessionID, packageDir, target, name string) (string, error) {
	return g.service.PromoteFuzzInput(sessionID, packageDir, target, name)
}

// DeleteFuzzInput cancella un input dal corpus del progetto o dalla cache di Go.
func (g *GoIDE) DeleteFuzzInput(sessionID, packageDir, target, source, name string) error {
	return g.service.DeleteFuzzInput(sessionID, packageDir, target, source, name)
}

// DetectSonarScanner cerca sonar-scanner per la sessione.
func (g *GoIDE) DetectSonarScanner(sessionID string) (goide.SonarScannerInfo, error) {
	return g.service.DetectSonarScanner(sessionID)
}

// ConfigureSonarScanner imposta un binario sonar-scanner personalizzato; vuoto ripristina la ricerca automatica.
func (g *GoIDE) ConfigureSonarScanner(sessionID, binary string) error {
	return g.service.ConfigureSonarScanner(sessionID, binary)
}

// SonarConfigFor restituisce la configurazione SonarQube (senza token) della sessione.
func (g *GoIDE) SonarConfigFor(sessionID string) (goide.SonarConfig, error) {
	return g.service.SonarConfigFor(sessionID)
}

// SaveSonarConfig salva server, chiave e percorsi; il token è separato e resta in memoria.
func (g *GoIDE) SaveSonarConfig(sessionID string, config goide.SonarConfig) (goide.SonarConfig, error) {
	return g.service.SaveSonarConfig(sessionID, config)
}

// SetSonarToken memorizza il token SonarQube in memoria per la sessione (mai persistito).
func (g *GoIDE) SetSonarToken(sessionID, token string) error {
	return g.service.SetSonarToken(sessionID, token)
}

// RunSonarScan esegue sonar-scanner e importa gli issue dalla Web API.
func (g *GoIDE) RunSonarScan(ctx context.Context, sessionID, token string) (goide.SonarScanResult, error) {
	return g.service.RunSonarScan(ctx, sessionID, token)
}

// FetchSonarIssues importa gli issue già presenti sul server, senza rieseguire la scansione.
func (g *GoIDE) FetchSonarIssues(ctx context.Context, sessionID, token string) (goide.SonarScanResult, error) {
	return g.service.FetchSonarIssues(ctx, sessionID, token)
}

// SaveSonarBaseline registra gli issue attuali come accettati.
func (g *GoIDE) SaveSonarBaseline(ctx context.Context, sessionID, token string) (int, error) {
	return g.service.SaveSonarBaseline(ctx, sessionID, token)
}

// ClearSonarBaseline rimuove la baseline SonarQube.
func (g *GoIDE) ClearSonarBaseline(sessionID string) error {
	return g.service.ClearSonarBaseline(sessionID)
}

// DetectDelve individua dlv e ne legge la versione.
func (g *GoIDE) DetectDelve(sessionID string) (goide.DelveInfo, error) {
	return g.service.DetectDelve(sessionID)
}

// ConfigureDelve imposta un binario dlv personalizzato; vuoto ripristina la ricerca automatica.
func (g *GoIDE) ConfigureDelve(sessionID, binary string) error {
	return g.service.ConfigureDelve(sessionID, binary)
}

// DetectMake indica quale make userebbe la sessione per i Makefile del progetto.
func (g *GoIDE) DetectMake(sessionID string) (goide.MakeInfo, error) {
	return g.service.DetectMake(sessionID)
}

// ConfigureMake imposta un binario make personalizzato; vuoto ripristina la ricerca automatica.
func (g *GoIDE) ConfigureMake(sessionID, binary string) error {
	return g.service.ConfigureMake(sessionID, binary)
}

// InstallDelve installa dlv nella cartella strumenti di adOmnia dopo conferma esplicita.
func (g *GoIDE) InstallDelve(sessionID string, confirmed bool) (goide.Execution, error) {
	return g.service.InstallDelve(sessionID, confirmed)
}

// StartDebug avvia una sessione Delve per un programma o un singolo test.
func (g *GoIDE) StartDebug(request goide.DebugRequest) (goide.DebugSessionInfo, error) {
	return g.service.StartDebug(request)
}

// StopDebug termina la sessione di debug e il processo debuggato.
func (g *GoIDE) StopDebug(debugID string) error {
	return g.service.StopDebug(debugID)
}

// DebugStep esegue continue, pause, next, stepIn o stepOut.
func (g *GoIDE) DebugStep(debugID, action string, threadID int) error {
	return g.service.DebugStep(debugID, action, threadID)
}

// DebugThreads elenca le goroutine della sessione di debug.
func (g *GoIDE) DebugThreads(debugID string) ([]goide.DebugThread, error) {
	return g.service.DebugThreads(debugID)
}

// DebugStackTrace restituisce i frame di una goroutine.
func (g *GoIDE) DebugStackTrace(debugID string, threadID int) ([]goide.DebugFrame, error) {
	return g.service.DebugStackTrace(debugID, threadID)
}

// DebugGoroutines restituisce le goroutine della pausa corrente per la vista Concurrency.
func (g *GoIDE) DebugGoroutines(debugID string) (goide.GoroutineOverview, error) {
	return g.service.DebugGoroutines(debugID)
}

// DebugScopes restituisce gli scope di un frame.
func (g *GoIDE) DebugScopes(debugID string, frameID int) ([]goide.DebugScope, error) {
	return g.service.DebugScopes(debugID, frameID)
}

// DebugReadMemory legge la memoria da un indirizzo o dall'indirizzo di un'espressione nel frame.
func (g *GoIDE) DebugReadMemory(debugID, location string, length, frameID int) (goide.DebugMemory, error) {
	return g.service.DebugReadMemory(debugID, location, length, frameID)
}

// DebugShowRegisters mostra o nasconde lo scope Registers nelle variabili dei frame.
func (g *GoIDE) DebugShowRegisters(debugID string, show bool) error {
	return g.service.DebugShowRegisters(debugID, show)
}

// DebugDisassemble restituisce il codice macchina attorno all'istruzione corrente di un frame.
func (g *GoIDE) DebugDisassemble(debugID, address string, before, after int) ([]goide.DebugInstruction, error) {
	return g.service.DebugDisassemble(debugID, address, before, after)
}

// DebugVariables espande un riferimento a variabili.
func (g *GoIDE) DebugVariables(debugID string, reference int) ([]goide.DebugVariable, error) {
	return g.service.DebugVariables(debugID, reference)
}

// DebugEvaluate valuta un'espressione nel frame indicato.
func (g *GoIDE) DebugEvaluate(debugID, expression string, frameID int, context string) (goide.EvaluateResult, error) {
	return g.service.DebugEvaluate(debugID, expression, frameID, context)
}

// ListDebugSessions elenca le sessioni di debug del progetto.
func (g *GoIDE) ListDebugSessions(sessionID string) ([]goide.DebugSessionInfo, error) {
	return g.service.ListDebugSessions(sessionID)
}

// SetBreakpoints sostituisce i breakpoint di un file (con condizione, hit count o logpoint) e li applica alle sessioni attive.
func (g *GoIDE) SetBreakpoints(sessionID, relativePath string, breakpoints []goide.Breakpoint) ([]goide.BreakpointState, error) {
	return g.service.SetBreakpoints(sessionID, relativePath, breakpoints)
}

// ListFunctionBreakpoints restituisce i breakpoint di funzione e il panic breakpoint del progetto.
func (g *GoIDE) ListFunctionBreakpoints(sessionID string) (goide.FunctionBreakpointsView, error) {
	return g.service.ListFunctionBreakpoints(sessionID)
}

// SetFunctionBreakpoints sostituisce i breakpoint di funzione e il panic breakpoint del progetto.
func (g *GoIDE) SetFunctionBreakpoints(sessionID string, settings goide.FunctionBreakpointSettings) (goide.FunctionBreakpointsView, error) {
	return g.service.SetFunctionBreakpoints(sessionID, settings)
}

// DebugRunToCursor riprende il programma in pausa fino alla riga indicata.
func (g *GoIDE) DebugRunToCursor(debugID, relativePath string, line, threadID int) error {
	return g.service.DebugRunToCursor(debugID, relativePath, line, threadID)
}

// ListBreakpoints restituisce i breakpoint salvati della sessione.
func (g *GoIDE) ListBreakpoints(sessionID string) ([]goide.FileBreakpoints, error) {
	return g.service.ListBreakpoints(sessionID)
}

// CreateFiles crea file nuovi nel progetto, tutti o nessuno.
func (g *GoIDE) CreateFiles(sessionID string, files []goide.NewFile) error {
	return g.service.CreateFiles(sessionID, files)
}

// CreateDirectory crea una cartella nel progetto.
func (g *GoIDE) CreateDirectory(sessionID, relativePath string) error {
	return g.service.CreateDirectory(sessionID, relativePath)
}

// MovePath rinomina o sposta un file o una cartella del progetto, senza sovrascrivere.
func (g *GoIDE) MovePath(sessionID, from, to string) error {
	return g.service.MovePath(sessionID, from, to)
}

// DuplicatePath copia un file o una cartella del progetto in un nuovo percorso.
func (g *GoIDE) DuplicatePath(sessionID, from, to string) error {
	return g.service.DuplicatePath(sessionID, from, to)
}

// RevealPath mostra un elemento del progetto nel file manager del sistema.
func (g *GoIDE) RevealPath(sessionID, relativePath string) error {
	return g.service.RevealPath(sessionID, relativePath)
}

// DeletePath elimina un file o una cartella del progetto dopo la conferma nella UI.
func (g *GoIDE) DeletePath(sessionID, relativePath string) error {
	return g.service.DeletePath(sessionID, relativePath)
}

// ImplementationMarkers restituisce i marcatori del gutter per implementazioni e interfacce implementate.
func (g *GoIDE) ImplementationMarkers(ctx context.Context, sessionID, documentID string) ([]goide.ImplementationMarker, error) {
	markers, err := g.service.ImplementationMarkers(ctx, sessionID, documentID)
	return settleCancelled(ctx, markers, err)
}

// PreviewGoTool mostra il comando Go Tools esatto prima dell'esecuzione.
func (g *GoIDE) PreviewGoTool(request goide.GoToolRequest) (goide.GoToolPreview, error) {
	return g.service.PreviewGoTool(request)
}

// StartGoTool esegue un comando Go Tools nella Run console.
func (g *GoIDE) StartGoTool(request goide.GoToolRequest) (goide.Execution, error) {
	return g.service.StartGoTool(request)
}

// ListProcesses elenca i processi locali per Attach to Process.
func (g *GoIDE) ListProcesses() ([]goide.ProcessInfo, error) {
	return g.service.ListProcesses()
}

// ListLocalHistory elenca le versioni salvate di un file.
func (g *GoIDE) ListLocalHistory(sessionID, relativePath string) ([]goide.HistoryRevision, error) {
	return g.service.ListLocalHistory(sessionID, relativePath)
}

// LocalHistoryContent restituisce il testo di una versione della local history.
func (g *GoIDE) LocalHistoryContent(sessionID, relativePath, revisionID string) (string, error) {
	return g.service.LocalHistoryContent(sessionID, relativePath, revisionID)
}

// WatcherStatus indica se il progetto è osservato per intero o solo in parte.
func (g *GoIDE) WatcherStatus(sessionID string) (goide.WatcherStatus, error) {
	return g.service.WatcherStatus(sessionID)
}

// VCSStatus legge branch e modifiche del repository Git del progetto, senza operazioni di rete.
func (g *GoIDE) VCSStatus(sessionID string) (goide.VCSStatus, error) {
	return g.service.VCSStatus(sessionID)
}

// VCSFileAtRevision restituisce il file a una revisione (HEAD per il gutter diff).
func (g *GoIDE) VCSFileAtRevision(sessionID, relativePath, revision string) (string, error) {
	return g.service.VCSFileAtRevision(sessionID, relativePath, revision)
}

// VCSFileHistory elenca i commit che hanno toccato il file.
func (g *GoIDE) VCSFileHistory(sessionID, relativePath string) ([]goide.VCSCommit, error) {
	return g.service.VCSFileHistory(sessionID, relativePath)
}

// AffectedTestPackages aggiunge ai package indicati quelli del modulo che li importano (anche nei test).
func (g *GoIDE) AffectedTestPackages(sessionID, moduleDirectory string, packages []string) ([]string, error) {
	return g.service.AffectedTestPackages(sessionID, moduleDirectory, packages)
}

// VCSChangedSymbols elenca le dichiarazioni Go aggiunte, modificate o rimosse rispetto a HEAD.
func (g *GoIDE) VCSChangedSymbols(sessionID string) ([]goide.VCSChangedSymbol, error) {
	return g.service.VCSChangedSymbols(sessionID)
}

// VCSPatchLines restituisce le righe Go aggiunte o modificate dal merge-base con base.
func (g *GoIDE) VCSPatchLines(sessionID, base string) (map[string][]git.LineRange, error) {
	return g.service.VCSPatchLines(sessionID, base)
}

// VCSLineHistory elenca i commit che hanno modificato le righe start..end del file.
func (g *GoIDE) VCSLineHistory(sessionID, relativePath string, start, end int) ([]goide.VCSCommit, error) {
	return g.service.VCSLineHistory(sessionID, relativePath, start, end)
}

// VCSBlame restituisce autore e commit di ogni riga del file.
func (g *GoIDE) VCSBlame(sessionID, relativePath string) ([]goide.VCSBlameLine, error) {
	return g.service.VCSBlame(sessionID, relativePath)
}

// VCSCommitFiles registra solo i file indicati.
func (g *GoIDE) VCSCommitFiles(sessionID, message string, relativePaths []string) (git.CommitResult, error) {
	return g.service.VCSCommitFiles(sessionID, message, relativePaths)
}

// VCSCheckout passa a un branch locale esistente.
func (g *GoIDE) VCSCheckout(sessionID, branch string) error {
	return g.service.VCSCheckout(sessionID, branch)
}

// StartRun avvia una build, run o tidy con argomenti strutturati.
func (g *GoIDE) StartRun(request goide.RunRequest) (goide.Execution, error) {
	return g.service.StartRun(request)
}

// StopRun arresta in modo idempotente l'esecuzione indicata.
func (g *GoIDE) StopRun(runID string) error {
	return g.service.StopRun(runID)
}

// RestartRun riavvia la configurazione associata a un'esecuzione.
func (g *GoIDE) RestartRun(runID string) (goide.Execution, error) {
	return g.service.RestartRun(runID)
}

// WriteRunInput invia input alla console dell'esecuzione indicata.
func (g *GoIDE) WriteRunInput(runID, text string) error {
	return g.service.WriteRunInput(runID, text)
}

// ListRuns restituisce le esecuzioni note per una sessione.
func (g *GoIDE) ListRuns(sessionID string) ([]goide.Execution, error) {
	return g.service.ListRuns(sessionID)
}

// HasActiveRuns indica se la sessione possiede processi attivi.
func (g *GoIDE) HasActiveRuns(sessionID string) bool {
	return g.service.HasActiveRuns(sessionID)
}

// DetectGopls individua gopls e ne legge la versione.
func (g *GoIDE) DetectGopls(sessionID string) (goide.GoplsInfo, error) {
	return g.service.DetectGopls(sessionID)
}

// ConfigureGopls imposta un binario gopls personalizzato; vuoto ripristina la ricerca automatica.
func (g *GoIDE) ConfigureGopls(sessionID, binary string) error {
	return g.service.ConfigureGopls(sessionID, binary)
}

// InstallGopls installa gopls nella cartella strumenti di adOmnia dopo conferma esplicita.
func (g *GoIDE) InstallGopls(sessionID string, confirmed bool) (goide.Execution, error) {
	return g.service.InstallGopls(sessionID, confirmed)
}

// StartLanguageServer avvia gopls per un progetto autorizzato.
func (g *GoIDE) StartLanguageServer(sessionID string, settings goide.LanguageServerSettings) (goide.LanguageServerStatus, error) {
	return g.service.StartLanguageServer(sessionID, settings)
}

// RestartLanguageServer riavvia gopls azzerando il contatore dei crash.
func (g *GoIDE) RestartLanguageServer(sessionID string, settings goide.LanguageServerSettings) (goide.LanguageServerStatus, error) {
	return g.service.RestartLanguageServer(sessionID, settings)
}

// StopLanguageServer arresta gopls della sessione.
func (g *GoIDE) StopLanguageServer(sessionID string) error {
	return g.service.StopLanguageServer(sessionID)
}

// GetLanguageServerStatus restituisce lo stato di gopls per la sessione.
func (g *GoIDE) GetLanguageServerStatus(sessionID string) (goide.LanguageServerStatus, error) {
	return g.service.LanguageServerStatus(sessionID)
}

// GetLanguageServerLog restituisce le ultime righe di log gopls.
func (g *GoIDE) GetLanguageServerLog(sessionID string) ([]string, error) {
	return g.service.LanguageServerLog(sessionID)
}

// UpdateDocumentBuffer sincronizza il buffer non salvato con gopls.
func (g *GoIDE) UpdateDocumentBuffer(sessionID, documentID string, version int, text string) error {
	return g.service.UpdateDocumentBuffer(sessionID, documentID, version, text)
}

// OpenExternalDocument apre in sola lettura un sorgente dell'SDK Go o della module cache.
func (g *GoIDE) OpenExternalDocument(sessionID, path string) (goide.OpenDocument, error) {
	return g.service.OpenExternalDocument(sessionID, path)
}

// Completion restituisce i suggerimenti gopls; la richiesta si annulla con la promise frontend.
func (g *GoIDE) Completion(ctx context.Context, sessionID, documentID string, line, column int) (goide.CompletionResult, error) {
	value, err := g.service.Completion(ctx, sessionID, documentID, line, column)
	return settleCancelled(ctx, value, err)
}

// SemanticTokens restituisce i token semantici del buffer, da decodificare con la legenda di gopls.
func (g *GoIDE) SemanticTokens(ctx context.Context, sessionID, documentID string) (goide.SemanticTokensResult, error) {
	value, err := g.service.SemanticTokens(ctx, sessionID, documentID)
	return settleCancelled(ctx, value, err)
}

// InlayHints restituisce i suggerimenti in linea per l'intervallo visibile.
func (g *GoIDE) InlayHints(ctx context.Context, sessionID, documentID string, visible goide.EditorRange) (goide.InlayHintsResult, error) {
	value, err := g.service.InlayHints(ctx, sessionID, documentID, visible)
	return settleCancelled(ctx, value, err)
}

// DocumentHighlights evidenzia occorrenze e punti di uscita al cursore.
func (g *GoIDE) DocumentHighlights(ctx context.Context, sessionID, documentID string, line, column int) (goide.HighlightsResult, error) {
	value, err := g.service.DocumentHighlights(ctx, sessionID, documentID, line, column)
	return settleCancelled(ctx, value, err)
}

// GoWorkState legge go.work e i moduli rilevati del progetto.
func (g *GoIDE) GoWorkState(sessionID string) (goide.GoWorkState, error) {
	return g.service.GoWorkState(sessionID)
}

// UpdateGoWork porta go.work all'insieme di moduli indicato con i comandi go work ufficiali.
func (g *GoIDE) UpdateGoWork(sessionID string, directories []string) (goide.GoWorkState, error) {
	return g.service.UpdateGoWork(sessionID, directories)
}

// CloneRepository clona un repository Git in parent/<nome> e restituisce la cartella, da aprire come progetto.
func (g *GoIDE) CloneRepository(remoteURL, parent string) (string, error) {
	destination, err := goide.CloneDestination(parent, remoteURL)
	if err != nil {
		return "", err
	}
	if err := git.Clone(remoteURL, destination); err != nil {
		return "", err
	}
	return destination, nil
}

// GenerateGoCode genera costruttore, getter/setter, interfaccia, benchmark o fuzz test sul testo indicato.
func (g *GoIDE) GenerateGoCode(request goide.CodeGenRequest) (goide.CodeGenResult, error) {
	return goide.GenerateGoCode(request)
}

// PrepareHierarchy apre Call Hierarchy o Type Hierarchy sul simbolo al cursore.
func (g *GoIDE) PrepareHierarchy(ctx context.Context, sessionID, documentID, kind string, line, column int) ([]goide.HierarchyItem, error) {
	return g.service.PrepareHierarchy(ctx, sessionID, documentID, kind, line, column)
}

// ExpandHierarchy carica i figli di un nodo della gerarchia.
func (g *GoIDE) ExpandHierarchy(ctx context.Context, sessionID, direction, token string) ([]goide.HierarchyItem, error) {
	return g.service.ExpandHierarchy(ctx, sessionID, direction, token)
}

// RecursiveCalls restituisce le chiamate ricorsive dirette del file.
func (g *GoIDE) RecursiveCalls(ctx context.Context, sessionID, documentID string) (goide.RecursiveCallsResult, error) {
	value, err := g.service.RecursiveCalls(ctx, sessionID, documentID)
	return settleCancelled(ctx, value, err)
}

// QuickDefinition restituisce il sorgente della dichiarazione al cursore per il popup Quick Definition.
func (g *GoIDE) QuickDefinition(ctx context.Context, sessionID, documentID string, line, column int) (goide.QuickDefinitionResult, error) {
	value, err := g.service.QuickDefinition(ctx, sessionID, documentID, line, column)
	return settleCancelled(ctx, value, err)
}

// Hover restituisce la documentazione del simbolo sotto il cursore.
func (g *GoIDE) Hover(ctx context.Context, sessionID, documentID string, line, column int) (goide.HoverResult, error) {
	value, err := g.service.Hover(ctx, sessionID, documentID, line, column)
	return settleCancelled(ctx, value, err)
}

// SignatureHelp restituisce la firma della chiamata in corso.
func (g *GoIDE) SignatureHelp(ctx context.Context, sessionID, documentID string, line, column int) (goide.SignatureResult, error) {
	value, err := g.service.SignatureHelp(ctx, sessionID, documentID, line, column)
	return settleCancelled(ctx, value, err)
}

// Locations esegue definition, typeDefinition, implementation o references.
func (g *GoIDE) Locations(ctx context.Context, sessionID, documentID, kind string, line, column int) ([]goide.EditorLocation, error) {
	value, err := g.service.Locations(ctx, sessionID, documentID, kind, line, column)
	return settleCancelled(ctx, value, err)
}

// DocumentSymbols restituisce la struttura del file.
func (g *GoIDE) DocumentSymbols(ctx context.Context, sessionID, documentID string) (goide.DocumentSymbolsResult, error) {
	value, err := g.service.DocumentSymbols(ctx, sessionID, documentID)
	return settleCancelled(ctx, value, err)
}

// WorkspaceSymbols cerca simboli nel workspace.
func (g *GoIDE) WorkspaceSymbols(ctx context.Context, sessionID, query string) ([]goide.WorkspaceSymbol, error) {
	value, err := g.service.WorkspaceSymbols(ctx, sessionID, query)
	return settleCancelled(ctx, value, err)
}

// PrepareRename verifica il simbolo da rinominare.
func (g *GoIDE) PrepareRename(ctx context.Context, sessionID, documentID string, line, column int) (goide.RenameTarget, error) {
	value, err := g.service.PrepareRename(ctx, sessionID, documentID, line, column)
	return settleCancelled(ctx, value, err)
}

// Rename calcola l'anteprima del rename semantico.
func (g *GoIDE) Rename(ctx context.Context, sessionID, documentID string, line, column int, newName string) (goide.WorkspaceChange, error) {
	value, err := g.service.Rename(ctx, sessionID, documentID, line, column, newName)
	return settleCancelled(ctx, value, err)
}

// FormatDocument restituisce gli edit di formattazione del buffer.
func (g *GoIDE) FormatDocument(ctx context.Context, sessionID, documentID string) (goide.FormatResult, error) {
	value, err := g.service.FormatDocument(ctx, sessionID, documentID)
	return settleCancelled(ctx, value, err)
}

// CodeActions elenca le azioni disponibili per la selezione.
func (g *GoIDE) CodeActions(ctx context.Context, sessionID, documentID string, selection goide.EditorRange, only []string) ([]goide.CodeActionEntry, error) {
	value, err := g.service.CodeActions(ctx, sessionID, documentID, selection, only)
	return settleCancelled(ctx, value, err)
}

// ResolveCodeAction calcola l'anteprima delle modifiche dell'azione.
// ChangeSignature riordina o rimuove parametri e risultati della funzione al cursore (anteprima).
func (g *GoIDE) ChangeSignature(ctx context.Context, sessionID, documentID string, caret goide.EditorRange, params, results []int) (goide.WorkspaceChange, error) {
	value, err := g.service.ChangeSignature(ctx, sessionID, documentID, caret, params, results)
	return settleCancelled(ctx, value, err)
}

func (g *GoIDE) ResolveCodeAction(ctx context.Context, sessionID, actionID string) (goide.WorkspaceChange, error) {
	value, err := g.service.ResolveCodeAction(ctx, sessionID, actionID)
	return settleCancelled(ctx, value, err)
}

// OrganizeImports calcola la pulizia degli import del file.
func (g *GoIDE) OrganizeImports(ctx context.Context, sessionID, documentID string) (goide.WorkspaceChange, error) {
	value, err := g.service.OrganizeImports(ctx, sessionID, documentID)
	return settleCancelled(ctx, value, err)
}

// DetectLinter individua golangci-lint o staticcheck e la configurazione di progetto.
func (g *GoIDE) DetectLinter(sessionID string) (goide.LinterInfo, error) {
	return g.service.DetectLinter(sessionID)
}

// ConfigureLinter imposta un binario linter personalizzato; vuoto ripristina la ricerca automatica.
func (g *GoIDE) ConfigureLinter(sessionID, binary string) error {
	return g.service.ConfigureLinter(sessionID, binary)
}

// InstallLinter installa golangci-lint o staticcheck nella cartella strumenti dopo conferma esplicita.
func (g *GoIDE) InstallLinter(sessionID, kind string, confirmed bool) (goide.Execution, error) {
	return g.service.InstallLinter(sessionID, kind, confirmed)
}

// RunLint esegue il linter sul progetto; si annulla con la promise frontend.
func (g *GoIDE) RunLint(ctx context.Context, sessionID string) (goide.LintResult, error) {
	value, err := g.service.RunLint(ctx, sessionID)
	return settleCancelled(ctx, value, err)
}

// LinterConfigFile restituisce (o, con create, crea) il file di configurazione del linter del progetto.
func (g *GoIDE) LinterConfigFile(sessionID string, create bool) (string, error) {
	return g.service.LinterConfigFile(sessionID, create)
}

// SaveLintBaseline registra i problemi attuali del linter in .adomnia/lint-baseline.json.
func (g *GoIDE) SaveLintBaseline(ctx context.Context, sessionID string) (int, error) {
	value, err := g.service.SaveLintBaseline(ctx, sessionID)
	return settleCancelled(ctx, value, err)
}

// ClearLintBaseline rimuove la baseline del linter.
func (g *GoIDE) ClearLintBaseline(sessionID string) error {
	return g.service.ClearLintBaseline(sessionID)
}

// RunLintChanged esegue il linter solo sui file Go modificati; si annulla con la promise frontend.
func (g *GoIDE) RunLintChanged(ctx context.Context, sessionID string) (goide.LintResult, error) {
	value, err := g.service.RunLintChanged(ctx, sessionID)
	return settleCancelled(ctx, value, err)
}

// SearchProject cerca testo nel progetto; si annulla con la promise frontend.
func (g *GoIDE) SearchProject(ctx context.Context, query goide.SearchQuery) (goide.SearchResult, error) {
	value, err := g.service.SearchProject(ctx, query)
	return settleCancelled(ctx, value, err)
}

// SetDirtyDocumentCount sincronizza il solo conteggio dei buffer dirty per la chiusura sicura.
func (g *GoIDE) SetDirtyDocumentCount(count int) {
	if count < 0 {
		count = 0
	}
	g.dirtyDocumentCount.Store(int64(count))
}

// ConfirmAppClose conferma la chiusura dopo che il frontend ha salvato o scartato i buffer.
func (g *GoIDE) ConfirmAppClose() error {
	if g.mainWindow == nil {
		return fmt.Errorf("finestra principale non inizializzata")
	}
	g.allowAppClose.Store(true)
	g.mainWindow.Close()
	return nil
}

// SelectProjectFolder apre il selettore nativo senza leggere o eseguire il progetto scelto.
func (g *GoIDE) SelectProjectFolder() (string, error) {
	if g.desktop == nil {
		return "", fmt.Errorf("runtime desktop non inizializzato")
	}
	path, err := g.desktop.Dialog.OpenFile().
		CanChooseFiles(false).
		CanChooseDirectories(true).
		SetTitle("Apri progetto Go").
		PromptForSingleSelection()
	if err != nil {
		return "", err
	}
	return strings.TrimSpace(path), nil
}

// SelectFolder apre il selettore nativo di cartelle con il titolo indicato, senza leggerne il contenuto.
func (g *GoIDE) SelectFolder(title string) (string, error) {
	if g.desktop == nil {
		return "", fmt.Errorf("runtime desktop non inizializzato")
	}
	title = strings.TrimSpace(title)
	if title == "" {
		title = "Scegli una cartella"
	}
	path, err := g.desktop.Dialog.OpenFile().
		CanChooseFiles(false).
		CanChooseDirectories(true).
		SetTitle(title).
		PromptForSingleSelection()
	if err != nil {
		return "", err
	}
	return strings.TrimSpace(path), nil
}

// SelectProjectParent apre il selettore nativo per la cartella che conterrà un nuovo progetto.
func (g *GoIDE) SelectProjectParent() (string, error) {
	if g.desktop == nil {
		return "", fmt.Errorf("runtime desktop non inizializzato")
	}
	path, err := g.desktop.Dialog.OpenFile().
		CanChooseFiles(false).
		CanChooseDirectories(true).
		SetTitle("Scegli cartella per il nuovo progetto Go").
		PromptForSingleSelection()
	if err != nil {
		return "", err
	}
	return strings.TrimSpace(path), nil
}

// settleCancelled trasforma in successo vuoto una chiamata annullata dal frontend: il runtime Wails
// scarta il risultato, mentre un errore arrivato dopo la cancellazione diventerebbe una rejection non gestita.
func settleCancelled[T any](ctx context.Context, value T, err error) (T, error) {
	if err != nil && ctx.Err() != nil {
		var zero T
		return zero, nil
	}
	return value, err
}

// ListRunConfigurations elenca le configurazioni Run salvate della sessione.
func (g *GoIDE) ListRunConfigurations(sessionID string) ([]goide.RunConfiguration, error) {
	return g.service.ListRunConfigurations(sessionID)
}

// SaveRunConfiguration crea o aggiorna una configurazione Run validata.
func (g *GoIDE) SaveRunConfiguration(sessionID string, config goide.RunConfiguration) (goide.RunConfiguration, error) {
	return g.service.SaveRunConfiguration(sessionID, config)
}

// DuplicateRunConfiguration copia una configurazione esistente.
func (g *GoIDE) DuplicateRunConfiguration(sessionID, configID string) (goide.RunConfiguration, error) {
	return g.service.DuplicateRunConfiguration(sessionID, configID)
}

// RenameRunConfiguration rinomina una configurazione esistente.
func (g *GoIDE) RenameRunConfiguration(sessionID, configID, name string) (goide.RunConfiguration, error) {
	return g.service.RenameRunConfiguration(sessionID, configID, name)
}

// ReorderRunConfigurations applica l'ordine scelto dall'utente.
func (g *GoIDE) ReorderRunConfigurations(sessionID string, configIDs []string) ([]goide.RunConfiguration, error) {
	return g.service.ReorderRunConfigurations(sessionID, configIDs)
}

// DeleteRunConfiguration elimina una configurazione salvata.
func (g *GoIDE) DeleteRunConfiguration(sessionID, configID string) error {
	return g.service.DeleteRunConfiguration(sessionID, configID)
}

// StartConfiguredRun avvia una configurazione salvata con i soli segreti forniti a runtime.
func (g *GoIDE) StartConfiguredRun(sessionID, configID string, secrets map[string]string) (goide.Execution, error) {
	return g.service.StartConfiguredRun(sessionID, configID, secrets)
}

// ListTerminalProfiles rileva le shell disponibili (PowerShell, cmd, Git Bash, distro WSL, zsh…).
func (g *GoIDE) ListTerminalProfiles() []goide.TerminalProfile {
	return goide.ListTerminalProfiles()
}

// OpenTerminal apre una shell interattiva reale nella working directory del progetto.
func (g *GoIDE) OpenTerminal(request goide.TerminalRequest) (goide.TerminalSession, error) {
	return g.service.OpenTerminal(request)
}

// WriteTerminal inoltra l'input dell'utente alla shell indicata.
func (g *GoIDE) WriteTerminal(terminalID, data string) error {
	return g.service.WriteTerminal(terminalID, data)
}

// ResizeTerminal adegua il PTY alle dimensioni correnti del pannello.
func (g *GoIDE) ResizeTerminal(terminalID string, columns, rows int) error {
	return g.service.ResizeTerminal(terminalID, columns, rows)
}

// RenameTerminal cambia il nome mostrato nel tab del terminale.
func (g *GoIDE) RenameTerminal(terminalID, name string) (goide.TerminalSession, error) {
	return g.service.RenameTerminal(terminalID, name)
}

// CloseTerminal termina shell e albero di processi del terminale.
func (g *GoIDE) CloseTerminal(terminalID string) error {
	return g.service.CloseTerminal(terminalID)
}

// ListTerminals elenca i terminali della sola sessione indicata.
func (g *GoIDE) ListTerminals(sessionID string) ([]goide.TerminalSession, error) {
	return g.service.ListTerminals(sessionID)
}

// HasActiveTerminals indica se la sessione possiede shell ancora vive.
func (g *GoIDE) HasActiveTerminals(sessionID string) bool {
	return g.service.HasActiveTerminals(sessionID)
}

// GetSessionView restituisce layout e tab ripristinabili della sessione.
func (g *GoIDE) GetSessionView(sessionID string) (goide.SessionView, error) {
	return g.service.GetSessionView(sessionID)
}

// SaveSessionView registra layout e tab della sessione, senza contenuti dei file.
func (g *GoIDE) SaveSessionView(sessionID string, view goide.SessionView) error {
	return g.service.SaveSessionView(sessionID, view)
}

// RememberBuffer conserva un buffer non salvato nello store di recupero locale.
func (g *GoIDE) RememberBuffer(sessionID, relativePath, content, diskToken string) error {
	return g.service.RememberBuffer(sessionID, relativePath, content, diskToken)
}

// ForgetBuffer scarta un buffer dallo store di recupero.
func (g *GoIDE) ForgetBuffer(sessionID, relativePath string) error {
	return g.service.ForgetBuffer(sessionID, relativePath)
}

// ListRecoveredBuffers elenca i buffer non salvati ritrovati dopo un riavvio.
func (g *GoIDE) ListRecoveredBuffers(sessionID string) ([]goide.RecoveredBuffer, error) {
	return g.service.ListRecoveredBuffers(sessionID)
}

// PruneMissingSessions rimuove le sessioni la cui cartella non esiste più.
func (g *GoIDE) PruneMissingSessions() ([]goide.Session, error) {
	return g.service.PruneMissingSessions()
}

// FindSessionsForPath elenca le altre sessioni che contengono lo stesso file.
func (g *GoIDE) FindSessionsForPath(sessionID, relativePath string) ([]goide.Session, error) {
	return g.service.FindSessionsForPath(sessionID, relativePath)
}

// ServiceShutdown rilascia processi e risorse posseduti dal servizio.
func (g *GoIDE) ServiceShutdown() error {
	g.service.Shutdown()
	// Chiusura pulita: il prossimo avvio non proporrà il ripristino dopo crash.
	g.runtimeLock.Release()
	return nil
}

// CrashRecoveryStatus dice se l'avvio precedente si è chiuso in modo anomalo (heartbeat fermo).
func (g *GoIDE) CrashRecoveryStatus() goide.CrashStatus {
	return g.service.CrashRecoveryStatus()
}

// DetectGoTool cerca un tool Go (govulncheck, goimports, mockgen, stringer o personalizzato).
func (g *GoIDE) DetectGoTool(sessionID, binary string) (goide.GoToolInfo, error) {
	return g.service.DetectGoTool(sessionID, binary)
}

// InstallGoModule esegue go install di un modulo@versione nella cartella strumenti, dopo conferma.
func (g *GoIDE) InstallGoModule(sessionID, module string, confirmed bool) (goide.Execution, error) {
	return g.service.InstallGoModule(sessionID, module, confirmed)
}

// RunGoTool esegue un tool Go rilevato con argomenti strutturati nella cartella indicata.
func (g *GoIDE) RunGoTool(sessionID, binary string, arguments []string, workingDirectory string) (goide.Execution, error) {
	return g.service.RunGoTool(sessionID, binary, arguments, workingDirectory)
}

// InterruptedProcesses elenca le esecuzioni interrotte dal crash dell'avvio precedente.
func (g *GoIDE) InterruptedProcesses() []goide.ProcessDescriptor {
	return g.service.InterruptedProcesses()
}

// DismissInterruptedProcess chiude la proposta di rilancio di un'esecuzione interrotta.
func (g *GoIDE) DismissInterruptedProcess(runID string) {
	g.service.DismissInterruptedProcess(runID)
}

// AcknowledgeCrash chiude la proposta di ripristino dopo la scelta dell'utente.
func (g *GoIDE) AcknowledgeCrash() {
	g.service.AcknowledgeCrash()
}

// ListStudioWorkspaces elenca i workspace Go Studio, separati dai workspace API di adOmnia.
func (g *GoIDE) ListStudioWorkspaces() (goide.StudioWorkspaces, error) {
	return g.service.ListStudioWorkspaces()
}

// CreateStudioWorkspace crea un workspace Go Studio vuoto e lo rende attivo.
func (g *GoIDE) CreateStudioWorkspace(name string) (goide.StudioWorkspaces, error) {
	return g.service.CreateStudioWorkspace(name)
}

// RenameStudioWorkspace rinomina un workspace Go Studio.
func (g *GoIDE) RenameStudioWorkspace(id, name string) (goide.StudioWorkspaces, error) {
	return g.service.RenameStudioWorkspace(id, name)
}

// DeleteStudioWorkspace elimina un workspace Go Studio senza progetti aperti.
func (g *GoIDE) DeleteStudioWorkspace(id string) (goide.StudioWorkspaces, error) {
	return g.service.DeleteStudioWorkspace(id)
}

// SetActiveStudioWorkspace cambia il workspace Go Studio mostrato.
func (g *GoIDE) SetActiveStudioWorkspace(id string) (goide.StudioWorkspaces, error) {
	return g.service.SetActiveStudioWorkspace(id)
}

// AnalyzeErrorHandling analizza la gestione degli errori del progetto (richiede un progetto autorizzato).
func (g *GoIDE) AnalyzeErrorHandling(sessionID string) (goide.ErrorHandlingReport, error) {
	return g.service.AnalyzeErrorHandling(sessionID)
}

// AnalyzeArchitecture costruisce package graph, call graph, moduli, interfacce ed entry point (progetto autorizzato).
func (g *GoIDE) AnalyzeArchitecture(sessionID string) (goide.ArchitectureResult, error) {
	return g.service.AnalyzeArchitecture(sessionID)
}

// Documentation legge la documentazione dei package Go e dei file .proto del progetto (solo parsing).
func (g *GoIDE) Documentation(sessionID string) (goide.DocumentationReport, error) {
	return g.service.Documentation(sessionID)
}
