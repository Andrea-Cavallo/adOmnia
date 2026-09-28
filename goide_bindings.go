package main

import (
	"adomnia/internal/goide"
	"adomnia/internal/storage"
	"context"
	"fmt"
	"path/filepath"
	"strings"
	"sync/atomic"

	"github.com/wailsapp/wails/v3/pkg/application"
	"github.com/wailsapp/wails/v3/pkg/events"
)

const goIDEStorageKey = "state"

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

type GoIDE struct {
	service            *goide.Service
	desktop            *application.App
	mainWindow         *application.WebviewWindow
	dirtyDocumentCount atomic.Int64
	allowAppClose      atomic.Bool
}

func NewGoIDE() *GoIDE {
	var binding *GoIDE
	service := goide.NewService(goIDEStore{}, func(event goide.EventEnvelope) {
		if binding != nil && binding.desktop != nil {
			binding.desktop.Event.Emit("goide:event", event)
		}
	})
	_ = service.ConfigureToolchainStorage(filepath.Join(dataDir(), "goide", "toolchains"))
	binding = &GoIDE{service: service}
	return binding
}

func (g *GoIDE) attachDesktop(desktop *application.App) {
	g.desktop = desktop
}

func (g *GoIDE) attachMainWindow(window *application.WebviewWindow) {
	g.mainWindow = window
	window.RegisterHook(events.Common.WindowClosing, func(event *application.WindowEvent) {
		if g.allowAppClose.Swap(false) {
			return
		}
		dirtyCount := g.dirtyDocumentCount.Load()
		activeRuns := g.service.HasAnyActiveRuns()
		if dirtyCount == 0 && !activeRuns {
			return
		}
		event.Cancel()
		if g.desktop != nil {
			g.desktop.Event.Emit("goide:close-requested", map[string]any{
				"dirtyDocumentCount": dirtyCount,
				"activeRuns":         activeRuns,
			})
		}
	})
}

// GetCapabilities restituisce soltanto le capacità Go Studio realmente disponibili.
func (g *GoIDE) GetCapabilities() goide.Capabilities {
	return g.service.GetCapabilities()
}

// OpenProject registra una cartella locale senza avviarne codice o strumenti.
func (g *GoIDE) OpenProject(path string) (goide.Session, error) {
	return g.service.OpenProject(path)
}

// CreateProject crea un modulo Go soltanto dopo la conferma esplicita inclusa nella richiesta.
func (g *GoIDE) CreateProject(request goide.CreateProjectRequest) (goide.Session, error) {
	return g.service.CreateProject(request)
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

// OpenDocument apre un documento testuale confinato al progetto.
func (g *GoIDE) OpenDocument(sessionID, relativePath string) (goide.OpenDocument, error) {
	return g.service.OpenDocument(sessionID, relativePath)
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

// StartDependencyAction applica un go get strutturato dopo conferma esplicita.
func (g *GoIDE) StartDependencyAction(request goide.DependencyActionRequest) (goide.Execution, error) {
	return g.service.StartDependencyAction(request)
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
func (g *GoIDE) ResolveCodeAction(ctx context.Context, sessionID, actionID string) (goide.WorkspaceChange, error) {
	value, err := g.service.ResolveCodeAction(ctx, sessionID, actionID)
	return settleCancelled(ctx, value, err)
}

// OrganizeImports calcola la pulizia degli import del file.
func (g *GoIDE) OrganizeImports(ctx context.Context, sessionID, documentID string) (goide.WorkspaceChange, error) {
	value, err := g.service.OrganizeImports(ctx, sessionID, documentID)
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

// ServiceShutdown rilascia processi e risorse posseduti dal servizio.
func (g *GoIDE) ServiceShutdown() error {
	g.service.Shutdown()
	return nil
}
