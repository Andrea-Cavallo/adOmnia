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
	"time"

	"github.com/wailsapp/wails/v3/pkg/application"
	"github.com/wailsapp/wails/v3/pkg/events"
)

// ChangedEvent carries the sorted list of detached panels after every open or close.
const ChangedEvent = "panelwindow:changed"

// CloseRequestedEvent asks a panel window (data: the panel id) to write its
// pending saves and then call ConfirmClose: closing never drops queued edits.
const CloseRequestedEvent = "panelwindow:close-requested"

// closeGrace is how long a window may take to confirm before it is closed anyway,
// so a frozen or crashed frontend can never keep its window (or the app) open.
const closeGrace = 3 * time.Second

const windowNamePrefix = "panel-"

var panelPattern = regexp.MustCompile(`^[a-z][a-z0-9-]{0,39}$`)

// ValidPanel reports whether id is a safe panel identifier (a rail item id).
func ValidPanel(id string) bool {
	return panelPattern.MatchString(id)
}

type entry struct {
	window     *application.WebviewWindow
	allowClose bool
	requested  bool
}

// Manager creates, focuses and closes panel windows: at most one per panel.
type Manager struct {
	app       *application.App
	frameless bool

	mu         sync.Mutex
	windows    map[string]*entry
	onAllClose func()
}

// New creates the manager. With frameless the windows have no system title bar:
// the panel header acts as the title bar, as in the main window.
func New(app *application.App, frameless bool) *Manager {
	return &Manager{app: app, frameless: frameless, windows: make(map[string]*entry)}
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
		existing.window.Restore()
		existing.window.Focus()
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
	current := &entry{window: window}
	m.windows[panel] = current
	m.mu.Unlock()

	window.RegisterHook(events.Common.WindowClosing, func(event *application.WindowEvent) {
		if m.holdForSave(panel, current) {
			event.Cancel()
			return
		}
		m.forget(panel, current)
	})
	m.emitChanged()
	return nil
}

// holdForSave cancels the first close and asks the window to save first; true
// when the close must wait for ConfirmClose (or for the grace period).
func (m *Manager) holdForSave(panel string, current *entry) bool {
	m.mu.Lock()
	if m.windows[panel] != current || current.allowClose {
		m.mu.Unlock()
		return false
	}
	alreadyRequested := current.requested
	current.requested = true
	m.mu.Unlock()
	if !alreadyRequested {
		m.app.Event.Emit(CloseRequestedEvent, panel)
		time.AfterFunc(closeGrace, func() { m.forceClose(panel, current) })
	}
	return true
}

func (m *Manager) forceClose(panel string, current *entry) {
	m.mu.Lock()
	open := m.windows[panel] == current
	current.allowClose = true
	m.mu.Unlock()
	if open {
		current.window.Close()
	}
}

func (m *Manager) forget(panel string, current *entry) {
	m.mu.Lock()
	if m.windows[panel] == current {
		delete(m.windows, panel)
	}
	var done func()
	if len(m.windows) == 0 && m.onAllClose != nil {
		done, m.onAllClose = m.onAllClose, nil
	}
	m.mu.Unlock()
	m.emitChanged()
	if done != nil {
		// Outside the closing hook: done usually closes another window.
		go done()
	}
}

// ConfirmClose closes the panel window once its frontend has written its pending saves.
func (m *Manager) ConfirmClose(panel string) {
	m.mu.Lock()
	current, ok := m.windows[panel]
	if ok {
		current.allowClose = true
	}
	m.mu.Unlock()
	if ok {
		current.window.Close()
	}
}

// Focus brings the panel window to the front; false when the panel is not detached.
func (m *Manager) Focus(panel string) bool {
	m.mu.Lock()
	current, ok := m.windows[panel]
	m.mu.Unlock()
	if ok {
		current.window.Restore()
		current.window.Focus()
	}
	return ok
}

// Close closes the panel window, returning the panel to the main window. The
// window saves first (see CloseRequestedEvent).
func (m *Manager) Close(panel string) {
	m.mu.Lock()
	current, ok := m.windows[panel]
	m.mu.Unlock()
	if ok {
		current.window.Close()
	}
}

// CloseAllThen closes every panel window, each saving first, and then calls done.
// It returns false, without calling done, when no panel window is open.
func (m *Manager) CloseAllThen(done func()) bool {
	if m == nil {
		return false
	}
	m.mu.Lock()
	if len(m.windows) == 0 {
		m.mu.Unlock()
		return false
	}
	m.onAllClose = done
	windows := make([]*application.WebviewWindow, 0, len(m.windows))
	for _, current := range m.windows {
		windows = append(windows, current.window)
	}
	m.mu.Unlock()
	for _, window := range windows {
		window.Close()
	}
	return true
}

// List returns the detached panels, sorted.
func (m *Manager) List() []string {
	m.mu.Lock()
	defer m.mu.Unlock()
	panels := make([]string, 0, len(m.windows))
	for panel := range m.windows {
		panels = append(panels, panel)
	}
	sort.Strings(panels)
	return panels
}

func (m *Manager) emitChanged() {
	m.app.Event.Emit(ChangedEvent, m.List())
}
