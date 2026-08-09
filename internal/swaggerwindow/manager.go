// Package swaggerwindow owns the standalone native OpenAPI editor window.
package swaggerwindow

import (
	"sync"

	"github.com/wailsapp/wails/v3/pkg/application"
	"github.com/wailsapp/wails/v3/pkg/events"
)

// Manager keeps a single reusable Swagger editor window. The editor draft is
// already stored locally by the frontend, so reopening the window preserves the
// user's work without duplicating a remote or in-memory document model.
type Manager struct {
	app *application.App

	mu     sync.Mutex
	window *application.WebviewWindow
}

func New(app *application.App) *Manager {
	return &Manager{app: app}
}

// Open creates the standalone editor or focuses the existing one.
func (m *Manager) Open() {
	m.mu.Lock()
	if m.window != nil {
		window := m.window
		m.mu.Unlock()
		window.Restore()
		window.Focus()
		return
	}

	window := m.app.Window.NewWithOptions(application.WebviewWindowOptions{
		Name:      "swagger-editor",
		Title:     "Swagger Editor · adOmnia",
		Width:     1320,
		Height:    880,
		MinWidth:  800,
		MinHeight: 560,
		URL:       "/?window=swagger-editor",
	})
	m.window = window
	m.mu.Unlock()

	window.RegisterHook(events.Common.WindowClosing, func(_ *application.WindowEvent) {
		m.mu.Lock()
		if m.window == window {
			m.window = nil
		}
		m.mu.Unlock()
	})
}
