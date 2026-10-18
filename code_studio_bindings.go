package main

import (
	"adomnia/internal/activity"
	"adomnia/internal/copilot"
	"adomnia/internal/git"
	"adomnia/internal/codestudio"
	"adomnia/internal/codestudiowindow"
	"adomnia/internal/ide/agentreview"
	"adomnia/internal/ide/apicontract"
	"adomnia/internal/ide/graph"
	"adomnia/internal/ide/run"
	"adomnia/internal/languages/golang"
	"adomnia/internal/languages/java"
	"adomnia/internal/plugins"
	"adomnia/internal/resources"
	"context"
	"fmt"
	"log"
	"path/filepath"
	"strings"
	"sync/atomic"

	"adomnia/internal/windowchrome"
	"github.com/wailsapp/wails/v3/pkg/application"
	"github.com/wailsapp/wails/v3/pkg/events"
)

type GoIDE struct {
	service            *codestudio.Service
	desktop            *application.App
	mainWindow         *application.WebviewWindow
	dirtyDocumentCount atomic.Int64
	allowAppClose      atomic.Bool
	// windows possiede le finestre Code Studio separate (una per progetto).
	windows *codestudiowindow.Manager
	// previewWindows possiede le finestre native delle Live Preview.
	previewWindows *codestudiowindow.PreviewWindows
	// serviceListeners ricevono gli eventi gO lato backend (es. DevContext).
	serviceListeners []func(codestudio.EventEnvelope)
	// runtimeLock segnala ai prossimi avvii se questo si è chiuso in modo anomalo.
	runtimeLock *codestudio.RuntimeLock
	// agentReview raccoglie i file cambiati dagli agenti ACP (milk, Claude Code) per la revisione.
	agentReview *agentreview.Tracker
}

func NewGoIDE() *GoIDE {
	var binding *GoIDE
	service := codestudio.NewService(codestudio.StateBoltStore, func(event codestudio.EventEnvelope) {
		if binding != nil && binding.desktop != nil {
			binding.desktop.Event.Emit("code-studio:event", event)
		}
		forwardGoIDEPluginEvent(event)
		if binding != nil {
			for _, listener := range binding.serviceListeners {
				listener(event)
			}
		}
	})
	service.SetActivityManager(activity.Default)
	budget, budgetErr := resources.DefaultMemoryBudget()
	if budgetErr != nil {
		log.Printf("[resources] %v; using 1536 MiB target", budgetErr)
		budget = 1536 * resources.MiB
	}
	service.EnableMemoryBudget(budget)
	_ = service.ConfigureToolchainStorage(filepath.Join(dataDir(), "goide", "toolchains"))
	service.ConfigureGraphStore(filepath.Join(dataDir(), "goide", "graphs"))
	_ = service.ConfigureRecoveryStore(codestudio.RecoveryBoltStore)
	_ = service.ConfigureHistoryStore(codestudio.HistoryBoltStore)
	_ = service.ConfigureSupervisorStore(codestudio.SupervisorBoltStore)
	binding = &GoIDE{service: service, agentReview: agentreview.NewTracker()}
	// Prima del runtime lock: lo sweep dei figli orfani deve poter leggere il
	// lock dell'istanza precedente per capire se qualcuno li possiede ancora.
	if orphaned := codestudio.SweepOrphanChildren(filepath.Join(dataDir(), "goide")); len(orphaned) > 0 {
		log.Printf("[goide] orphaned child processes terminated at startup: %v", orphaned)
	}
	if lock, status, err := codestudio.AcquireRuntimeLock(filepath.Join(dataDir(), "goide"), nil); err == nil {
		binding.runtimeLock = lock
		service.SetCrashStatus(status)
	}
	return binding
}

func init() {
	plugins.RegisterHookEvents(codestudio.PluginEvents...)
}

// forwardGoIDEPluginEvent consegna ai plugin, in modo asincrono e in sola lettura, gli eventi del contratto Code Studio.
func forwardGoIDEPluginEvent(event codestudio.EventEnvelope) {
	if globalPluginManager == nil {
		return
	}
	if eventType, payload, ok := codestudio.PluginEventFor(event); ok {
		globalPluginManager.FireEvent(PluginEvent{Type: eventType, Payload: payload})
	}
}

// ProjectServices elenca i servizi esterni (database, broker, osservabilità) usati dal progetto.
func (g *GoIDE) ProjectServices(sessionID string) ([]codestudio.ProjectService, error) {
	return g.service.ProjectServices(sessionID)
}

func (g *GoIDE) attachDesktop(desktop *application.App) {
	g.desktop = desktop
	g.agentReview.SetEmitter(func(event string, payload any) { desktop.Event.Emit(event, payload) })
	g.windows = codestudiowindow.New(desktop, windowchrome.IsApp(startupWindowChrome), func(windowID string) {
		g.service.ReleaseWindow(windowID)
	})
	g.attachPreviewWindows()
}

func (g *GoIDE) attachMainWindow(window *application.WebviewWindow) {
	g.mainWindow = window
	window.RegisterHook(events.Common.WindowClosing, func(event *application.WindowEvent) {
		if !g.allowAppClose.Swap(false) && g.cancelMainClose(event) {
			return
		}
		// La finestra principale si chiude davvero: le finestre Code Studio, già
		// verificate senza buffer non salvati, si chiudono con lei.
		if g.windows != nil {
			g.windows.CloseAll()
		}
		g.previewWindows.CloseAll()
	})
}

// onServiceEvent lets other backend services react to gO events (saves,
// closed sessions). Register listeners before the app starts.
func (g *GoIDE) onServiceEvent(listener func(codestudio.EventEnvelope)) {
	g.serviceListeners = append(g.serviceListeners, listener)
}

// sessionRoot resolves the project folder of an open gO session.
func (g *GoIDE) sessionRoot(sessionID string) (string, error) {
	return g.service.SessionRoot(sessionID)
}

// WorkspaceModuleGraph restituisce le dipendenze tra i moduli del progetto, lette dai go.mod.
func (g *GoIDE) WorkspaceModuleGraph(sessionID string) ([]codestudio.WorkspaceModule, error) {
	return g.service.WorkspaceModuleGraph(sessionID)
}

// PrivateRepoCredentialStatus dice se il gestore credenziali di Git conosce l'host (mai il token).
func (g *GoIDE) PrivateRepoCredentialStatus(host string) (codestudio.PrivateRepoCredential, error) {
	return g.service.PrivateRepoCredentialStatus(host)
}

// SavePrivateRepoCredential affida username e token di un host privato al gestore credenziali di Git.
func (g *GoIDE) SavePrivateRepoCredential(host, username, token string) (codestudio.PrivateRepoCredential, error) {
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
func (g *GoIDE) TestModuleRegistry(sessionID string) (codestudio.ModuleRegistryCheck, error) {
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

// AIProjectRules loads bounded root guidance through the existing project AI filter.
func (g *GoIDE) AIProjectRules(sessionID string) ([]copilot.ProjectRule, error) {
	root, err := g.sessionRoot(sessionID)
	if err != nil {
		return nil, err
	}
	return copilot.ProjectRules(root), nil
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
	return copilot.ExcludedPaths(root, relativePaths, localProvider), nil
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
			g.desktop.Event.Emit(codestudiowindow.CloseRequestedEvent, map[string]any{"windowId": windowID, "dirtyDocumentCount": dirty})
			return true
		}
	}
	dirtyCount := g.dirtyDocumentCount.Load()
	activeRuns := g.service.HasAnyActiveRuns()
	if dirtyCount == 0 && !activeRuns {
		return false
	}
	event.Cancel()
	g.desktop.Event.Emit("code-studio:close-requested", map[string]any{
		"dirtyDocumentCount": dirtyCount,
		"activeRuns":         activeRuns,
	})
	return true
}

// OpenSessionWindow sposta il progetto in una finestra Code Studio separata, o
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
	windowID, err := codestudiowindow.WindowIDFor(sessionID)
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
func (g *GoIDE) ClaimSessionWindow(sessionID, windowID string, force bool) (codestudio.SessionWindow, error) {
	return g.service.ClaimSessionWindow(sessionID, windowID, force)
}

