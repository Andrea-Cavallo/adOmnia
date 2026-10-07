package main

import (
	"adomnia/internal/panelwindow"
	"fmt"

	"github.com/wailsapp/wails/v3/pkg/application"
	"github.com/wailsapp/wails/v3/pkg/events"
)

// OpenStudioToolWindow opens a view of a live project's tool, never a new project.
func (a *App) OpenStudioToolWindow(sessionID, tool, title string) error {
	if a.panelWindows == nil {
		return fmt.Errorf("desktop runtime is not initialized")
	}
	return a.panelWindows.OpenTool(sessionID, tool, title)
}

func (a *App) CloseStudioToolWindow(sessionID, tool string) {
	if key, err := panelwindow.ToolWindowKey(sessionID, tool); err == nil && a.panelWindows != nil {
		a.panelWindows.Close(key)
	}
}

// OpenPanelWindow shows a module (rail item) in its own native window, or focuses it.
func (a *App) OpenPanelWindow(panel, title string) error {
	if a.panelWindows == nil {
		return fmt.Errorf("desktop runtime is not initialized")
	}
	return a.panelWindows.Open(panel, title)
}

// FocusPanelWindow brings a detached module to the front; false when it is not detached.
func (a *App) FocusPanelWindow(panel string) bool {
	return a.panelWindows != nil && a.panelWindows.Focus(panel)
}

// ClosePanelWindow closes the module window, returning the module to the main window.
func (a *App) ClosePanelWindow(panel string) {
	if a.panelWindows != nil {
		a.panelWindows.Close(panel)
	}
}

// ConfirmPanelWindowClose closes a module window after it has written its pending saves.
func (a *App) ConfirmPanelWindowClose(panel string) {
	if a.panelWindows != nil {
		a.panelWindows.ConfirmClose(panel)
	}
}

// attachPanelWindowsToMain closes the module windows, each saving first, before
// the main window: adOmnia never keeps running with only a module window left.
// Registered after Go Studio's hook, which may cancel the close for unsaved files.
func (a *App) attachPanelWindowsToMain(window *application.WebviewWindow) {
	window.RegisterHook(events.Common.WindowClosing, func(event *application.WindowEvent) {
		if a.panelWindows != nil && a.panelWindows.CloseAllThen(window.Close) {
			event.Cancel()
		}
	})
}

// ListPanelWindows returns the modules currently shown in their own window.
func (a *App) ListPanelWindows() []string {
	if a.panelWindows == nil {
		return []string{}
	}
	return a.panelWindows.List()
}

// FocusMainWindow brings the main adOmnia window to the front, for actions sent from a detached window.
func (a *App) FocusMainWindow() {
	if a.mainWindow != nil {
		a.mainWindow.Restore()
		a.mainWindow.Focus()
	}
}
