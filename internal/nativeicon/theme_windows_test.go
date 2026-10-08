//go:build windows

package nativeicon

import (
	"runtime"
	"testing"
	"unsafe"

	"golang.org/x/sys/windows"
)

// This exercises the actual HWND icon API used by the taskbar, not asset selection.
func TestWindowIconChangesWithTheme(t *testing.T) {
	runtime.LockOSThread()
	defer runtime.UnlockOSThread()
	u := windows.NewLazySystemDLL("user32.dll")
	class, _ := windows.UTF16PtrFromString("STATIC")
	hwnd, _, err := u.NewProc("CreateWindowExW").Call(0, uintptr(unsafe.Pointer(class)), 0, 0, 0, 0, 32, 32, 0, 0, 0, 0)
	if hwnd == 0 {
		t.Fatal(err)
	}
	defer u.NewProc("DestroyWindow").Call(hwnd)
	if err := setWindowMode(hwnd, "dark"); err != nil {
		t.Fatal(err)
	}
	dark, _, _ := sendMessage.Call(hwnd, 0x7f, 1, 0)
	if dark == 0 {
		t.Fatal("dark icon missing")
	}
	darkSmall, _, _ := sendMessage.Call(hwnd, 0x7f, 0, 0)
	if darkSmall == 0 {
		t.Fatal("small dark icon missing")
	}
	if err := setWindowMode(hwnd, "light"); err != nil {
		t.Fatal(err)
	}
	light, _, _ := sendMessage.Call(hwnd, 0x7f, 1, 0)
	if light == 0 || light == dark {
		t.Fatal("native icon did not change")
	}
	lightSmall, _, _ := sendMessage.Call(hwnd, 0x7f, 0, 0)
	if lightSmall == 0 || lightSmall == darkSmall {
		t.Fatal("small native icon did not change")
	}
	if err := setWindowMode(hwnd, "dark"); err != nil {
		t.Fatal(err)
	}
	restored, _, _ := sendMessage.Call(hwnd, 0x7f, 1, 0)
	if restored != dark {
		t.Fatal("dark icon was not restored")
	}
}
