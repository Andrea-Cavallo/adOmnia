// Package panelwindow owns the native windows that host a single adOmnia
// module (API workspace, Database Studio, Broker Studio…) outside the main
// window. The backend stays shared: each window is just another frontend that
// renders one panel, and every frontend learns which panels are detached from
// ChangedEvent so a module is edited in one window at a time.
package panelwindow

import (
	"errors"
	"fmt"
	"net/url"
	"regexp"
	"sort"
	"strings"
	"sync"

	"github.com/wailsapp/wails/v3/pkg/application"
	"github.com/wailsapp/wails/v3/pkg/events"
)

// ChangedEvent carries the sorted list of detached panels after every open or close.
const ChangedEvent = "panelwindow:changed"

const windowNamePrefix = "panel-"

var panelPattern = regexp.MustCompile(`^[a-z][a-z0-9-]{0,39}$`)

// ValidPanel reports whether id is a safe panel identifier (a rail item id).
func ValidPanel(id string) bool {
	return panelPattern.MatchString(id)
}

// Manager creates, focuses and closes panel windows: at most one per panel.
type Manager struct {
	app       *application.App
	frameless bool

	mu      sync.Mutex
	windows map[string]*application.WebviewWindow
}

// New creates the manager. With frameless the windows have no system title bar:
// the panel header acts as the title bar, as in the main window.
func New(app *application.App, frameless bool) *Manager {
	return &Manager{app: app, frameless: frameless, windows: make(map[string]*application.WebviewWindow)}
}

// Open shows the panel in its own window, or focuses the window already showing it.
func (m *Manager) Open(panel, title string) error {
	if m == nil || m.app == nil {
		return errors.New("desktop runtime not initialised")
	}
	if !ValidPanel(panel) {
		return fmt.Errorf("invalid panel %q", panel)
	}
	m.mu.Lock()
	if existing, ok := m.windows[panel]; ok {
		m.mu.Unlock()
		existing.Restore()
		existing.Focus()
		return nil
	}
	title = strings.TrimSpace(title)
	if title == "" {
		title = panel
	}
	window := m.app.Window.NewWithOptions(application.WebviewWindowOptions{
		Name:      windowNamePrefix + panel,
		Title:     title + " · adOmnia",
		Width:     1280,
		Height:    840,
		MinWidth:  760,
		MinHeight: 520,
		URL:       "/?" + url.Values{"window": {"panel"}, "panel": {panel}}.Encode(),
		Frameless: m.frameless,
	})
	m.windows[panel] = window
	m.mu.Unlock()

	window.RegisterHook(events.Common.WindowClosing, func(_ *application.WindowEvent) {
		m.mu.Lock()
		if m.windows[panel] == window {
			delete(m.windows, panel)
		}
		m.mu.Unlock()
		m.emitChanged()
	})
	m.emitChanged()
	return nil
}

// Focus brings the panel window to the front; false when the panel is not detached.
func (m *Manager) Focus(panel string) bool {
	m.mu.Lock()
	window, ok := m.windows[panel]
	m.mu.Unlock()
	if ok {
		window.Restore()
		window.Focus()
	}
	return ok
}

// Close closes the panel window, returning the panel to the main window.
func (m *Manager) Close(panel string) {
	m.mu.Lock()
	window, ok := m.windows[panel]
	m.mu.Unlock()
	if ok {
		window.Close()
	}
}

// List returns the detached panels, sorted.
func (m *Manager) List() []string {
	m.mu.Lock()
	defer m.mu.Unlock()
	return sortedKeys(m.windows)
}

func (m *Manager) emitChanged() {
	m.app.Event.Emit(ChangedEvent, m.List())
}

func sortedKeys(windows map[string]*application.WebviewWindow) []string {
	panels := make([]string, 0, len(windows))
	for panel := range windows {
		panels = append(panels, panel)
	}
	sort.Strings(panels)
	return panels
}
