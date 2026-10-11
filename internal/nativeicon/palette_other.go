//go:build !windows

package nativeicon

import "github.com/wailsapp/wails/v3/pkg/application"

// Non-Windows launchers retain the existing native theme icon policy.
func ApplyPalette(app *application.App, mode, accent string) error {
	if accent != "" {
		if _, err := paletteColor(accent); err != nil {
			return err
		}
	}
	return Apply(app, mode)
}
