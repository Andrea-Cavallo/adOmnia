// Package goidewindow possiede le finestre native separate di Go Studio.
//
// Ogni finestra mostra un solo progetto (sessione). Il backend resta unico e
// condiviso: la finestra ospita soltanto un frontend con i propri buffer, per
// questo il dominio goide registra quale finestra possiede ogni sessione.
package goidewindow

import (
	"errors"
	"fmt"
	"net/url"
	"strings"
	"sync"

	"github.com/wailsapp/wails/v3/pkg/application"
	"github.com/wailsapp/wails/v3/pkg/events"
)

// CloseRequestedEvent è emesso quando una finestra con buffer non salvati viene
// chiusa: il frontend di quella finestra mostra la conferma e poi richiama
// ConfirmClose.
const CloseRequestedEvent = "goide:window-close-requested"

const windowIDPrefix = "go-studio-"

type entry struct {
	window     *application.WebviewWindow
	sessionID  string
	dirty      int
	allowClose bool
}

// Manager crea, mette a fuoco e chiude le finestre Go Studio separate.
type Manager struct {
	app      *application.App
	onClosed func(windowID string)

	mu      sync.Mutex
	windows map[string]*entry
}

// New crea il manager. onClosed viene chiamata a finestra chiusa, per restituire
// le sue sessioni alla finestra principale.
func New(app *application.App, onClosed func(windowID string)) *Manager {
	return &Manager{app: app, onClosed: onClosed, windows: make(map[string]*entry)}
}

// WindowIDFor restituisce l'identificativo stabile della finestra di una
// sessione: riaprirla mette a fuoco la finestra esistente invece di duplicarla.
func WindowIDFor(sessionID string) (string, error) {
	if sessionID == "" || strings.ContainsFunc(sessionID, func(r rune) bool {
		return !(r >= 'a' && r <= 'z' || r >= 'A' && r <= 'Z' || r >= '0' && r <= '9' || r == '-' || r == '_' || r == '.')
	}) {
		return "", fmt.Errorf("sessione non valida per una finestra separata: %q", sessionID)
	}
	return windowIDPrefix + sessionID, nil
}

// Open apre la finestra della sessione o mette a fuoco quella già aperta.
func (m *Manager) Open(sessionID, projectName string) (string, error) {
	if m == nil || m.app == nil {
		return "", errors.New("runtime desktop non inizializzato")
	}
	windowID, err := WindowIDFor(sessionID)
	if err != nil {
		return "", err
	}
	m.mu.Lock()
	if existing, ok := m.windows[windowID]; ok {
		m.mu.Unlock()
		existing.window.Restore()
		existing.window.Focus()
		return windowID, nil
	}
	query := url.Values{"window": {"go-studio"}, "session": {sessionID}, "windowId": {windowID}}
	window := m.app.Window.NewWithOptions(application.WebviewWindowOptions{
		Name:      windowID,
		Title:     strings.TrimSpace(projectName + " · Go Studio · adOmnia"),
		Width:     1400,
		Height:    900,
		MinWidth:  900,
		MinHeight: 600,
		URL:       "/?" + query.Encode(),
	})
	current := &entry{window: window, sessionID: sessionID}
	m.windows[windowID] = current
	m.mu.Unlock()

	window.RegisterHook(events.Common.WindowClosing, func(event *application.WindowEvent) {
		m.mu.Lock()
		if m.windows[windowID] != current {
			m.mu.Unlock()
			return
		}
		if current.dirty > 0 && !current.allowClose {
			dirty := current.dirty
			m.mu.Unlock()
			event.Cancel()
			window.Focus()
			m.app.Event.Emit(CloseRequestedEvent, map[string]any{"windowId": windowID, "dirtyDocumentCount": dirty})
			return
		}
		delete(m.windows, windowID)
		m.mu.Unlock()
		if m.onClosed != nil {
			m.onClosed(windowID)
		}
	})
	return windowID, nil
}

// SetDirtyCount registra quanti buffer non salvati ha la finestra.
func (m *Manager) SetDirtyCount(windowID string, count int) {
	m.mu.Lock()
	defer m.mu.Unlock()
	if current, ok := m.windows[windowID]; ok {
		current.dirty = max(count, 0)
	}
}

// Focus porta in primo piano la finestra indicata.
func (m *Manager) Focus(windowID string) error {
	window, err := m.window(windowID)
	if err != nil {
		return err
	}
	window.Restore()
	window.Focus()
	return nil
}

// RequestClose chiude la finestra passando dalla conferma sui buffer non salvati.
func (m *Manager) RequestClose(windowID string) error {
	window, err := m.window(windowID)
	if err != nil {
		return err
	}
	window.Close()
	return nil
}

// ConfirmClose chiude la finestra dopo che il suo frontend ha salvato o scartato i buffer.
func (m *Manager) ConfirmClose(windowID string) error {
	m.mu.Lock()
	current, ok := m.windows[windowID]
	if ok {
		current.allowClose = true
	}
	m.mu.Unlock()
	if !ok {
		return fmt.Errorf("finestra %q non aperta", windowID)
	}
	current.window.Close()
	return nil
}

// FirstDirty restituisce una finestra con buffer non salvati, se esiste.
func (m *Manager) FirstDirty() (string, int, bool) {
	m.mu.Lock()
	defer m.mu.Unlock()
	for windowID, current := range m.windows {
		if current.dirty > 0 {
			return windowID, current.dirty, true
		}
	}
	return "", 0, false
}

// CloseAll chiude tutte le finestre senza conferma: usato quando la finestra
// principale si chiude e ha già verificato che nessuna abbia buffer non salvati.
func (m *Manager) CloseAll() {
	m.mu.Lock()
	windows := make([]*application.WebviewWindow, 0, len(m.windows))
	for _, current := range m.windows {
		current.allowClose = true
		windows = append(windows, current.window)
	}
	m.mu.Unlock()
	for _, window := range windows {
		window.Close()
	}
}

func (m *Manager) window(windowID string) (*application.WebviewWindow, error) {
	m.mu.Lock()
	defer m.mu.Unlock()
	current, ok := m.windows[windowID]
	if !ok {
		return nil, fmt.Errorf("finestra %q non aperta", windowID)
	}
	return current.window, nil
}
