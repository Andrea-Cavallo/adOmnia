package main

import (
	"context"
	"github.com/Andrea-Cavallo/adOmnia/internal/milk"
	"github.com/Andrea-Cavallo/adOmnia/internal/pi"
	"github.com/wailsapp/wails/v3/pkg/application"
)

type PiAgent struct{ manager *milk.Manager }

func NewPiAgent() *PiAgent {
	return &PiAgent{manager: milk.NewAgentManager(milk.NewSettingsStoreFile(dataDir(), "pi.json"), pi.Agent(dataDir()))}
}
func (p *PiAgent) attachDesktop(desktop *application.App) {
	p.manager.SetEmitter(func(event string, payload any) { desktop.Event.Emit(event, payload) })
}
func (p *PiAgent) ServiceStartup(context.Context, application.ServiceOptions) error {
	go func() { _ = p.manager.Start() }()
	return nil
}
func (p *PiAgent) ServiceShutdown() error  { p.manager.Shutdown(); return nil }
func (p *PiAgent) Status() milk.Status     { return p.manager.Status() }
func (p *PiAgent) Settings() milk.Settings { return p.manager.Settings() }
func (p *PiAgent) SaveSettings(settings milk.Settings) (milk.Settings, error) {
	return p.manager.SaveSettings(settings)
}
func (p *PiAgent) Restart() error                 { return p.manager.Restart() }
func (p *PiAgent) Log() []string                  { return p.manager.Log() }
func (p *PiAgent) SetActiveWorkspace(root string) { p.manager.SetActiveWorkspace(root) }
func (p *PiAgent) SessionControls(root string) (milk.SessionControls, error) {
	return p.manager.SessionControls(root)
}
func (p *PiAgent) SetSessionControl(ctx context.Context, root, id string, value any) (milk.SessionControls, error) {
	return p.manager.SetSessionControl(ctx, root, id, value)
}
func (p *PiAgent) Prompt(ctx context.Context, request milk.PromptRequest) (milk.PromptResponse, error) {
	return p.manager.Prompt(ctx, request)
}
func (p *PiAgent) ResetSession(root string)                { p.manager.ResetSession(root) }
func (p *PiAgent) CancelPrompt(token string)               { p.manager.CancelPrompt(token) }
func (p *PiAgent) RespondPermission(id string, allow bool) { p.manager.RespondPermission(id, allow) }
func (p *PiAgent) Install(ctx context.Context) (milk.Status, error) {
	path, err := pi.Install(ctx, dataDir())
	if err != nil {
		return p.manager.Status(), err
	}
	settings := p.manager.Settings()
	settings.BinaryPath = path
	settings.Enabled = true
	if _, err = p.manager.SaveSettings(settings); err != nil {
		return p.manager.Status(), err
	}
	return p.manager.Status(), nil
}
