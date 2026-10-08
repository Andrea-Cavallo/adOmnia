//go:build linux

package nativeicon

import (
	"os"
	"path/filepath"
	"sync"

	"github.com/wailsapp/wails/v3/pkg/application"
)

var themePath string
var themePathErr error
var themePathOnce sync.Once

func Apply(app *application.App, mode string) error {
	if err := validateMode(mode); err != nil {
		return err
	}
	themePathOnce.Do(func() {
		var base string
		base, themePathErr = os.UserCacheDir()
		if themePathErr != nil {
			return
		}
		themePath = filepath.Join(base, "adomnia", "native-icons")
		dir := themePath
		themePathErr = os.MkdirAll(dir, 0700)
		if themePathErr != nil {
			return
		}
		for _, name := range []string{"dark", "light"} {
			themePathErr = os.WriteFile(filepath.Join(dir, "adomnia-theme-"+name+".png"), pngForMode(name), 0600)
			if themePathErr != nil {
				return
			}
		}
	})
	if themePathErr != nil {
		return themePathErr
	}
	application.InvokeSync(func() {
		for _, window := range app.Window.GetAll() {
			if handle := window.NativeWindow(); handle != nil {
				setThemeIcon(handle, themePath, mode)
			}
		}
	})
	return nil
}
