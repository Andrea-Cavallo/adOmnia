package main

import (
	"context"

	"adomnia/internal/claudecode"
	"adomnia/internal/milk"

	"github.com/wailsapp/wails/v3/pkg/application"
)

// ClaudeCode espone a React Claude Code come agente ACP di Go Studio. Il client è
// quello di milk (internal/milk); internal/claudecode dice solo come avviarlo.
type ClaudeCode struct {
	manager *milk.Manager
}

// NewClaudeCode crea il servizio; l'adapter parte solo con ServiceStartup se attivo.
func NewClaudeCode() *ClaudeCode {
	return &ClaudeCode{manager: milk.NewAgentManager(milk.NewSettingsStoreFile(dataDir(), "claude-code.json"), claudecode.Agent())}
}

func (c *ClaudeCode) attachDesktop(desktop *application.App) {
	c.manager.SetEmitter(func(event string, payload any) { desktop.Event.Emit(event, payload) })
}

// ServiceStartup avvia Claude Code solo se l'utente lo ha attivato.
func (c *ClaudeCode) ServiceStartup(context.Context, application.ServiceOptions) error {
	go func() { _ = c.manager.Start() }()
	return nil
}

// ServiceShutdown chiude l'adapter senza lasciare processi orfani.
func (c *ClaudeCode) ServiceShutdown() error {
	c.manager.Shutdown()
	return nil
}

// Status restituisce lo stato corrente dell'integrazione.
func (c *ClaudeCode) Status() milk.Status { return c.manager.Status() }

// Settings restituisce la configurazione. Mai credenziali.
func (c *ClaudeCode) Settings() milk.Settings { return c.manager.Settings() }

// SaveSettings valida, salva e applica la configurazione.
func (c *ClaudeCode) SaveSettings(settings milk.Settings) (milk.Settings, error) {
	return c.manager.SaveSettings(settings)
}

// Restart riavvia l'adapter azzerando il contatore dei crash.
func (c *ClaudeCode) Restart() error { return c.manager.Restart() }

// Log restituisce le ultime righe di log dell'adapter.
func (c *ClaudeCode) Log() []string { return c.manager.Log() }

// SetActiveWorkspace comunica il progetto attivo in Go Studio.
func (c *ClaudeCode) SetActiveWorkspace(root string) { c.manager.SetActiveWorkspace(root) }

// Prompt invia un turno di chat. I delta arrivano come evento claude.chat.
func (c *ClaudeCode) Prompt(ctx context.Context, request milk.PromptRequest) (milk.PromptResponse, error) {
	return c.manager.Prompt(ctx, request)
}

// ResetSession fa ripartire da zero la conversazione di un progetto.
func (c *ClaudeCode) ResetSession(root string) { c.manager.ResetSession(root) }

// CancelPrompt interrompe il turno individuando la sessione dal token.
func (c *ClaudeCode) CancelPrompt(token string) { c.manager.CancelPrompt(token) }

// RespondPermission risponde a una richiesta di autorizzazione tool.
func (c *ClaudeCode) RespondPermission(requestID string, allow bool) {
	c.manager.RespondPermission(requestID, allow)
}

// Inspect mostra quale backend (account, API key, Bedrock, Vertex, Foundry, gateway) e quale
// modello Claude Code userà nel progetto root, letti dai suoi settings. Mai i valori dei segreti.
func (c *ClaudeCode) Inspect(root string) claudecode.Config {
	return claudecode.Inspect(root, c.manager.Settings().IgnoreAPIKey)
}
