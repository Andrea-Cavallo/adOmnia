//go:build windows

package nativeicon

import (
	"golang.org/x/sys/windows"
	"runtime"
	"testing"
	"unsafe"
)

func TestPaletteCreatesRealNativeHandles(t *testing.T) {
	runtime.LockOSThread()
	defer runtime.UnlockOSThread()
	class, _ := windows.UTF16PtrFromString("STATIC")
	hwnd, _, e := user32.NewProc("CreateWindowExW").Call(0, uintptr(unsafe.Pointer(class)), 0, 0, 0, 0, 32, 32, 0, 0, 0, 0)
	if hwnd == 0 {
		t.Fatal(e)
	}
	defer user32.NewProc("DestroyWindow").Call(hwnd)

	pair, err := loadPalettePair("dark", "#F3C600")
	if err != nil {
		t.Fatal(err)
	}
	defer user32.NewProc("DestroyIcon").Call(pair.small)
	defer user32.NewProc("DestroyIcon").Call(pair.large)
	setWindowPalette(hwnd, pair)
	big, _, _ := sendMessage.Call(hwnd, 0x7f, 1, 0)
	small, _, _ := sendMessage.Call(hwnd, 0x7f, 0, 0)
	if big != pair.large || small != pair.small {
		t.Fatal("HWND did not receive palette icon")
	}
	setWindowPalette(hwnd, iconPair{})
	if pair.small == 0 || pair.large == 0 {
		t.Fatal("no taskbar icon handles")
	}
}
