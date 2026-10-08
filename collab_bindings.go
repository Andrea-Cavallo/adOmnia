package main

import (
	"encoding/json"
	"time"

	"adomnia/internal/collab"

	"github.com/wailsapp/wails/v3/pkg/application"
)

// Collab espone il Collaboration Engine (internal/collab) al frontend.
// Gli eventi arrivano come "collab:event".
type Collab struct {
	manager *collab.Manager
	desktop *application.App
}

func NewCollab() *Collab {
	c := &Collab{}
	c.manager = collab.NewManager(func(event collab.Event) {
		if c.desktop != nil {
			c.desktop.Event.Emit("collab:event", event)
		}
	})
	return c
}

func (c *Collab) attachDesktop(desktop *application.App) { c.desktop = desktop }

// ServiceShutdown chiude la porta di collaborazione e avvisa i guest.
func (c *Collab) ServiceShutdown() error {
	c.manager.Stop()
	return nil
}

func (c *Collab) Status() collab.Status { return c.manager.Status() }

func (c *Collab) LocalAddresses() []string { return collab.LocalAddresses() }

func (c *Collab) Host(ip string, port int, name string) (collab.Status, error) {
	return c.manager.Host(ip, port, name)
}

func (c *Collab) CreateInvite(role string, ttlMinutes int) (collab.Invite, error) {
	return c.manager.CreateInvite(collab.Role(role), time.Duration(ttlMinutes)*time.Minute)
}

func (c *Collab) Join(code, name string) (collab.Status, error) { return c.manager.Join(code, name) }

func (c *Collab) Stop() { c.manager.Stop() }

func (c *Collab) SetRole(participantID, role string) error {
	return c.manager.SetRole(participantID, collab.Role(role))
}

func (c *Collab) Revoke(participantID string) error { return c.manager.Revoke(participantID) }

// PreviewShare restituisce esattamente ciò che lascerebbe la macchina (segreti già rimossi).
func (c *Collab) PreviewShare(kind, title, dataJSON string) (collab.Share, error) {
	return collab.PreviewShare(collab.ShareKind(kind), title, json.RawMessage(dataJSON))
}

func (c *Collab) Share(kind, title, dataJSON string) (collab.Share, error) {
	return c.manager.Share(collab.ShareKind(kind), title, json.RawMessage(dataJSON))
}
