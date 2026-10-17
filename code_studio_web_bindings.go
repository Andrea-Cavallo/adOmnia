package main

import (
	"fmt"

	"adomnia/internal/codestudio"
	"adomnia/internal/codestudiowindow"
)

// Live Preview e strumenti web dell'IDE. Solo binding: la logica è in internal/codestudio (service_web.go),
// internal/ide/preview e internal/languages/web.

// DetectWebProject riconosce progetti web, runtime Node.js e language server disponibili. Non esegue nulla.
func (g *GoIDE) DetectWebProject(sessionID string) (codestudio.WebProjectReport, error) {
	return g.service.DetectWebProject(sessionID)
}

// StartPreview avvia un'anteprima (server statico o dev server) per un progetto autorizzato.
func (g *GoIDE) StartPreview(sessionID string, request codestudio.PreviewRequest) (codestudio.Preview, error) {
	return g.service.StartPreview(sessionID, request)
}

// StopPreview ferma un'anteprima e libera porta e processi.
func (g *GoIDE) StopPreview(sessionID, previewID string) error {
	return g.service.StopPreview(sessionID, previewID)
}

// ListPreviews elenca le anteprime della sessione.
func (g *GoIDE) ListPreviews(sessionID string) ([]codestudio.Preview, error) {
	return g.service.ListPreviews(sessionID)
}

// DismissPreviews dimentica le anteprime ferme o fallite già mostrate.
func (g *GoIDE) DismissPreviews(sessionID string) error {
	return g.service.DismissPreviews(sessionID)
}

// GetPreviewConfig restituisce l'ultima configurazione di anteprima del progetto.
func (g *GoIDE) GetPreviewConfig(sessionID string) (*codestudio.PreviewConfig, error) {
	return g.service.GetPreviewConfig(sessionID)
}

// SavePreviewConfig salva posizione, viewport e auto reload dell'anteprima.
func (g *GoIDE) SavePreviewConfig(sessionID string, config codestudio.PreviewConfig) error {
	return g.service.SavePreviewConfig(sessionID, config)
}

// InstallWebDependencies installa le dipendenze di un progetto web dopo conferma esplicita.
func (g *GoIDE) InstallWebDependencies(sessionID, dir string, confirmed bool) (codestudio.Execution, error) {
	return g.service.InstallWebDependencies(sessionID, dir, confirmed)
}

// ProvidedLanguageServers restituisce la disponibilità dei language server gestiti da adOmnia (web, Java…).
func (g *GoIDE) ProvidedLanguageServers(sessionID string) ([]codestudio.LanguageServerInfo, error) {
	return g.service.ProvidedLanguageServers(sessionID)
}

// StartProvidedLanguageServer avvia il language server gestito di un linguaggio.
func (g *GoIDE) StartProvidedLanguageServer(sessionID, languageID string) (codestudio.LanguageServerStatus, error) {
	return g.service.StartProvidedLanguageServer(sessionID, languageID)
}

// StopProvidedLanguageServer ferma il language server gestito di un linguaggio.
func (g *GoIDE) StopProvidedLanguageServer(sessionID, languageID string) error {
	return g.service.StopProvidedLanguageServer(sessionID, languageID)
}

// ProvidedLanguageServerStatus restituisce lo stato del language server gestito di un linguaggio.
func (g *GoIDE) ProvidedLanguageServerStatus(sessionID, languageID string) (codestudio.LanguageServerStatus, error) {
	return g.service.ProvidedLanguageServerStatus(sessionID, languageID)
}

// PreviewServerInstall mostra il comando esatto dell'installazione del language server, senza eseguirlo.
func (g *GoIDE) PreviewServerInstall(sessionID, languageID string) (codestudio.ServerInstallPreview, error) {
	return g.service.PreviewServerInstall(sessionID, languageID)
}

// InstallProvidedLanguageServer installa il language server nella cartella strumenti dopo conferma esplicita.
func (g *GoIDE) InstallProvidedLanguageServer(sessionID, languageID string, confirmed bool) (codestudio.Execution, error) {
	return g.service.InstallProvidedLanguageServer(sessionID, languageID, confirmed)
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
	g.previewWindows = codestudiowindow.NewPreviewWindows(g.desktop)
	g.onServiceEvent(func(event codestudio.EventEnvelope) {
		current, ok := event.Payload.(codestudio.Preview)
		if !ok || event.Type != "preview.status" {
			return
		}
		if current.State == "stopped" || current.State == "failed" {
			g.previewWindows.Close(current.SessionID, current.ID)
		}
	})
}
