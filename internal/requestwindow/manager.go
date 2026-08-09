// Package requestwindow owns native detached request-window sessions.
package requestwindow

import (
	"fmt"
	"net/url"
	"strings"
	"sync"

	"github.com/wailsapp/wails/v3/pkg/application"
	"github.com/wailsapp/wails/v3/pkg/events"
)

const (
	eventUpdated  = "request-window:updated"
	eventAttached = "request-window:attached"
)

type Session struct {
	TabID    string `json:"tabId"`
	Snapshot string `json:"snapshot"`
}

// Manager keeps the canonical hand-off snapshot in the single desktop process.
// A detached WebView never creates a second request: it edits this session and
// publishes its newest snapshot to the main window.
type Manager struct {
	app        *application.App
	mainWindow *application.WebviewWindow

	mu       sync.RWMutex
	sessions map[string]Session
	windows  map[string]windowGroup
}

type windowPane string

const (
	paneFull     windowPane = "full"
	paneRequest  windowPane = "request"
	paneResponse windowPane = "response"
)

type windowGroup struct {
	panes map[windowPane]*application.WebviewWindow
}

func New(app *application.App) *Manager {
	return &Manager{app: app, sessions: make(map[string]Session), windows: make(map[string]windowGroup)}
}

func (m *Manager) SetMainWindow(window *application.WebviewWindow) {
	m.mu.Lock()
	defer m.mu.Unlock()
	m.mainWindow = window
}

func (m *Manager) Detach(tabID, snapshot, title string) error {
	tabID = strings.TrimSpace(tabID)
	if tabID == "" || strings.TrimSpace(snapshot) == "" {
		return fmt.Errorf("tab id and request snapshot are required")
	}

	m.mu.Lock()
	if group, ok := m.windows[tabID]; ok {
		m.sessions[tabID] = Session{TabID: tabID, Snapshot: snapshot}
		m.mu.Unlock()
		for _, window := range group.panes {
			window.Restore()
			window.Focus()
		}
		return nil
	}
	m.sessions[tabID] = Session{TabID: tabID, Snapshot: snapshot}
	m.mu.Unlock()

	if strings.TrimSpace(title) == "" {
		title = "API Request · adOmnia"
	}
	window := m.app.Window.NewWithOptions(application.WebviewWindowOptions{
		Name:      "request-" + tabID,
		Title:     title + " · adOmnia",
		Width:     1180,
		Height:    800,
		MinWidth:  720,
		MinHeight: 520,
		URL:       "/?window=api-request&tab=" + url.QueryEscape(tabID),
	})
	window.RegisterHook(events.Common.WindowClosing, func(_ *application.WindowEvent) {
		m.attach(tabID, false)
	})

	m.mu.Lock()
	m.windows[tabID] = windowGroup{panes: map[windowPane]*application.WebviewWindow{paneFull: window}}
	m.mu.Unlock()
	return nil
}

// DetachRequestAndResponse opens two native windows for one tab: one for the
// composer and one for the response. Both windows share the same session, so a
// send or edit in either window is immediately published to the other one.
func (m *Manager) DetachRequestAndResponse(tabID, snapshot, title string) error {
	tabID = strings.TrimSpace(tabID)
	if tabID == "" || strings.TrimSpace(snapshot) == "" {
		return fmt.Errorf("tab id and request snapshot are required")
	}

	m.mu.Lock()
	if group, ok := m.windows[tabID]; ok {
		m.sessions[tabID] = Session{TabID: tabID, Snapshot: snapshot}
		m.mu.Unlock()
		for _, window := range group.panes {
			window.Restore()
			window.Focus()
		}
		return nil
	}
	m.sessions[tabID] = Session{TabID: tabID, Snapshot: snapshot}
	m.mu.Unlock()

	if strings.TrimSpace(title) == "" {
		title = "API Request"
	}
	group := windowGroup{panes: make(map[windowPane]*application.WebviewWindow, 2)}
	for _, spec := range []struct {
		pane     windowPane
		label    string
		width    int
		height   int
		minWidth int
	}{
		{paneRequest, "Request", 760, 860, 620},
		{paneResponse, "Response", 860, 760, 640},
	} {
		window := m.app.Window.NewWithOptions(application.WebviewWindowOptions{
			Name:      "request-" + tabID + "-" + string(spec.pane),
			Title:     title + " - " + spec.label + " - adOmnia",
			Width:     spec.width,
			Height:    spec.height,
			MinWidth:  spec.minWidth,
			MinHeight: 520,
			URL:       "/?window=api-request&tab=" + url.QueryEscape(tabID) + "&pane=" + string(spec.pane),
		})
		window.RegisterHook(events.Common.WindowClosing, func(_ *application.WindowEvent) {
			m.attach(tabID, false)
		})
		group.panes[spec.pane] = window
	}

	m.mu.Lock()
	m.windows[tabID] = group
	m.mu.Unlock()
	return nil
}

func (m *Manager) Snapshot(tabID string) (string, error) {
	m.mu.RLock()
	defer m.mu.RUnlock()
	session, ok := m.sessions[tabID]
	if !ok {
		return "", fmt.Errorf("detached request %q was not found", tabID)
	}
	return session.Snapshot, nil
}

func (m *Manager) Update(tabID, snapshot string) error {
	if strings.TrimSpace(snapshot) == "" {
		return fmt.Errorf("request snapshot is required")
	}
	m.mu.Lock()
	if _, ok := m.sessions[tabID]; !ok {
		m.mu.Unlock()
		return fmt.Errorf("detached request %q was not found", tabID)
	}
	m.sessions[tabID] = Session{TabID: tabID, Snapshot: snapshot}
	mainWindow := m.mainWindow
	group := m.windows[tabID]
	m.mu.Unlock()
	if mainWindow != nil {
		mainWindow.EmitEvent(eventUpdated, Session{TabID: tabID, Snapshot: snapshot})
	}
	for _, window := range group.panes {
		window.EmitEvent(eventUpdated, Session{TabID: tabID, Snapshot: snapshot})
	}
	return nil
}

func (m *Manager) Attach(tabID string) error {
	m.attach(tabID, true)
	return nil
}

func (m *Manager) attach(tabID string, closeWindow bool) {
	m.mu.Lock()
	session, ok := m.sessions[tabID]
	if !ok {
		m.mu.Unlock()
		return
	}
	delete(m.sessions, tabID)
	group := m.windows[tabID]
	delete(m.windows, tabID)
	mainWindow := m.mainWindow
	m.mu.Unlock()

	if mainWindow != nil {
		mainWindow.EmitEvent(eventAttached, session)
		mainWindow.Restore()
		mainWindow.Focus()
	}
	if closeWindow {
		for _, window := range group.panes {
			window.Close()
		}
	}
}
