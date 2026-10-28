package codestudiowindow

import (
	"crypto/sha1"
	"encoding/hex"
	"errors"
	"github.com/Andrea-Cavallo/adOmnia/internal/windowfit"
	"strings"
	"sync"

	"github.com/wailsapp/wails/v3/pkg/application"
	"github.com/wailsapp/wails/v3/pkg/events"
)

const previewWindowPrefix = "go-studio-preview-"

// PreviewWindows possiede le finestre native che mostrano una Live Preview. Sono finestre del
// browser integrato, non di Code Studio: caricano soltanto l'URL locale di un'anteprima in esecuzione.
type PreviewWindows struct {
	app *application.App

	mu      sync.Mutex
	windows map[string]*application.WebviewWindow
}

// NewPreviewWindows crea il registro delle finestre di anteprima.
func NewPreviewWindows(app *application.App) *PreviewWindows {
	return &PreviewWindows{app: app, windows: make(map[string]*application.WebviewWindow)}
}

func previewKey(sessionID, previewID string) string { return sessionID + "\x00" + previewID }

func previewWindowName(key string) string {
	sum := sha1.Sum([]byte(key)) // nosemgrep: go.lang.security.audit.crypto.use_of_weak_crypto.use-of-sha1 -- sha1 is a non-security identifier/fingerprint here
	return previewWindowPrefix + hex.EncodeToString(sum[:6])
}

// Open apre la finestra dell'anteprima, o la riporta in primo piano e la naviga all'URL indicato.
func (p *PreviewWindows) Open(sessionID, previewID, title, url string) error {
	if p == nil || p.app == nil {
		return errors.New("runtime desktop non inizializzato")
	}
	key := previewKey(sessionID, previewID)
	p.mu.Lock()
	if existing, ok := p.windows[key]; ok {
		p.mu.Unlock()
		existing.SetURL(url)
		existing.Restore()
		existing.Focus()
		return nil
	}
	winW, winH, winMinW, winMinH := windowfit.Size(p.app, 1200, 800, 360, 480)
	window := p.app.Window.NewWithOptions(application.WebviewWindowOptions{
		Name: previewWindowName(key), Title: strings.TrimSpace(title + " · Live Preview · adOmnia"),
		Width: winW, Height: winH, MinWidth: winMinW, MinHeight: winMinH, URL: url,
	})
	p.windows[key] = window
	p.mu.Unlock()
	window.RegisterHook(events.Common.WindowClosing, func(*application.WindowEvent) {
		p.mu.Lock()
		if p.windows[key] == window {
			delete(p.windows, key)
		}
		p.mu.Unlock()
	})
	return nil
}

// Close chiude la finestra dell'anteprima, se aperta (l'anteprima si è fermata).
func (p *PreviewWindows) Close(sessionID, previewID string) {
	if p == nil {
		return
	}
	p.mu.Lock()
	window, ok := p.windows[previewKey(sessionID, previewID)]
	p.mu.Unlock()
	if ok {
		window.Close()
	}
}

// CloseAll chiude ogni finestra di anteprima: la finestra principale si sta chiudendo.
func (p *PreviewWindows) CloseAll() {
	if p == nil {
		return
	}
	p.mu.Lock()
	closing := make([]*application.WebviewWindow, 0, len(p.windows))
	for _, window := range p.windows {
		closing = append(closing, window)
	}
	p.mu.Unlock()
	for _, window := range closing {
		window.Close()
	}
}
