//go:build !windows && !linux

package nativeicon

import "github.com/wailsapp/wails/v3/pkg/application"

func Apply(app *application.App, mode string) error {
	if err := validateMode(mode); err != nil {
		return err
	}
	application.InvokeSync(func() { app.SetIcon(pngForMode(mode)) })
	return nil
}
