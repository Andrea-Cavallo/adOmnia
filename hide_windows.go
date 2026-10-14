//go:build windows

package main

import "syscall"

func init() {
	ensureHiddenConsole()
}

func ensureHiddenConsole() {
	kernel32 := syscall.NewLazyDLL("kernel32.dll")
	user32 := syscall.NewLazyDLL("user32.dll")

	getConsoleWindow := kernel32.NewProc("GetConsoleWindow")
	allocConsole := kernel32.NewProc("AllocConsole")
	showWindow := user32.NewProc("ShowWindow")

	hwnd, _, _ := getConsoleWindow.Call()
	if hwnd == 0 {
		allocConsole.Call()
		hwnd, _, _ = getConsoleWindow.Call()
	}
	if hwnd != 0 {
		const swHide = 0
		showWindow.Call(hwnd, swHide)
	}
}
