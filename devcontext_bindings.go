package main

import (
	"adomnia/internal/devcontext"
	"adomnia/internal/goide"

	"github.com/wailsapp/wails/v3/pkg/application"
)

// DevContext exposes the project context of gO sessions to the frontend.
type DevContext struct {
	manager *devcontext.Manager
	desktop *application.App
}

func NewDevContext(goIDE *GoIDE) *DevContext {
	d := newDevContext(goIDE.sessionRoot)
	goIDE.onServiceEvent(d.handleGoIDEEvent)
	return d
}

func newDevContext(resolveRoot devcontext.RootResolver) *DevContext {
	d := &DevContext{}
	d.manager = devcontext.NewManager(resolveRoot, func(sessionID string, version int64) {
		if d.desktop != nil {
			d.desktop.Event.Emit("devcontext:changed", map[string]any{"sessionId": sessionID, "version": version})
		}
	})
	return d
}

func (d *DevContext) attachDesktop(desktop *application.App) { d.desktop = desktop }

func (d *DevContext) handleGoIDEEvent(event goide.EventEnvelope) {
	switch event.Type {
	case "document.saved":
		if doc, ok := event.Payload.(goide.Document); ok {
			go d.manager.Invalidate(string(event.SessionID), doc.RelativePath)
		}
	case "session.closed":
		d.manager.Drop(string(event.SessionID))
	}
}

// GetContext returns the context of a gO session, scanning it on first use.
func (d *DevContext) GetContext(sessionID string) (devcontext.Snapshot, error) {
	snapshot, err := d.manager.Get(sessionID)
	if err == nil && globalPluginManager != nil {
		snapshot = devcontext.WithPluginAdapters(snapshot, globalPluginManager.GetContributions())
	}
	return snapshot, err
}

// RescanContext forces a full rescan of the session folder.
func (d *DevContext) RescanContext(sessionID string) (devcontext.Snapshot, error) {
	snapshot, err := d.manager.Rescan(sessionID)
	if err == nil && globalPluginManager != nil {
		snapshot = devcontext.WithPluginAdapters(snapshot, globalPluginManager.GetContributions())
	}
	return snapshot, err
}

// CheckStale rescans files changed outside gO; true when something changed.
func (d *DevContext) CheckStale(sessionID string) (bool, error) {
	return d.manager.CheckStale(sessionID)
}

// ReadContextFile returns an OpenAPI, proto or WSDL document of the session.
func (d *DevContext) ReadContextFile(sessionID, relPath string) (string, error) {
	return d.manager.ReadFile(sessionID, relPath)
}