// ListSessionWindows elenca i progetti aperti in finestre separate.
func (g *GoIDE) ListSessionWindows() []codestudio.SessionWindow {
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

// GetCapabilities restituisce soltanto le capacità Code Studio realmente disponibili.
func (g *GoIDE) GetCapabilities() codestudio.Capabilities {
	return g.service.GetCapabilities()
}

// GetRunSchema restituisce i campi che il linguaggio aggiunge a una configurazione Run del kind dato.
func (g *GoIDE) GetRunSchema(languageID, kind string) run.FieldSchema {
	return g.service.GetRunSchema(languageID, kind)
}

// GetRunSuggestions propone configurazioni Run per ogni unità di build del progetto.
func (g *GoIDE) GetRunSuggestions(sessionID string) ([]run.Suggestion, error) {
	return g.service.GetRunSuggestions(sessionID)
}

// OpenProject registra una cartella locale senza avviarne codice o strumenti.
func (g *GoIDE) OpenProject(path string) (codestudio.Session, error) {
	return g.service.OpenProject(path)
}

// CreateProject crea un modulo Go (opzionalmente da template) soltanto dopo la conferma esplicita inclusa nella richiesta.
func (g *GoIDE) CreateProject(request codestudio.CreateProjectRequest) (codestudio.CreateProjectResult, error) {
	return g.service.CreateProject(request)
}

// ListProjectTemplates restituisce i template di progetto integrati e quelli dell'utente.
func (g *GoIDE) ListProjectTemplates() (codestudio.ProjectTemplateList, error) {
	return g.service.ListProjectTemplates()
}

// ListSessions restituisce le sessioni Code Studio correnti e ripristinate.
func (g *GoIDE) ListSessions() ([]codestudio.Session, error) {
	return g.service.ListSessions()
}

// ListRecentProjects restituisce i progetti locali aperti di recente.
func (g *GoIDE) ListRecentProjects() ([]codestudio.RecentProject, error) {
	return g.service.ListRecentProjects()
}

// RemoveRecentProject rimuove una voce recente senza modificare il filesystem.
func (g *GoIDE) RemoveRecentProject(path string) error {
	return g.service.RemoveRecentProject(path)
}

// SetToolAuthorization registra il consenso esplicito all'uso degli strumenti.
func (g *GoIDE) SetToolAuthorization(id string, allowed bool) (codestudio.Session, error) {
	return g.service.SetToolAuthorization(id, allowed)
}

// CloseSession chiude una sessione senza modificare la cartella del progetto.
func (g *GoIDE) CloseSession(id string) error {
	return g.service.CloseSession(id)
}

// ListDirectory carica un singolo livello dell'albero file.
func (g *GoIDE) ListDirectory(sessionID, relativePath string, includeIgnored bool) ([]codestudio.FileEntry, error) {
	return g.service.ListDirectory(sessionID, relativePath, includeIgnored)
}

// OpenDocument apre un documento testuale o un'immagine confinato al progetto.
func (g *GoIDE) OpenDocument(sessionID, relativePath string) (codestudio.OpenDocument, error) {
	return g.service.OpenDocument(sessionID, relativePath)
}

// ReadFileDataURL legge un'immagine del progetto come data URL, per gli asset del Markdown.
func (g *GoIDE) ReadFileDataURL(sessionID, relativePath string) (string, error) {
	return g.service.ReadFileDataURL(sessionID, relativePath)
}

// SaveDocument salva atomicamente il buffer con protezione dalle modifiche esterne.
func (g *GoIDE) SaveDocument(sessionID, documentID, content, diskToken string, force bool) (codestudio.OpenDocument, error) {
	return g.service.SaveDocument(sessionID, documentID, content, diskToken, force)
}

// CheckDocument rileva cambiamenti su disco senza sovrascrivere il buffer.
func (g *GoIDE) CheckDocument(sessionID, documentID, diskToken string) (codestudio.DocumentDiskState, error) {
	return g.service.CheckDocument(sessionID, documentID, diskToken)
}

// CloseDocument rilascia la risorsa documento indicata.
func (g *GoIDE) CloseDocument(sessionID, documentID string) error {
	return g.service.CloseDocument(sessionID, documentID)
}

// QuickOpen cerca file del progetto con limite dei risultati.
func (g *GoIDE) QuickOpen(sessionID, query string, limit int) ([]codestudio.QuickOpenResult, error) {
	return g.service.QuickOpen(sessionID, query, limit)
}

// DetectToolchain rileva la toolchain Go su richiesta dell'utente.
func (g *GoIDE) DetectToolchain(sessionID string) (codestudio.ToolchainInfo, error) {
	return g.service.DetectToolchain(sessionID)
}

// ConfigureToolchain imposta binario e variabili della sessione dopo validazione.
func (g *GoIDE) ConfigureToolchain(sessionID string, config codestudio.ToolchainConfiguration) error {
	return g.service.ConfigureToolchain(sessionID, config)
}

// StartConfiguredBuild compila una configurazione con tutti i suoi parametri.
func (g *GoIDE) StartConfiguredBuild(sessionID, configID string) (codestudio.Execution, error) {
	return g.service.StartConfiguredBuild(sessionID, configID)
}

// ToolchainSettings restituisce la toolchain del progetto e quella globale.
func (g *GoIDE) ToolchainSettings(sessionID string) (codestudio.ToolchainSettings, error) {
	return g.service.ToolchainSettings(sessionID)
}

// ConfigureGlobalToolchain imposta la toolchain predefinita dei progetti.
func (g *GoIDE) ConfigureGlobalToolchain(config codestudio.ToolchainConfiguration) error {
	return g.service.ConfigureGlobalToolchain(config)
}

// UseGlobalToolchain riporta il progetto alla toolchain globale.
func (g *GoIDE) UseGlobalToolchain(sessionID string) error {
	return g.service.UseGlobalToolchain(sessionID)
}

// ListToolchainReleases restituisce il catalogo ufficiale compatibile su richiesta esplicita.
func (g *GoIDE) ListToolchainReleases(sessionID string) ([]codestudio.ToolchainRelease, error) {
	return g.service.ListToolchainReleases(sessionID)
}

// ListInstalledToolchains restituisce le versioni Go isolate disponibili localmente.
func (g *GoIDE) ListInstalledToolchains(sessionID string) ([]codestudio.InstalledToolchain, error) {
	return g.service.ListInstalledToolchains(sessionID)
}

// InstallToolchain avvia download, checksum ed estrazione della versione scelta.
func (g *GoIDE) InstallToolchain(request codestudio.InstallToolchainRequest) (codestudio.ToolchainInstallation, error) {
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
func (g *GoIDE) ListDependencies(sessionID, moduleDirectory string) (codestudio.DependencyState, error) {
	return g.service.ListDependencies(sessionID, moduleDirectory)
}

// ResolveDependencySource localizza il codice sorgente di una dipendenza del go.mod.
func (g *GoIDE) ResolveDependencySource(sessionID, moduleDirectory, modulePath string) (codestudio.DependencySource, error) {
	return g.service.ResolveDependencySource(sessionID, moduleDirectory, modulePath)
}

// ListModuleVersions elenca le versioni pubblicate di una dipendenza, dalla più recente.
func (g *GoIDE) ListModuleVersions(sessionID, moduleDirectory, modulePath string) ([]string, error) {
	return g.service.ListModuleVersions(sessionID, moduleDirectory, modulePath)
}

// StartDependencyAction applica un go get strutturato dopo conferma esplicita.
func (g *GoIDE) StartDependencyAction(request codestudio.DependencyActionRequest) (codestudio.Execution, error) {
	return g.service.StartDependencyAction(request)
}

// DependencyGraph costruisce il grafo delle dipendenze del modulo senza rete (albero, duplicati, licenze, peso).
func (g *GoIDE) DependencyGraph(sessionID, moduleDirectory string) (codestudio.DependencyGraphReport, error) {
	return g.service.DependencyGraph(sessionID, moduleDirectory)
}

// DependencyUpdates elenca le versioni più recenti disponibili per i moduli (richiede rete).
func (g *GoIDE) DependencyUpdates(sessionID, moduleDirectory string) ([]codestudio.DependencyUpdate, error) {
	return g.service.DependencyUpdates(sessionID, moduleDirectory)
}

// DependencyVulnerabilities esegue govulncheck sul modulo (richiede rete e govulncheck installato).
func (g *GoIDE) DependencyVulnerabilities(sessionID, moduleDirectory string) ([]codestudio.DependencyVulnerability, error) {
	return g.service.DependencyVulnerabilities(sessionID, moduleDirectory)
}

// VulnerabilityScan esegue govulncheck con percorsi di chiamata, versione corretta e catena di dipendenze.
func (g *GoIDE) VulnerabilityScan(sessionID, moduleDirectory string) (codestudio.VulnReport, error) {
	return g.service.VulnerabilityScan(sessionID, moduleDirectory)
}

// SecurityScan analizza offline i file del progetto: segreti e regole statiche di sicurezza.
func (g *GoIDE) SecurityScan(sessionID string) (codestudio.SecurityReport, error) {
	return g.service.SecurityScan(sessionID)
}

// SuppressSecurityFinding sopprime un finding con motivazione (salvata in .adomnia/security.json).
func (g *GoIDE) SuppressSecurityFinding(sessionID string, finding codestudio.SecurityFinding, reason string) error {
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
func (g *GoIDE) StartTests(request codestudio.TestRunRequest) (codestudio.TestRunSnapshot, error) {
	return g.service.StartTests(request)
}

// GetTestRun restituisce un'esecuzione di test con l'output di ogni nodo.
func (g *GoIDE) GetTestRun(runID string) (codestudio.TestRunSnapshot, error) {
	return g.service.GetTestRun(runID)
}

// GetTestOutput restituisce l'output di un solo test.
func (g *GoIDE) GetTestOutput(runID, nodeID string) (string, error) {
	return g.service.GetTestOutput(runID, nodeID)
}

// ListTestRuns restituisce le esecuzioni di test della sessione, dalla più recente.
func (g *GoIDE) ListTestRuns(sessionID string) ([]codestudio.TestRunSnapshot, error) {
	return g.service.ListTestRuns(sessionID)
}

// ListProfileFiles elenca i profili pprof (*.pprof) trovati nel progetto, per il Performance Studio.
func (g *GoIDE) ListProfileFiles(sessionID string) ([]codestudio.ProfileFile, error) {
	return g.service.ListProfileFiles(sessionID)
}

// CaptureLiveProfile salva nel progetto un profilo scaricato da /debug/pprof di un servizio locale.
func (g *GoIDE) CaptureLiveProfile(ctx context.Context, request codestudio.LiveProfileRequest) (codestudio.ProfileFile, error) {
	return g.service.CaptureLiveProfile(ctx, request)
}

// LoadProfile interpreta un profilo pprof del progetto in un report per il Performance Studio.
func (g *GoIDE) LoadProfile(sessionID, relativePath string) (codestudio.ProfileReport, error) {
	return g.service.LoadProfile(sessionID, relativePath)
}

// CaptureLiveTrace salva nel progetto una trace di esecuzione registrata da /debug/pprof/trace.
func (g *GoIDE) CaptureLiveTrace(ctx context.Context, request codestudio.LiveProfileRequest) (codestudio.ProfileFile, error) {
	return g.service.CaptureLiveTrace(ctx, request)
}

// ListTraceFiles elenca i file di esecuzione trace (`trace.out`, `*.trace`) del progetto.
func (g *GoIDE) ListTraceFiles(sessionID string) ([]codestudio.ProfileFile, error) {
	return g.service.ListTraceFiles(sessionID)
}

// LoadTrace interpreta un file trace del progetto in una timeline per il viewer.
func (g *GoIDE) LoadTrace(sessionID, relativePath string) (codestudio.TraceReport, error) {
	return g.service.LoadTrace(sessionID, relativePath)
}

// ListFuzzTargets elenca le funzioni Fuzz* con il corpus in testdata/fuzz e nella cache di Go.
func (g *GoIDE) ListFuzzTargets(sessionID string) ([]codestudio.FuzzTarget, error) {
	return g.service.ListFuzzTargets(sessionID)
}

// ReadFuzzInput interpreta un input del corpus fuzz.
func (g *GoIDE) ReadFuzzInput(sessionID, packageDir, target, source, name string) (codestudio.FuzzInputContent, error) {
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
func (g *GoIDE) DetectSonarScanner(sessionID string) (codestudio.SonarScannerInfo, error) {
	return g.service.DetectSonarScanner(sessionID)
}

// ConfigureSonarScanner imposta un binario sonar-scanner personalizzato; vuoto ripristina la ricerca automatica.
func (g *GoIDE) ConfigureSonarScanner(sessionID, binary string) error {
	return g.service.ConfigureSonarScanner(sessionID, binary)
}

// SonarConfigFor restituisce la configurazione SonarQube (senza token) della sessione.
func (g *GoIDE) SonarConfigFor(sessionID string) (codestudio.SonarConfig, error) {
	return g.service.SonarConfigFor(sessionID)
}

// SaveSonarConfig salva server, chiave e percorsi; il token è separato e resta in memoria.
func (g *GoIDE) SaveSonarConfig(sessionID string, config codestudio.SonarConfig) (codestudio.SonarConfig, error) {
	return g.service.SaveSonarConfig(sessionID, config)
}

// SetSonarToken memorizza il token SonarQube in memoria per la sessione (mai persistito).
func (g *GoIDE) SetSonarToken(sessionID, token string) error {
	return g.service.SetSonarToken(sessionID, token)
}

// RunSonarScan esegue sonar-scanner e importa gli issue dalla Web API.
func (g *GoIDE) RunSonarScan(ctx context.Context, sessionID, token string) (codestudio.SonarScanResult, error) {
	return g.service.RunSonarScan(ctx, sessionID, token)
}

// FetchSonarIssues importa gli issue già presenti sul server, senza rieseguire la scansione.
func (g *GoIDE) FetchSonarIssues(ctx context.Context, sessionID, token string) (codestudio.SonarScanResult, error) {
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
func (g *GoIDE) DetectDelve(sessionID string) (codestudio.DelveInfo, error) {
	return g.service.DetectDelve(sessionID)
}

// ConfigureDelve imposta un binario dlv personalizzato; vuoto ripristina la ricerca automatica.
func (g *GoIDE) ConfigureDelve(sessionID, binary string) error {
	return g.service.ConfigureDelve(sessionID, binary)
}

// DetectMake indica quale make userebbe la sessione per i Makefile del progetto.
func (g *GoIDE) DetectMake(sessionID string) (codestudio.MakeInfo, error) {
	return g.service.DetectMake(sessionID)
}

// ConfigureMake imposta un binario make personalizzato; vuoto ripristina la ricerca automatica.
func (g *GoIDE) ConfigureMake(sessionID, binary string) error {
	return g.service.ConfigureMake(sessionID, binary)
}

// InstallDelve installa dlv nella cartella strumenti di adOmnia dopo conferma esplicita.
func (g *GoIDE) InstallDelve(sessionID string, confirmed bool) (codestudio.Execution, error) {
	return g.service.InstallDelve(sessionID, confirmed)
}

// StartJavaMain esegue una classe Java con `main` (▶ nel gutter) senza una configurazione salvata.
func (g *GoIDE) StartJavaMain(sessionID, relativeFile, mainClass string) (codestudio.Execution, error) {
	return g.service.StartJavaMain(sessionID, relativeFile, mainClass)
}

// StartJavaDebug avvia il debug di una classe Java con `main` tramite il Java Debug Server di JDT LS.
func (g *GoIDE) StartJavaDebug(request codestudio.JavaDebugRequest) (codestudio.DebugSessionInfo, error) {
	return g.service.StartJavaDebug(request)
}

// StartDebug avvia una sessione Delve per un programma o un singolo test.
func (g *GoIDE) StartDebug(request codestudio.DebugRequest) (codestudio.DebugSessionInfo, error) {
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
func (g *GoIDE) DebugThreads(debugID string) ([]codestudio.DebugThread, error) {
	return g.service.DebugThreads(debugID)
}

// DebugStackTrace restituisce i frame di una goroutine.
func (g *GoIDE) DebugStackTrace(debugID string, threadID int) ([]codestudio.DebugFrame, error) {
	return g.service.DebugStackTrace(debugID, threadID)
}

// DebugGoroutines restituisce le goroutine della pausa corrente per la vista Concurrency.
func (g *GoIDE) DebugGoroutines(debugID string) (codestudio.GoroutineOverview, error) {
	return g.service.DebugGoroutines(debugID)
}

// DebugScopes restituisce gli scope di un frame.
func (g *GoIDE) DebugScopes(debugID string, frameID int) ([]codestudio.DebugScope, error) {
	return g.service.DebugScopes(debugID, frameID)
}

// DebugReadMemory legge la memoria da un indirizzo o dall'indirizzo di un'espressione nel frame.
func (g *GoIDE) DebugReadMemory(debugID, location string, length, frameID int) (codestudio.DebugMemory, error) {
	return g.service.DebugReadMemory(debugID, location, length, frameID)
}

// DebugShowRegisters mostra o nasconde lo scope Registers nelle variabili dei frame.
func (g *GoIDE) DebugShowRegisters(debugID string, show bool) error {
	return g.service.DebugShowRegisters(debugID, show)
}

// DebugDisassemble restituisce il codice macchina attorno all'istruzione corrente di un frame.
func (g *GoIDE) DebugDisassemble(debugID, address string, before, after int) ([]codestudio.DebugInstruction, error) {
	return g.service.DebugDisassemble(debugID, address, before, after)
}

// DebugVariables espande un riferimento a variabili.
func (g *GoIDE) DebugVariables(debugID string, reference int) ([]codestudio.DebugVariable, error) {
	return g.service.DebugVariables(debugID, reference)
}

// DebugEvaluate valuta un'espressione nel frame indicato.
func (g *GoIDE) DebugEvaluate(debugID, expression string, frameID int, context string) (codestudio.EvaluateResult, error) {
	return g.service.DebugEvaluate(debugID, expression, frameID, context)
}

// ListDebugSessions elenca le sessioni di debug del progetto.
func (g *GoIDE) ListDebugSessions(sessionID string) ([]codestudio.DebugSessionInfo, error) {
	return g.service.ListDebugSessions(sessionID)
}

// SetBreakpoints sostituisce i breakpoint di un file (con condizione, hit count o logpoint) e li applica alle sessioni attive.
func (g *GoIDE) SetBreakpoints(sessionID, relativePath string, breakpoints []codestudio.Breakpoint) ([]codestudio.BreakpointState, error) {
	return g.service.SetBreakpoints(sessionID, relativePath, breakpoints)
}

// ListFunctionBreakpoints restituisce i breakpoint di funzione e il panic breakpoint del progetto.
func (g *GoIDE) ListFunctionBreakpoints(sessionID string) (codestudio.FunctionBreakpointsView, error) {
	return g.service.ListFunctionBreakpoints(sessionID)
}

// SetFunctionBreakpoints sostituisce i breakpoint di funzione e il panic breakpoint del progetto.
func (g *GoIDE) SetFunctionBreakpoints(sessionID string, settings codestudio.FunctionBreakpointSettings) (codestudio.FunctionBreakpointsView, error) {
	return g.service.SetFunctionBreakpoints(sessionID, settings)
}

// DebugRunToCursor riprende il programma in pausa fino alla riga indicata.
func (g *GoIDE) DebugRunToCursor(debugID, relativePath string, line, threadID int) error {
	return g.service.DebugRunToCursor(debugID, relativePath, line, threadID)
}

// ListBreakpoints restituisce i breakpoint salvati della sessione.
func (g *GoIDE) ListBreakpoints(sessionID string) ([]codestudio.FileBreakpoints, error) {
	return g.service.ListBreakpoints(sessionID)
}

// CreateFiles crea file nuovi nel progetto, tutti o nessuno.
func (g *GoIDE) CreateFiles(sessionID string, files []codestudio.NewFile) error {
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
func (g *GoIDE) ImplementationMarkers(ctx context.Context, sessionID, documentID string) ([]codestudio.ImplementationMarker, error) {
	markers, err := g.service.ImplementationMarkers(ctx, sessionID, documentID)
	return settleCancelled(ctx, markers, err)
}

// PreviewGoTool mostra il comando Go Tools esatto prima dell'esecuzione.
func (g *GoIDE) PreviewGoTool(request codestudio.GoToolRequest) (codestudio.GoToolPreview, error) {
	return g.service.PreviewGoTool(request)
}

// StartGoTool esegue un comando Go Tools nella Run console.
func (g *GoIDE) StartGoTool(request codestudio.GoToolRequest) (codestudio.Execution, error) {
	return g.service.StartGoTool(request)
}

// ListProcesses elenca i processi locali per Attach to Process.
func (g *GoIDE) ListProcesses() ([]codestudio.ProcessInfo, error) {
	return g.service.ListProcesses()
}

// ListLocalHistory elenca le versioni salvate di un file.
func (g *GoIDE) ListLocalHistory(sessionID, relativePath string) ([]codestudio.HistoryRevision, error) {
	return g.service.ListLocalHistory(sessionID, relativePath)
}

// LocalHistoryContent restituisce il testo di una versione della local history.
func (g *GoIDE) LocalHistoryContent(sessionID, relativePath, revisionID string) (string, error) {
	return g.service.LocalHistoryContent(sessionID, relativePath, revisionID)
}

// WatcherStatus indica se il progetto è osservato per intero o solo in parte.
func (g *GoIDE) WatcherStatus(sessionID string) (codestudio.WatcherStatus, error) {
	return g.service.WatcherStatus(sessionID)
}

// VCSStatus legge branch e modifiche del repository Git del progetto, senza operazioni di rete.
func (g *GoIDE) VCSStatus(sessionID string) (codestudio.VCSStatus, error) {
	return g.service.VCSStatus(sessionID)
}

func (g *GoIDE) VCSSelectRepository(sessionID, root string) (codestudio.VCSStatus, error) {
	return g.service.VCSSelectRepository(sessionID, root)
}

// VCSFileAtRevision restituisce il file a una revisione (HEAD per il gutter diff).
func (g *GoIDE) VCSFileAtRevision(sessionID, relativePath, revision string) (string, error) {
	return g.service.VCSFileAtRevision(sessionID, relativePath, revision)
}

// VCSFileHistory elenca i commit che hanno toccato il file.
func (g *GoIDE) VCSFileHistory(sessionID, relativePath string) ([]codestudio.VCSCommit, error) {
	return g.service.VCSFileHistory(sessionID, relativePath)
}

// AffectedTestPackages aggiunge ai package indicati quelli del modulo che li importano (anche nei test).
func (g *GoIDE) AffectedTestPackages(sessionID, moduleDirectory string, packages []string) ([]string, error) {
	return g.service.AffectedTestPackages(sessionID, moduleDirectory, packages)
}

// VCSChangedSymbols elenca le dichiarazioni Go aggiunte, modificate o rimosse rispetto a HEAD.
func (g *GoIDE) VCSChangedSymbols(sessionID string) ([]codestudio.VCSChangedSymbol, error) {
	return g.service.VCSChangedSymbols(sessionID)
}

// VCSPatchLines restituisce le righe Go aggiunte o modificate dal merge-base con base.
func (g *GoIDE) VCSPatchLines(sessionID, base string) (map[string][]git.LineRange, error) {
	return g.service.VCSPatchLines(sessionID, base)
}

// VCSLineHistory elenca i commit che hanno modificato le righe start..end del file.
func (g *GoIDE) VCSLineHistory(sessionID, relativePath string, start, end int) ([]codestudio.VCSCommit, error) {
	return g.service.VCSLineHistory(sessionID, relativePath, start, end)
}

// VCSBlame restituisce autore e commit di ogni riga del file.
func (g *GoIDE) VCSBlame(sessionID, relativePath string) ([]codestudio.VCSBlameLine, error) {
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

// VCSStage aggiunge o rimuove file dall'index Git.
func (g *GoIDE) VCSStage(sessionID string, relativePaths []string, staged bool) error {
	return g.service.VCSStage(sessionID, relativePaths, staged)
}

// VCSRevert scarta le modifiche dei file selezionati dopo conferma nella UI.
func (g *GoIDE) VCSRevert(sessionID string, relativePaths []string) error {
	return g.service.VCSRevert(sessionID, relativePaths)
}

// VCSPull aggiorna il branch corrente da origin.
func (g *GoIDE) VCSPull(sessionID string) error { return g.service.VCSPull(sessionID) }

// VCSPush pubblica il branch corrente su origin.
func (g *GoIDE) VCSPush(sessionID string) error { return g.service.VCSPush(sessionID) }

// ComparePaths confronta due file di testo o due cartelle del progetto.
func (g *GoIDE) ComparePaths(sessionID, leftRelativePath, rightRelativePath string) (codestudio.PathComparison, error) {
	return g.service.ComparePaths(sessionID, leftRelativePath, rightRelativePath)
}

// CreateGist pubblica un file tramite GitHub CLI dopo la conferma nel frontend.
func (g *GoIDE) CreateGist(sessionID, relativePath, description string, public bool) (string, error) {
	return g.service.CreateGist(sessionID, relativePath, description, public)
}

// StartRun avvia una build, run o tidy con argomenti strutturati.
func (g *GoIDE) StartRun(request codestudio.RunRequest) (codestudio.Execution, error) {
	return g.service.StartRun(request)
}

// StopRun arresta in modo idempotente l'esecuzione indicata.
func (g *GoIDE) StopRun(runID string) error {
	return g.service.StopRun(runID)
}

// RestartRun riavvia la configurazione associata a un'esecuzione.
func (g *GoIDE) RestartRun(runID string) (codestudio.Execution, error) {
	return g.service.RestartRun(runID)
}

// WriteRunInput invia input alla console dell'esecuzione indicata.
func (g *GoIDE) WriteRunInput(runID, text string) error {
	return g.service.WriteRunInput(runID, text)
}

// ListRuns restituisce le esecuzioni note per una sessione.
func (g *GoIDE) ListRuns(sessionID string) ([]codestudio.Execution, error) {
	return g.service.ListRuns(sessionID)
}

// HasActiveRuns indica se la sessione possiede processi attivi.
func (g *GoIDE) HasActiveRuns(sessionID string) bool {
	return g.service.HasActiveRuns(sessionID)
}

// DetectGopls individua gopls e ne legge la versione.
func (g *GoIDE) DetectGopls(sessionID string) (codestudio.GoplsInfo, error) {
	return g.service.DetectGopls(sessionID)
}

// ConfigureGopls imposta un binario gopls personalizzato; vuoto ripristina la ricerca automatica.
func (g *GoIDE) ConfigureGopls(sessionID, binary string) error {
	return g.service.ConfigureGopls(sessionID, binary)
}

// InstallGopls installa gopls nella cartella strumenti di adOmnia dopo conferma esplicita.
func (g *GoIDE) InstallGopls(sessionID string, confirmed bool) (codestudio.Execution, error) {
	return g.service.InstallGopls(sessionID, confirmed)
}

// StartLanguageServer avvia gopls per un progetto autorizzato.
func (g *GoIDE) StartLanguageServer(sessionID string, settings codestudio.LanguageServerSettings) (codestudio.LanguageServerStatus, error) {
	return g.service.StartLanguageServerFromUser(sessionID, settings)
}

// RestartLanguageServer riavvia gopls azzerando il contatore dei crash.
func (g *GoIDE) RestartLanguageServer(sessionID string, settings codestudio.LanguageServerSettings) (codestudio.LanguageServerStatus, error) {
	return g.service.RestartLanguageServerFromUser(sessionID, settings)
}

// StopLanguageServer arresta gopls della sessione.
func (g *GoIDE) StopLanguageServer(sessionID string) error {
	return g.service.StopLanguageServer(sessionID)
}

// GetLanguageServerStatus restituisce lo stato di gopls per la sessione.
func (g *GoIDE) GetLanguageServerStatus(sessionID string) (codestudio.LanguageServerStatus, error) {
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
func (g *GoIDE) OpenExternalDocument(sessionID, path string) (codestudio.OpenDocument, error) {
	return g.service.OpenExternalDocument(sessionID, path)
}

// Completion restituisce i suggerimenti gopls; la richiesta si annulla con la promise frontend.
func (g *GoIDE) Completion(ctx context.Context, sessionID, documentID string, line, column int) (codestudio.CompletionResult, error) {
	value, err := g.service.Completion(ctx, sessionID, documentID, line, column)
	return settleCancelled(ctx, value, err)
}

// SemanticTokens restituisce i token semantici del buffer, da decodificare con la legenda di gopls.
func (g *GoIDE) SemanticTokens(ctx context.Context, sessionID, documentID string) (codestudio.SemanticTokensResult, error) {
	value, err := g.service.SemanticTokens(ctx, sessionID, documentID)
	return settleCancelled(ctx, value, err)
}

// InlayHints restituisce i suggerimenti in linea per l'intervallo visibile.
func (g *GoIDE) InlayHints(ctx context.Context, sessionID, documentID string, visible codestudio.EditorRange) (codestudio.InlayHintsResult, error) {
	value, err := g.service.InlayHints(ctx, sessionID, documentID, visible)
	return settleCancelled(ctx, value, err)
}

// DocumentHighlights evidenzia occorrenze e punti di uscita al cursore.
func (g *GoIDE) DocumentHighlights(ctx context.Context, sessionID, documentID string, line, column int) (codestudio.HighlightsResult, error) {
	value, err := g.service.DocumentHighlights(ctx, sessionID, documentID, line, column)
	return settleCancelled(ctx, value, err)
}

// GoWorkState legge go.work e i moduli rilevati del progetto.
func (g *GoIDE) GoWorkState(sessionID string) (codestudio.GoWorkState, error) {
	return g.service.GoWorkState(sessionID)
}

// UpdateGoWork porta go.work all'insieme di moduli indicato con i comandi go work ufficiali.
func (g *GoIDE) UpdateGoWork(sessionID string, directories []string) (codestudio.GoWorkState, error) {
	return g.service.UpdateGoWork(sessionID, directories)
}

// CloneRepository clona un repository Git in parent/<nome> e restituisce la cartella, da aprire come progetto.
func (g *GoIDE) CloneRepository(remoteURL, parent string) (string, error) {
	destination, err := codestudio.CloneDestination(parent, remoteURL)
	if err != nil {
		return "", err
	}
	if err := git.Clone(remoteURL, destination); err != nil {
		return "", err
	}
	return destination, nil
}

// GenerateGoCode genera costruttore, getter/setter, interfaccia, benchmark o fuzz test sul testo indicato.
func (g *GoIDE) GenerateGoCode(request codestudio.CodeGenRequest) (codestudio.CodeGenResult, error) {
	return codestudio.GenerateGoCode(request)
}

// PrepareHierarchy apre Call Hierarchy o Type Hierarchy sul simbolo al cursore.
func (g *GoIDE) PrepareHierarchy(ctx context.Context, sessionID, documentID, kind string, line, column int) ([]codestudio.HierarchyItem, error) {
	return g.service.PrepareHierarchy(ctx, sessionID, documentID, kind, line, column)
}

// ExpandHierarchy carica i figli di un nodo della gerarchia.
func (g *GoIDE) ExpandHierarchy(ctx context.Context, sessionID, direction, token string) ([]codestudio.HierarchyItem, error) {
	return g.service.ExpandHierarchy(ctx, sessionID, direction, token)
}

// RecursiveCalls restituisce le chiamate ricorsive dirette del file.
func (g *GoIDE) RecursiveCalls(ctx context.Context, sessionID, documentID string) (codestudio.RecursiveCallsResult, error) {
	value, err := g.service.RecursiveCalls(ctx, sessionID, documentID)
	return settleCancelled(ctx, value, err)
}

// QuickDefinition restituisce il sorgente della dichiarazione al cursore per il popup Quick Definition.
func (g *GoIDE) QuickDefinition(ctx context.Context, sessionID, documentID string, line, column int) (codestudio.QuickDefinitionResult, error) {
	value, err := g.service.QuickDefinition(ctx, sessionID, documentID, line, column)
	return settleCancelled(ctx, value, err)
}

// Hover restituisce la documentazione del simbolo sotto il cursore.
func (g *GoIDE) Hover(ctx context.Context, sessionID, documentID string, line, column int) (codestudio.HoverResult, error) {
	value, err := g.service.Hover(ctx, sessionID, documentID, line, column)
	return settleCancelled(ctx, value, err)
}

// SignatureHelp restituisce la firma della chiamata in corso.
func (g *GoIDE) SignatureHelp(ctx context.Context, sessionID, documentID string, line, column int) (codestudio.SignatureResult, error) {
	value, err := g.service.SignatureHelp(ctx, sessionID, documentID, line, column)
	return settleCancelled(ctx, value, err)
}

// Locations esegue definition, typeDefinition, implementation o references.
func (g *GoIDE) Locations(ctx context.Context, sessionID, documentID, kind string, line, column int) ([]codestudio.EditorLocation, error) {
	value, err := g.service.Locations(ctx, sessionID, documentID, kind, line, column)
	return settleCancelled(ctx, value, err)
}

// DocumentSymbols restituisce la struttura del file.
func (g *GoIDE) DocumentSymbols(ctx context.Context, sessionID, documentID string) (codestudio.DocumentSymbolsResult, error) {
	value, err := g.service.DocumentSymbols(ctx, sessionID, documentID)
	return settleCancelled(ctx, value, err)
}

// WorkspaceSymbols cerca simboli nel workspace.
func (g *GoIDE) WorkspaceSymbols(ctx context.Context, sessionID, query string) ([]codestudio.WorkspaceSymbol, error) {
	value, err := g.service.WorkspaceSymbols(ctx, sessionID, query)
	return settleCancelled(ctx, value, err)
}

// PrepareRename verifica il simbolo da rinominare.
func (g *GoIDE) PrepareRename(ctx context.Context, sessionID, documentID string, line, column int) (codestudio.RenameTarget, error) {
	value, err := g.service.PrepareRename(ctx, sessionID, documentID, line, column)
	return settleCancelled(ctx, value, err)
}

// Rename calcola l'anteprima del rename semantico.
func (g *GoIDE) Rename(ctx context.Context, sessionID, documentID string, line, column int, newName string) (codestudio.WorkspaceChange, error) {
	value, err := g.service.Rename(ctx, sessionID, documentID, line, column, newName)
	return settleCancelled(ctx, value, err)
}

// FormatDocument restituisce gli edit di formattazione del buffer.
func (g *GoIDE) FormatDocument(ctx context.Context, sessionID, documentID string) (codestudio.FormatResult, error) {
	value, err := g.service.FormatDocument(ctx, sessionID, documentID)
	return settleCancelled(ctx, value, err)
}

// CodeActions elenca le azioni disponibili per la selezione.
func (g *GoIDE) CodeActions(ctx context.Context, sessionID, documentID string, selection codestudio.EditorRange, only []string) ([]codestudio.CodeActionEntry, error) {
	value, err := g.service.CodeActions(ctx, sessionID, documentID, selection, only)
	return settleCancelled(ctx, value, err)
}

// ResolveCodeAction calcola l'anteprima delle modifiche dell'azione.
// ChangeSignature riordina o rimuove parametri e risultati della funzione al cursore (anteprima).
func (g *GoIDE) ChangeSignature(ctx context.Context, sessionID, documentID string, caret codestudio.EditorRange, params, results []int) (codestudio.WorkspaceChange, error) {
	value, err := g.service.ChangeSignature(ctx, sessionID, documentID, caret, params, results)
	return settleCancelled(ctx, value, err)
}

func (g *GoIDE) ResolveCodeAction(ctx context.Context, sessionID, actionID string) (codestudio.WorkspaceChange, error) {
	value, err := g.service.ResolveCodeAction(ctx, sessionID, actionID)
	return settleCancelled(ctx, value, err)
}

// OrganizeImports calcola la pulizia degli import del file.
func (g *GoIDE) OrganizeImports(ctx context.Context, sessionID, documentID string) (codestudio.WorkspaceChange, error) {
	value, err := g.service.OrganizeImports(ctx, sessionID, documentID)
	return settleCancelled(ctx, value, err)
}

// DetectLinter individua golangci-lint o staticcheck e la configurazione di progetto.
func (g *GoIDE) DetectLinter(sessionID string) (codestudio.LinterInfo, error) {
	return g.service.DetectLinter(sessionID)
}

// ConfigureLinter imposta un binario linter personalizzato; vuoto ripristina la ricerca automatica.
func (g *GoIDE) ConfigureLinter(sessionID, binary string) error {
	return g.service.ConfigureLinter(sessionID, binary)
}

// InstallLinter installa golangci-lint o staticcheck nella cartella strumenti dopo conferma esplicita.
func (g *GoIDE) InstallLinter(sessionID, kind string, confirmed bool) (codestudio.Execution, error) {
	return g.service.InstallLinter(sessionID, kind, confirmed)
}

// RunLint esegue il linter sul progetto; si annulla con la promise frontend.
func (g *GoIDE) RunLint(ctx context.Context, sessionID string) (codestudio.LintResult, error) {
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
func (g *GoIDE) RunLintChanged(ctx context.Context, sessionID string) (codestudio.LintResult, error) {
	value, err := g.service.RunLintChanged(ctx, sessionID)
	return settleCancelled(ctx, value, err)
}

// SearchProject cerca testo nel progetto; si annulla con la promise frontend.
func (g *GoIDE) SearchProject(ctx context.Context, query codestudio.SearchQuery) (codestudio.SearchResult, error) {
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
func (g *GoIDE) ListRunConfigurations(sessionID string) ([]codestudio.RunConfiguration, error) {
	return g.service.ListRunConfigurations(sessionID)
}

// ListRunTargets discovers runnable main packages across the project's language units.
func (g *GoIDE) ListRunTargets(sessionID string) ([]run.RunTarget, error) {
	return g.service.ListRunTargets(sessionID)
}

// SaveRunConfiguration crea o aggiorna una configurazione Run validata.
func (g *GoIDE) SaveRunConfiguration(sessionID string, config codestudio.RunConfiguration) (codestudio.RunConfiguration, error) {
	return g.service.SaveRunConfiguration(sessionID, config)
}

// DuplicateRunConfiguration copia una configurazione esistente.
func (g *GoIDE) DuplicateRunConfiguration(sessionID, configID string) (codestudio.RunConfiguration, error) {
	return g.service.DuplicateRunConfiguration(sessionID, configID)
}

// RenameRunConfiguration rinomina una configurazione esistente.
func (g *GoIDE) RenameRunConfiguration(sessionID, configID, name string) (codestudio.RunConfiguration, error) {
	return g.service.RenameRunConfiguration(sessionID, configID, name)
}

// ReorderRunConfigurations applica l'ordine scelto dall'utente.
func (g *GoIDE) ReorderRunConfigurations(sessionID string, configIDs []string) ([]codestudio.RunConfiguration, error) {
	return g.service.ReorderRunConfigurations(sessionID, configIDs)
}

// DeleteRunConfiguration elimina una configurazione salvata.
func (g *GoIDE) DeleteRunConfiguration(sessionID, configID string) error {
	return g.service.DeleteRunConfiguration(sessionID, configID)
}

// SetSharedEnvironment applica a ogni run le variabili dell'environment attivo di adOmnia.
func (g *GoIDE) SetSharedEnvironment(vars map[string]string) {
	g.service.SetSharedEnvironment(vars)
}

// StartConfiguredRun avvia una configurazione salvata con i soli segreti forniti a runtime.
func (g *GoIDE) StartConfiguredRun(sessionID, configID string, secrets map[string]string) (codestudio.Execution, error) {
	return g.service.StartConfiguredRun(sessionID, configID, secrets)
}

// ListTerminalProfiles rileva le shell disponibili (PowerShell, cmd, Git Bash, distro WSL, zsh…).
func (g *GoIDE) ListTerminalProfiles() []codestudio.TerminalProfile {
	return codestudio.ListTerminalProfiles()
}

// ListRemoteTargets elenca gli ambienti in cui eseguire run e test: distro WSL, host SSH, container.
func (g *GoIDE) ListRemoteTargets() []codestudio.RemoteTarget {
	return g.service.ListRemoteTargets()
}

// OpenTerminal apre una shell interattiva reale nella working directory del progetto.
func (g *GoIDE) OpenTerminal(request codestudio.TerminalRequest) (codestudio.TerminalSession, error) {
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
func (g *GoIDE) RenameTerminal(terminalID, name string) (codestudio.TerminalSession, error) {
	return g.service.RenameTerminal(terminalID, name)
}

// CloseTerminal termina shell e albero di processi del terminale.
func (g *GoIDE) CloseTerminal(terminalID string) error {
	return g.service.CloseTerminal(terminalID)
}

// ListTerminals elenca i terminali della sola sessione indicata.
func (g *GoIDE) ListTerminals(sessionID string) ([]codestudio.TerminalSession, error) {
	return g.service.ListTerminals(sessionID)
}

// HasActiveTerminals indica se la sessione possiede shell ancora vive.
func (g *GoIDE) HasActiveTerminals(sessionID string) bool {
	return g.service.HasActiveTerminals(sessionID)
}

// GetSessionView restituisce layout e tab ripristinabili della sessione.
func (g *GoIDE) GetSessionView(sessionID string) (codestudio.SessionView, error) {
	return g.service.GetSessionView(sessionID)
}

// SaveSessionView registra layout e tab della sessione, senza contenuti dei file.
func (g *GoIDE) SaveSessionView(sessionID string, view codestudio.SessionView) error {
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
func (g *GoIDE) ListRecoveredBuffers(sessionID string) ([]codestudio.RecoveredBuffer, error) {
	return g.service.ListRecoveredBuffers(sessionID)
}

// PruneMissingSessions rimuove le sessioni la cui cartella non esiste più.
func (g *GoIDE) PruneMissingSessions() ([]codestudio.Session, error) {
	return g.service.PruneMissingSessions()
}

// FindSessionsForPath elenca le altre sessioni che contengono lo stesso file.
func (g *GoIDE) FindSessionsForPath(sessionID, relativePath string) ([]codestudio.Session, error) {
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
func (g *GoIDE) CrashRecoveryStatus() codestudio.CrashStatus {
	return g.service.CrashRecoveryStatus()
}

// DetectGoTool cerca un tool Go (govulncheck, goimports, mockgen, stringer o personalizzato).
func (g *GoIDE) DetectGoTool(sessionID, binary string) (codestudio.GoToolInfo, error) {
	return g.service.DetectGoTool(sessionID, binary)
}

// InstallGoModule esegue go install di un modulo@versione nella cartella strumenti, dopo conferma.
func (g *GoIDE) InstallGoModule(sessionID, module string, confirmed bool) (codestudio.Execution, error) {
	return g.service.InstallGoModule(sessionID, module, confirmed)
}

// RunGoTool esegue un tool Go rilevato con argomenti strutturati nella cartella indicata.
func (g *GoIDE) RunGoTool(sessionID, binary string, arguments []string, workingDirectory string) (codestudio.Execution, error) {
	return g.service.RunGoTool(sessionID, binary, arguments, workingDirectory)
}

// InterruptedProcesses elenca le esecuzioni interrotte dal crash dell'avvio precedente.
func (g *GoIDE) InterruptedProcesses() []codestudio.ProcessDescriptor {
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

// ListStudioWorkspaces elenca i workspace Code Studio, separati dai workspace API di adOmnia.
func (g *GoIDE) ListStudioWorkspaces() (codestudio.StudioWorkspaces, error) {
	return g.service.ListStudioWorkspaces()
}

// CreateStudioWorkspace crea un workspace Code Studio vuoto e lo rende attivo.
func (g *GoIDE) CreateStudioWorkspace(name string) (codestudio.StudioWorkspaces, error) {
	return g.service.CreateStudioWorkspace(name)
}

// RenameStudioWorkspace rinomina un workspace Code Studio.
func (g *GoIDE) RenameStudioWorkspace(id, name string) (codestudio.StudioWorkspaces, error) {
	return g.service.RenameStudioWorkspace(id, name)
}

// DeleteStudioWorkspace elimina un workspace Code Studio senza progetti aperti.
func (g *GoIDE) DeleteStudioWorkspace(id string) (codestudio.StudioWorkspaces, error) {
	return g.service.DeleteStudioWorkspace(id)
}

// SetActiveStudioWorkspace cambia il workspace Code Studio mostrato.
func (g *GoIDE) SetActiveStudioWorkspace(id string) (codestudio.StudioWorkspaces, error) {
	return g.service.SetActiveStudioWorkspace(id)
}

// AnalyzeErrorHandling analizza la gestione degli errori del progetto (richiede un progetto autorizzato).
func (g *GoIDE) AnalyzeErrorHandling(sessionID string) (codestudio.ErrorHandlingReport, error) {
	return g.service.AnalyzeErrorHandling(sessionID)
}

// AnalyzeArchitecture costruisce package graph, call graph, moduli, interfacce ed entry point (progetto autorizzato).
func (g *GoIDE) AnalyzeArchitecture(sessionID string) (codestudio.ArchitectureResult, error) {
	return g.service.AnalyzeArchitecture(sessionID)
}

// WorkspaceGraphSummary costruisce (o riprende dal disco) il Semantic Workspace Graph e ne dà il riassunto.
func (g *GoIDE) WorkspaceGraphSummary(sessionID string, rebuild bool) (codestudio.GraphSummary, error) {
	return g.service.WorkspaceGraphSummary(sessionID, rebuild)
}

// GraphImpact: cosa può rompere una modifica alla funzione che contiene relPath:line.
func (g *GoIDE) GraphImpact(sessionID, relPath string, line int) (graph.Impact, error) {
	return g.service.GraphImpact(sessionID, relPath, line)
}

// GraphImpactOf: impatto di un nodo del grafo già noto.
func (g *GoIDE) GraphImpactOf(sessionID, nodeID string) (graph.Impact, error) {
	return g.service.GraphImpactOf(sessionID, nodeID)
}

// GraphSearch cerca nel grafo per nome, filtrando per tipo di nodo.
func (g *GoIDE) GraphSearch(sessionID, query string, kinds []string, limit int) ([]graph.Node, error) {
	return g.service.GraphSearch(sessionID, query, kinds, limit)
}

// SecurityExposures dice da quali route, RPC e topic si raggiunge ogni finding di sicurezza.
func (g *GoIDE) SecurityExposures(sessionID string, locations []codestudio.FindingLocation) ([]codestudio.SecurityExposure, error) {
	return g.service.SecurityExposures(sessionID, locations)
}

// GraphRiskMap è il rischio di modifica di ogni package del progetto.
func (g *GoIDE) GraphRiskMap(sessionID string) (codestudio.GraphRiskMap, error) {
	return g.service.RiskMap(sessionID)
}

// ArchitectureDrift verifica le regole di .adomnia/architecture.json sul workspace graph.
func (g *GoIDE) ArchitectureDrift(sessionID string) (graph.DriftReport, error) {
	return g.service.ArchitectureDrift(sessionID)
}

// CreateArchitectureRules crea .adomnia/architecture.json da un modello, se manca.
func (g *GoIDE) CreateArchitectureRules(sessionID string) (string, error) {
	return g.service.CreateArchitectureRules(sessionID)
}

// CompareArchitecture confronta l'architettura di oggi con un branch, tag o commit.
func (g *GoIDE) CompareArchitecture(sessionID, ref string) (codestudio.ArchitectureDiff, error) {
	return g.service.CompareArchitecture(sessionID, ref)
}

// PackageHeatmap dà fan-in, fan-out e blast radius dei package e gli import del progetto.
func (g *GoIDE) PackageHeatmap(sessionID string) (codestudio.PackageHeatmap, error) {
	return g.service.PackageHeatmap(sessionID)
}

// APIContractDrift confronta route e DTO del codice con il contratto OpenAPI del progetto.
func (g *GoIDE) APIContractDrift(sessionID string) (codestudio.APIContractReport, error) {
	return g.service.APIContractDrift(sessionID)
}

// CompareAPI elenca le modifiche all'API (e quelle che rompono i client) rispetto a un ref Git.
func (g *GoIDE) CompareAPI(sessionID, ref string) ([]apicontract.Issue, error) {
	return g.service.CompareAPI(sessionID, ref)
}

// EventContractDrift confronta producer, consumer e schemi dei messaggi.
func (g *GoIDE) EventContractDrift(sessionID string) (codestudio.EventContractReport, error) {
	return g.service.EventContractDrift(sessionID)
}

// CompareEvents elenca le modifiche ai messaggi prodotti rispetto a un ref Git.
func (g *GoIDE) CompareEvents(sessionID, ref string) ([]apicontract.Issue, error) {
	return g.service.CompareEvents(sessionID, ref)
}

// InspectBinary compila un package main e ne mostra dimensioni, moduli, metadati e asset.
func (g *GoIDE) InspectBinary(sessionID, target string) (golang.BinaryReport, error) {
	return g.service.InspectBinary(sessionID, target)
}

// CompareBinary confronta la dimensione del binario per package con un branch o commit.
func (g *GoIDE) CompareBinary(sessionID, target, ref string) (codestudio.BinaryComparison, error) {
	return g.service.CompareBinary(sessionID, target, ref)
}

// DependencyWhy spiega con `go mod why -m` perché il progetto dipende da un modulo.
func (g *GoIDE) DependencyWhy(sessionID, module string) (codestudio.DependencyWhy, error) {
	return g.service.DependencyWhy(sessionID, module)
}

// SaveRuntimeSnapshot salva un'istantanea runtime in .adomnia/snapshots.
func (g *GoIDE) SaveRuntimeSnapshot(sessionID, label, content string) (string, error) {
	return g.service.SaveRuntimeSnapshot(sessionID, label, content)
}

// ListRuntimeSnapshots elenca le istantanee runtime del progetto.
func (g *GoIDE) ListRuntimeSnapshots(sessionID string) ([]codestudio.RuntimeSnapshotFile, error) {
	return g.service.ListRuntimeSnapshots(sessionID)
}

// LoadRuntimeSnapshot legge un'istantanea runtime.
func (g *GoIDE) LoadRuntimeSnapshot(sessionID, name string) (string, error) {
	return g.service.LoadRuntimeSnapshot(sessionID, name)
}

// StartupAnalysis misura l'avvio di un package main (init, connessioni, porta, health).
func (g *GoIDE) StartupAnalysis(sessionID, target, health string, timeoutSeconds int) (codestudio.StartupReport, error) {
	return g.service.StartupAnalysis(sessionID, target, health, timeoutSeconds)
}

// ShutdownAnalysis avvia un package main, gli manda l'interrupt e osserva l'arresto.
func (g *GoIDE) ShutdownAnalysis(sessionID, target, health string, graceSeconds int) (codestudio.ShutdownReport, error) {
	return g.service.ShutdownAnalysis(sessionID, target, health, graceSeconds)
}

// MemoryModelAt spiega gli archi happens-before della funzione sotto il cursore.
func (g *GoIDE) MemoryModelAt(sessionID, relPath string, line int) (codestudio.MemoryModelReport, error) {
	return g.service.MemoryModelAt(sessionID, relPath, line)
}

// GraphSearchReady cerca nel grafo già pronto, senza ricostruirlo (Search Everywhere).
func (g *GoIDE) GraphSearchReady(sessionID, query string, kinds []string, limit int) ([]graph.Node, error) {
	return g.service.GraphSearchReady(sessionID, query, kinds, limit)
}

// Documentation legge la documentazione dei package Go e dei file .proto del progetto (solo parsing).
func (g *GoIDE) Documentation(sessionID string) (codestudio.DocumentationReport, error) {
	return g.service.Documentation(sessionID)
}

// Automatic entry points keep the existing editor-driven suspension policy.
func (g *GoIDE) StartAutomaticLanguageServer(sessionID string, settings codestudio.LanguageServerSettings) (codestudio.LanguageServerStatus, error) {
	return g.service.StartLanguageServer(sessionID, settings)
}
func (g *GoIDE) RestartAutomaticLanguageServer(sessionID string, settings codestudio.LanguageServerSettings) (codestudio.LanguageServerStatus, error) {
	return g.service.RestartLanguageServer(sessionID, settings)
}

// PomDependencies elenca le coordinate del pom.xml aperto con le posizioni delle versioni (testo dell'editor).
func (g *GoIDE) PomDependencies(sessionID, content string) ([]java.PomDependency, error) {
	return g.service.PomDependencies(sessionID, content)
}

// PomVersions cerca su Maven Central le versioni stabili delle coordinate indicate (azione esplicita dell'utente).
func (g *GoIDE) PomVersions(sessionID string, current map[string]string) ([]java.VersionInfo, error) {
	return g.service.PomVersions(sessionID, current)
}

// JavaJDKs elenca i JDK installati, quello del progetto e la versione che il progetto richiede.
func (g *GoIDE) JavaJDKs(sessionID string) (codestudio.JavaJDKReport, error) {
	return g.service.JavaJDKs(sessionID)
}

// JavaDependencyTree è l'albero delle dipendenze Maven di un modulo (mvn dependency:tree): lancia Maven.
func (g *GoIDE) JavaDependencyTree(sessionID, module string) ([]java.TreeNode, error) {
	return g.service.JavaDependencyTree(sessionID, module)
}

// JavaMainClasses elenca le classi lanciabili: JDT LS se pronto, altrimenti la scansione dei sorgenti.
func (g *GoIDE) JavaMainClasses(sessionID string) ([]java.MainClassInfo, error) {
	return g.service.JavaMainClasses(sessionID)
}

// SetJavaJDK sceglie il JDK del progetto (stesso per Run, Debug e Test); "" torna al JDK di sistema.
func (g *GoIDE) SetJavaJDK(sessionID, home string) error {
	return g.service.SetJavaJDK(sessionID, home)
}

// SpringIndex è tutto ciò che si sa di un progetto Spring senza eseguirlo: proprietà di configurazione
// note, valori con il loro profilo, bean, iniezioni ed endpoint. Solo filesystem, senza rete.
func (g *GoIDE) SpringIndex(sessionID string) (java.SpringIndex, error) {
	return g.service.SpringIndex(sessionID)
}

// SpringEndpoints elenca gli endpoint HTTP MVC del progetto (route, metodo, posizione).
func (g *GoIDE) SpringEndpoints(sessionID string) ([]java.SpringEndpoint, error) {
	return g.service.SpringEndpoints(sessionID)
}

// SpringMetadataRefresh indicizza i metadata di configurazione degli jar già scaricati nella repository
// Maven locale. Lavoro pesante, solo su azione esplicita: riprende dalla cache.
func (g *GoIDE) SpringMetadataRefresh(sessionID string, limit int) (java.SpringMetadataReport, error) {
	return g.service.SpringMetadataRefresh(sessionID, limit)
}
