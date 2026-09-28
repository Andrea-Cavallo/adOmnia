package main

import (
	"adomnia/internal/goide"
	"adomnia/internal/storage"
	"fmt"
	"strings"

	"github.com/wailsapp/wails/v3/pkg/application"
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
	service *goide.Service
	desktop *application.App
}

func NewGoIDE() *GoIDE {
	var binding *GoIDE
	service := goide.NewService(goIDEStore{}, func(event goide.EventEnvelope) {
		if binding != nil && binding.desktop != nil {
			binding.desktop.Event.Emit("goide:event", event)
		}
	})
	binding = &GoIDE{service: service}
	return binding
}

func (g *GoIDE) attachDesktop(desktop *application.App) {
	g.desktop = desktop
}

// GetCapabilities restituisce soltanto le capacità Go Studio realmente disponibili.
func (g *GoIDE) GetCapabilities() goide.Capabilities {
	return g.service.GetCapabilities()
}

// OpenProject registra una cartella locale senza avviarne codice o strumenti.
func (g *GoIDE) OpenProject(path string) (goide.Session, error) {
	return g.service.OpenProject(path)
}

// ListSessions restituisce le sessioni Go Studio correnti e ripristinate.
func (g *GoIDE) ListSessions() ([]goide.Session, error) {
	return g.service.ListSessions()
}

// SetToolAuthorization registra il consenso esplicito all'uso degli strumenti.
func (g *GoIDE) SetToolAuthorization(id string, allowed bool) (goide.Session, error) {
	return g.service.SetToolAuthorization(id, allowed)
}

// CloseSession chiude una sessione senza modificare la cartella del progetto.
func (g *GoIDE) CloseSession(id string) error {
	return g.service.CloseSession(id)
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

// ServiceShutdown rilascia processi e risorse posseduti dal servizio.
func (g *GoIDE) ServiceShutdown() error {
	g.service.Shutdown()
	return nil
}
