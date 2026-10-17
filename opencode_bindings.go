package main

import (
	"context"

	"adomnia/internal/milk"
	"adomnia/internal/opencode"

	"github.com/wailsapp/wails/v3/pkg/application"
)

// OpenCode espone a React OpenCode come agente ACP di Go Studio. Il client è
// quello di milk (internal/milk); internal/opencode dice solo come avviarlo.
type OpenCode struct {
	manager *milk.Manager
}

// NewOpenCode crea il servizio; l'adapter parte solo con ServiceStartup se attivo.
func NewOpenCode() *OpenCode {
	manager := milk.NewAgentManager(milk.NewSettingsStoreFile(dataDir(), "opencode.json"), opencode.Agent())
	return &OpenCode{manager: manager}
}

func (c *OpenCode) attachDesktop(desktop *application.App) {
	c.manager.SetEmitter(func(event string, payload any) { desktop.Event.Emit(event, payload) })
}

// ServiceStartup avvia OpenCode solo se l'utente lo ha attivato.
func (c *OpenCode) ServiceStartup(context.Context, application.ServiceOptions) error {
	go func() { _ = c.manager.Start() }()
	return nil
}

// ServiceShutdown chiude l'adapter senza lasciare processi orfani.
func (c *OpenCode) ServiceShutdown() error {
	c.manager.Shutdown()
	return nil
}

// Status restituisce lo stato corrente dell'integrazione.
func (c *OpenCode) Status() milk.Status { return c.manager.Status() }

// Settings restituisce la configurazione. Mai credenziali.
func (c *OpenCode) Settings() milk.Settings { return c.manager.Settings() }

// SaveSettings valida, salva e applica la configurazione.
func (c *OpenCode) SaveSettings(settings milk.Settings) (milk.Settings, error) {
	valid, err := opencode.Validate(settings)
	if err != nil {
		return valid, err
	}
	return c.manager.SaveSettings(valid)
}

// Restart riavvia l'adapter azzerando il contatore dei crash.
func (c *OpenCode) Restart() error { return c.manager.Restart() }

// Log restituisce le ultime righe di log dell'adapter.
func (c *OpenCode) Log() []string { return c.manager.Log() }

// SetActiveWorkspace comunica il progetto attivo in Go Studio.
func (c *OpenCode) SetActiveWorkspace(root string) { c.manager.SetActiveWorkspace(root) }

// Prompt invia un turno di chat. I delta arrivano come evento opencode.chat.
func (c *OpenCode) Prompt(ctx context.Context, request milk.PromptRequest) (milk.PromptResponse, error) {
	return c.manager.Prompt(ctx, request)
}

// ResetSession fa ripartire da zero la conversazione di un progetto.
func (c *OpenCode) ResetSession(root string) { c.manager.ResetSession(root) }

// CancelPrompt interrompe il turno individuando la sessione dal token.
func (c *OpenCode) CancelPrompt(token string) { c.manager.CancelPrompt(token) }

// RespondPermission risponde a una richiesta di autorizzazione tool.
func (c *OpenCode) RespondPermission(requestID string, allow bool) {
	c.manager.RespondPermission(requestID, allow)
}

// Models lists only installed local Ollama models.
func (c *OpenCode) Models(ctx context.Context, endpoint string) ([]string, error) {
	return opencode.Models(ctx, endpoint)
}

func (c *OpenCode) CheckModel(ctx context.Context, endpoint, model string) error {
	return opencode.CheckModel(ctx, endpoint, model)
}
