//go:build windows

package nativeicon

import (
	"fmt"
	"github.com/wailsapp/wails/v3/pkg/application"
	"strings"
	"unsafe"
)

var currentPalette string
var currentPalettePair iconPair

func loadPalettePair(mode, accent string) (iconPair, error) {
	load := func(size int) (uintptr, error) {
		frame, err := palettePNG(mode, accent, size)
		if err != nil {
			return 0, err
		}
		handle, _, e := createIcon.Call(uintptr(unsafe.Pointer(&frame[0])), uintptr(len(frame)), 1, 0x30000, uintptr(size), uintptr(size), 0) // nosemgrep: go.lang.security.audit.unsafe.use-of-unsafe-block -- required for Win32/cgo interop
		if handle == 0 {
			return 0, fmt.Errorf("create palette icon: %w", e)
		}
		return handle, nil
	}
	small, err := load(16)
	if err != nil {
		return iconPair{}, err
	}
	large, err := load(32)
	if err != nil {
		user32.NewProc("DestroyIcon").Call(small)
		return iconPair{}, err
	}
	return iconPair{small, large}, nil
}

// All owned HWNDs switch before releasing previous custom handles. Keep only one
// palette pair, so dragging the color picker cannot accumulate GDI resources.
func ApplyPalette(app *application.App, mode, accent string) error {
	if err := validateMode(mode); err != nil {
		return err
	}
	if accent != "" {
		if _, err := paletteColor(accent); err != nil {
			return err
		}
	}
	if accent == "" {
		return Apply(app, mode)
	}
	return application.InvokeSyncWithError(func() error {
		iconMutex.Lock()
		defer iconMutex.Unlock()
		key := mode + strings.ToUpper(accent)
		pair := currentPalettePair
		if key != currentPalette {
			var err error
			pair, err = loadPalettePair(mode, accent)
			if err != nil {
				return err
			}
		}
		for _, window := range app.Window.GetAll() {
			if handle := window.NativeWindow(); handle != nil {
				setWindowPalette(uintptr(handle), pair)
			}
		}
		if key != currentPalette {
			old := currentPalettePair
			currentPalettePair = pair
			currentPalette = key
			if old.small != 0 {
				user32.NewProc("DestroyIcon").Call(old.small)
			}
			if old.large != 0 {
				user32.NewProc("DestroyIcon").Call(old.large)
			}
		}
		return nil
	})
}

func setWindowPalette(hwnd uintptr, pair iconPair) {
	sendMessage.Call(hwnd, 0x80, 0, pair.small)
	sendMessage.Call(hwnd, 0x80, 1, pair.large)
}
