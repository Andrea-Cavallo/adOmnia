//go:build windows

package main

import (
	"os"
	"syscall"
)

func init() {
	// The CLI talks over pipes and launches no console tools: allocating a hidden console there cost
	// 50–190 ms (plus a conhost.exe) on every `adomnia mcp` spawn.
	if !isCLICommand(os.Args) {
		ensureHiddenConsole()
	}
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
