package main

import "fmt"

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

// ListPanelWindows returns the modules currently shown in their own window.
func (a *App) ListPanelWindows() []string {
	if a.panelWindows == nil {
		return []string{}
	}
	return a.panelWindows.List()
}
