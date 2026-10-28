package main

import (
	"context"
	"encoding/json"
	"time"

	"github.com/Andrea-Cavallo/adOmnia/internal/collab"

	"github.com/wailsapp/wails/v3/pkg/application"
)

// Collab espone il Collaboration Engine (internal/collab) al frontend.
// Gli eventi arrivano come "collab:event".
type Collab struct {
	manager     *collab.Manager
	desktop     *application.App
	sessionRoot func(string) (string, error)
}

func NewCollab(root func(string) (string, error)) *Collab {
	c := &Collab{sessionRoot: root}
	c.manager = collab.NewPersistentManager(func(event collab.Event) {
		if c.desktop != nil {
			c.desktop.Event.Emit("collab:event", event)
		}
	})
	return c
}

func (c *Collab) attachDesktop(desktop *application.App) { c.desktop = desktop }

// ServiceStartup loads recovery after the application service has opened bbolt.
func (c *Collab) ServiceStartup(context.Context, application.ServiceOptions) error {
	c.manager.Restore()
	return nil
}

// ServiceShutdown preserves recovery while closing the active transports.
func (c *Collab) ServiceShutdown() error {
	c.manager.Shutdown()
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

func (c *Collab) Stop()                          { c.manager.Stop() }
func (c *Collab) Resume() (collab.Status, error) { return c.manager.Resume() }
func (c *Collab) SyncCollection(sourceID, title, dataJSON string) (collab.Share, error) {
	return c.manager.SyncCollection(sourceID, title, json.RawMessage(dataJSON))
}

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

func (c *Collab) PreviewShareWithSecrets(kind, title, dataJSON string, variables []string) (collab.Share, error) {
	return collab.PreviewShareWithSecrets(collab.ShareKind(kind), title, json.RawMessage(dataJSON), variables)
}

func (c *Collab) ShareWithSecrets(kind, title, dataJSON string, variables []string) (collab.Share, error) {
	return c.manager.ShareWithSecrets(collab.ShareKind(kind), title, json.RawMessage(dataJSON), variables)
}

func (c *Collab) OpenDocument(id, initial string) error { return c.manager.OpenDocument(id, initial) }

func (c *Collab) Document(message collab.DocumentMessage) error { return c.manager.Document(message) }
func (c *Collab) DocumentUpdates(id string) (collab.DocumentMessage, error) {
	return c.manager.DocumentUpdates(id)
}

func (c *Collab) SaveInbox(data string) error { return c.manager.SaveInbox(data) }
func (c *Collab) Inbox() (string, error)      { return c.manager.Inbox() }
func (c *Collab) SaveDocumentBaseline(id, data string) error {
	return c.manager.SaveDocumentBaseline(id, data)
}
func (c *Collab) DocumentBaseline(id string) (string, error) {
	return c.manager.DocumentBaseline(id)
}
func (c *Collab) DeleteDocumentBaseline(id string) error {
	return c.manager.DeleteDocumentBaseline(id)
}

func (c *Collab) ShareProject(sessionID string) (collab.ProjectInfo, error) {
	root, err := c.sessionRoot(sessionID)
	if err != nil {
		return collab.ProjectInfo{}, err
	}
	return c.manager.ShareProject(root, sessionID)
}
func (c *Collab) ProjectTree() ([]collab.ProjectEntry, error) { return c.manager.ProjectTree() }
func (c *Collab) ReadProjectFile(path string) (collab.ProjectFile, error) {
	return c.manager.ReadProjectFile(path)
}
func (c *Collab) ValidateProjectDocument(path, content string) error {
	return c.manager.ValidateProjectDocument(path, content)
}
