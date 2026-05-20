//go:build ignore

package main

import (
	"syscall"
	"unsafe"

	"github.com/jchv/go-webview2"
)

// Set dark title bar for the WebView2 window.
// Uses DwmSetWindowAttribute to enable immersive dark mode on Windows 10/11.
func setDarkTitleBar(w webview2.WebView) {
	hwnd := uintptr(w.Window())
	if hwnd == 0 {
		return
	}

	dwmapi := syscall.NewLazyDLL("dwmapi.dll")
	setAttr := dwmapi.NewProc("DwmSetWindowAttribute")

	const DWMWA_USE_IMMERSIVE_DARK_MODE = 20
	darkMode := uintptr(1)

	setAttr.Call(
		uintptr(hwnd),
		DWMWA_USE_IMMERSIVE_DARK_MODE,
		uintptr(unsafe.Pointer(&darkMode)),
		unsafe.Sizeof(darkMode),
	)

	// Also set the title bar background color via DWM
	const DWMWA_CAPTION_COLOR = 35
	const DWMWA_BORDER_COLOR = 34

	// Dark surface color #0E101A (matching tokens.css bg-2)
	// DWM colors are in 0x00BBGGRR format
	darkColor := uintptr(0x001A100E)
	borderColor := uintptr(0x00281315)

	setAttr.Call(
		uintptr(hwnd),
		DWMWA_CAPTION_COLOR,
		uintptr(unsafe.Pointer(&darkColor)),
		unsafe.Sizeof(darkColor),
	)
	setAttr.Call(
		uintptr(hwnd),
		DWMWA_BORDER_COLOR,
		uintptr(unsafe.Pointer(&borderColor)),
		unsafe.Sizeof(borderColor),
	)
}
