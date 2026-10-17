package main

import (
	"fmt"

	"adomnia/internal/goide"
	"adomnia/internal/goidewindow"
)

// Live Preview e strumenti web dell'IDE. Solo binding: la logica è in internal/goide (service_web.go),
// internal/ide/preview e internal/languages/web.

// DetectWebProject riconosce progetti web, runtime Node.js e language server disponibili. Non esegue nulla.
func (g *GoIDE) DetectWebProject(sessionID string) (goide.WebProjectReport, error) {
	return g.service.DetectWebProject(sessionID)
}

// StartPreview avvia un'anteprima (server statico o dev server) per un progetto autorizzato.
func (g *GoIDE) StartPreview(sessionID string, request goide.PreviewRequest) (goide.Preview, error) {
	return g.service.StartPreview(sessionID, request)
}

// StopPreview ferma un'anteprima e libera porta e processi.
func (g *GoIDE) StopPreview(sessionID, previewID string) error {
	return g.service.StopPreview(sessionID, previewID)
}

// ListPreviews elenca le anteprime della sessione.
func (g *GoIDE) ListPreviews(sessionID string) ([]goide.Preview, error) {
	return g.service.ListPreviews(sessionID)
}

// DismissPreviews dimentica le anteprime ferme o fallite già mostrate.
func (g *GoIDE) DismissPreviews(sessionID string) error {
	return g.service.DismissPreviews(sessionID)
}

// GetPreviewConfig restituisce l'ultima configurazione di anteprima del progetto.
func (g *GoIDE) GetPreviewConfig(sessionID string) (*goide.PreviewConfig, error) {
	return g.service.GetPreviewConfig(sessionID)
}

// SavePreviewConfig salva posizione, viewport e auto reload dell'anteprima.
func (g *GoIDE) SavePreviewConfig(sessionID string, config goide.PreviewConfig) error {
	return g.service.SavePreviewConfig(sessionID, config)
}

// InstallWebDependencies installa le dipendenze di un progetto web dopo conferma esplicita.
func (g *GoIDE) InstallWebDependencies(sessionID, dir string, confirmed bool) (goide.Execution, error) {
	return g.service.InstallWebDependencies(sessionID, dir, confirmed)
}

// InstallWebTools installa i language server web nella cartella strumenti di adOmnia.
func (g *GoIDE) InstallWebTools(sessionID string, confirmed bool) (goide.Execution, error) {
	return g.service.InstallWebTools(sessionID, confirmed)
}

// WebLanguageServers restituisce la disponibilità dei language server web.
func (g *GoIDE) WebLanguageServers(sessionID string) ([]goide.WebServerInfo, error) {
	return g.service.WebLanguageServers(sessionID)
}

// StartWebLanguageServer avvia il language server di un linguaggio web.
func (g *GoIDE) StartWebLanguageServer(sessionID, languageID string) (goide.LanguageServerStatus, error) {
	return g.service.StartWebLanguageServer(sessionID, languageID)
}

// StopWebLanguageServer ferma il language server di un linguaggio web.
func (g *GoIDE) StopWebLanguageServer(sessionID, languageID string) error {
	return g.service.StopWebLanguageServer(sessionID, languageID)
}

// WebLanguageServerStatus restituisce lo stato del language server di un linguaggio web.
func (g *GoIDE) WebLanguageServerStatus(sessionID, languageID string) (goide.LanguageServerStatus, error) {
	return g.service.WebLanguageServerStatus(sessionID, languageID)
}

// OpenPreviewWindow mostra un'anteprima in esecuzione in una finestra nativa separata.
func (g *GoIDE) OpenPreviewWindow(sessionID, previewID, title string) error {
	if g.previewWindows == nil {
		return fmt.Errorf("runtime desktop non inizializzato")
	}
	url, err := g.service.ReadyPreviewURL(sessionID, previewID)
	if err != nil {
		return err
	}
	return g.previewWindows.Open(sessionID, previewID, title, url)
}

// ClosePreviewWindow chiude la finestra nativa di un'anteprima.
func (g *GoIDE) ClosePreviewWindow(sessionID, previewID string) {
	g.previewWindows.Close(sessionID, previewID)
}

// ReadyPreviewURL restituisce l'URL di un'anteprima pronta (per il browser esterno).
func (g *GoIDE) ReadyPreviewURL(sessionID, previewID string) (string, error) {
	return g.service.ReadyPreviewURL(sessionID, previewID)
}

// attachPreviewWindows crea il registro delle finestre di anteprima e le lega al ciclo di vita delle anteprime.
func (g *GoIDE) attachPreviewWindows() {
	g.previewWindows = goidewindow.NewPreviewWindows(g.desktop)
	g.onServiceEvent(func(event goide.EventEnvelope) {
		current, ok := event.Payload.(goide.Preview)
		if !ok || event.Type != "preview.status" {
			return
		}
		if current.State == "stopped" || current.State == "failed" {
			g.previewWindows.Close(current.SessionID, current.ID)
		}
	})
}
