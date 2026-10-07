package main

import (
	"context"

	"adomnia/internal/milk"

	"github.com/wailsapp/wails/v3/pkg/application"
)

// Milk espone a React l'integrazione milk di Go Studio. La logica vive in internal/milk.
type Milk struct {
	manager *milk.Manager
}

// NewMilk crea il servizio; il processo `milk serve --acp` parte solo con ServiceStartup.
func NewMilk() *Milk {
	return &Milk{manager: milk.NewManager(milk.NewSettingsStore(dataDir()))}
}

func (m *Milk) attachDesktop(desktop *application.App) {
	m.manager.SetEmitter(func(event string, payload any) { desktop.Event.Emit(event, payload) })
}

// ServiceStartup avvia milk solo se l'utente lo ha attivato.
func (m *Milk) ServiceStartup(context.Context, application.ServiceOptions) error {
	go func() { _ = m.manager.Start() }()
	return nil
}

// ServiceShutdown chiude il processo milk senza lasciare processi orfani.
func (m *Milk) ServiceShutdown() error {
	m.manager.Shutdown()
	return nil
}

// Status restituisce lo stato corrente dell'integrazione.
func (m *Milk) Status() milk.Status { return m.manager.Status() }

// Settings restituisce la configurazione. Mai credenziali.
func (m *Milk) Settings() milk.Settings { return m.manager.Settings() }

// SaveSettings valida, salva e applica la configurazione.
func (m *Milk) SaveSettings(settings milk.Settings) (milk.Settings, error) {
	return m.manager.SaveSettings(settings)
}

// Install scarica e installa l'ultima release di milk dal repo upstream.
func (m *Milk) Install(ctx context.Context) (milk.Status, error) { return m.manager.Install(ctx) }

// Restart riavvia il processo azzerando il contatore dei crash.
func (m *Milk) Restart() error { return m.manager.Restart() }

// Log restituisce le ultime righe di log del processo.
func (m *Milk) Log() []string { return m.manager.Log() }

// SetActiveWorkspace comunica il progetto attivo in Go Studio.
func (m *Milk) SetActiveWorkspace(root string) { m.manager.SetActiveWorkspace(root) }

// Prompt invia un turno di chat. I delta arrivano come evento milk.chat.
func (m *Milk) Prompt(ctx context.Context, request milk.PromptRequest) (milk.PromptResponse, error) {
	return m.manager.Prompt(ctx, request)
}

// ResetSession fa ripartire da zero la conversazione milk di un progetto.
func (m *Milk) ResetSession(root string) { m.manager.ResetSession(root) }

// CancelSession interrompe il turno in corso su una sessione.
func (m *Milk) CancelSession(sessionID string) { m.manager.CancelSession(sessionID) }

// CancelPrompt interrompe il turno individuando la sessione dal token.
func (m *Milk) CancelPrompt(token string) { m.manager.CancelPrompt(token) }

// RespondPermission risponde a una richiesta di autorizzazione tool.
func (m *Milk) RespondPermission(requestID string, allow bool) {
	m.manager.RespondPermission(requestID, allow)
}

// Agents restituisce gli agenti di milk e i provider con una chiave nell'env (mai i valori).
func (m *Milk) Agents() (milk.AgentsInfo, error) { return milk.Agents() }

// UseProvider aggiunge al config di milk l'agente di un provider rilevato nell'env e lo
// assegna al ruolo (primary | escalation); milk riparte per leggere il config nuovo.
func (m *Milk) UseProvider(id, role string) (milk.AgentsInfo, error) {
	if err := milk.UseProvider(id, role); err != nil {
		return milk.AgentsInfo{}, err
	}
	if m.manager.Settings().Enabled {
		go func() { _ = m.manager.Restart() }()
	}
	return milk.Agents()
}
