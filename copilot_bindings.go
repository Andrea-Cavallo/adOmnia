package main

import (
	"context"
	"encoding/json"

	"adomnia/internal/copilot"
	"adomnia/internal/goide"

	"github.com/wailsapp/wails/v3/pkg/application"
)

// Copilot espone a React l'integrazione GitHub Copilot di gO Studio. La logica vive in internal/copilot.
type Copilot struct {
	manager *copilot.Manager
}

// NewCopilot crea il servizio e lo collega ai documenti di Go Studio: lo stesso ciclo di vita di gopls.
func NewCopilot(goIDE *GoIDE) *Copilot {
	directory := dataDir()
	manager := copilot.NewManager(copilot.NewSettingsStore(directory), copilot.NewInstaller(directory))
	goIDE.service.SetDocumentObserver(copilotDocuments{manager: manager})
	return &Copilot{manager: manager}
}

func (c *Copilot) attachDesktop(desktop *application.App) {
	c.manager.SetEmitter(func(event string, payload any) { desktop.Event.Emit(event, payload) })
	c.manager.SetURLOpener(desktop.Browser.OpenURL)
}

// ServiceStartup avvia Copilot solo se l'utente lo ha attivato: di default non parte nulla.
func (c *Copilot) ServiceStartup(context.Context, application.ServiceOptions) error {
	go func() { _ = c.manager.Start() }()
	return nil
}

// ServiceShutdown chiude il Language Server senza lasciare processi orfani.
func (c *Copilot) ServiceShutdown() error {
	c.manager.Shutdown()
	return nil
}

// Status restituisce lo stato corrente (profilo e host sempre inclusi).
func (c *Copilot) Status() copilot.Status { return c.manager.Status() }

// Settings restituisce la configurazione: profili, binding, proxy. Mai token.
func (c *Copilot) Settings() copilot.Settings { return c.manager.Settings() }

// SaveSettings valida, salva e applica la configurazione.
func (c *Copilot) SaveSettings(settings copilot.Settings) (copilot.Settings, error) {
	return c.manager.SaveSettings(settings)
}

// Install scarica il Language Server ufficiale verificandone l'integrità.
func (c *Copilot) Install(ctx context.Context) (copilot.ServerBinary, error) {
	return c.manager.Install(ctx)
}

// Restart riavvia il Language Server azzerando il contatore dei crash.
func (c *Copilot) Restart() error { return c.manager.Restart() }

// Log restituisce le ultime righe di log del Language Server.
func (c *Copilot) Log() []string { return c.manager.Log() }

// SignIn avvia il device flow sull'host del profilo attivo.
func (c *Copilot) SignIn(ctx context.Context) (copilot.SignInPrompt, error) {
	return c.manager.SignIn(ctx)
}

// SignOut disconnette l'account.
func (c *Copilot) SignOut(ctx context.Context) error { return c.manager.SignOut(ctx) }

// SetActiveWorkspace comunica il progetto attivo, per usare il profilo GitHub a lui legato.
func (c *Copilot) SetActiveWorkspace(root string) { c.manager.SetActiveWorkspace(root) }

// FocusDocument comunica il file attivo nell'editor.
func (c *Copilot) FocusDocument(documentID string) { c.manager.DocumentFocused(documentID) }

// InlineCompletion restituisce il ghost text; annullare la promise annulla la richiesta.
func (c *Copilot) InlineCompletion(ctx context.Context, request copilot.InlineCompletionRequest) ([]copilot.InlineCompletionItem, error) {
	return c.manager.InlineCompletion(ctx, request)
}

// Chat invia un turno Copilot Ask. I delta arrivano come evento copilot.chat; Stop annulla il JSON-RPC.
func (c *Copilot) Chat(ctx context.Context, request copilot.ChatRequest) (copilot.ChatResponse, error) {
	return c.manager.Chat(ctx, request)
}

func (c *Copilot) CancelChat(token string) bool { return c.manager.CancelChat(token) }

func (c *Copilot) DestroyChat(conversationID string) { c.manager.DestroyChat(conversationID) }

// DidShowCompletion, DidAcceptCompletion e DidPartiallyAcceptCompletion restituiscono al server
// l'item così com'era, come richiede il protocollo.
func (c *Copilot) DidShowCompletion(item json.RawMessage) { c.manager.DidShowCompletion(item) }

func (c *Copilot) DidAcceptCompletion(item json.RawMessage) { c.manager.DidAcceptCompletion(item) }

func (c *Copilot) DidPartiallyAcceptCompletion(item json.RawMessage, acceptedLength int) {
	c.manager.DidPartiallyAcceptCompletion(item, acceptedLength)
}

// copilotDocuments adatta il ciclo di vita dei documenti di goide al manager Copilot.
type copilotDocuments struct {
	manager *copilot.Manager
}

func (d copilotDocuments) DocumentOpened(session goide.Session, document goide.Document, text string) {
	// SDK e module cache restano fuori: sono in sola lettura e fuori dal progetto.
	if document.ReadOnly || document.External {
		return
	}
	d.manager.DocumentOpened(copilot.OpenedDocument{
		ID: string(document.ID), URI: document.URI, Root: session.Project.RealPath, RootName: session.Project.Name,
		RelativePath: document.RelativePath, LanguageID: document.Language, Text: text,
	})
}

func (d copilotDocuments) DocumentChanged(documentID goide.DocumentID, version int, text string) {
	d.manager.DocumentChanged(string(documentID), version, text)
}

func (d copilotDocuments) DocumentSaved(documentID goide.DocumentID) {
	d.manager.DocumentSaved(string(documentID))
}

func (d copilotDocuments) DocumentClosed(documentID goide.DocumentID) {
	d.manager.DocumentClosed(string(documentID))
}
