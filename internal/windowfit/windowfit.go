// Package windowfit keeps new windows inside the primary screen's work area,
// so small or low-resolution displays never open a window with its title bar
// controls off-screen.
package windowfit

import "github.com/wailsapp/wails/v3/pkg/application"

// Size clamps the requested size and minimum size to the primary work area.
// With no screen information it returns the inputs unchanged.
func Size(app *application.App, width, height, minWidth, minHeight int) (w, h, minW, minH int) {
	if app == nil || app.Screen == nil {
		return width, height, minWidth, minHeight
	}
	screen := app.Screen.GetPrimary()
	if screen == nil || screen.WorkArea.Width <= 0 || screen.WorkArea.Height <= 0 {
		return width, height, minWidth, minHeight
	}
	return fit(width, height, minWidth, minHeight, screen.WorkArea.Width, screen.WorkArea.Height)
}

// fit limits size and minimum size to a maxW x maxH work area: on a small
// screen the window opens fully visible instead of larger than the display,
// and its minimum never forces it off-screen either.
func fit(width, height, minWidth, minHeight, maxW, maxH int) (w, h, minW, minH int) {
	return min(width, maxW), min(height, maxH), min(minWidth, maxW), min(minHeight, maxH)
}
