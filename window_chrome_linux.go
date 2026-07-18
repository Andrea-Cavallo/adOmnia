//go:build linux

package main

import (
	"log"
	"os"
	"strings"
)

func configureWindowChromeBackend(mode string) {
	_ = os.Setenv("LC_NUMERIC", "C")

	if shouldForceX11ForAppChrome(mode) {
		if os.Getenv("GDK_BACKEND") == "" {
			_ = os.Setenv("GDK_BACKEND", "x11")
		}
	}
	log.Printf("[window] chrome=%s session=%s gdk=%s gtk_csd=%s lc_numeric=%s", mode, os.Getenv("XDG_SESSION_TYPE"), os.Getenv("GDK_BACKEND"), os.Getenv("GTK_CSD"), os.Getenv("LC_NUMERIC"))
}

func shouldForceX11ForAppChrome(mode string) bool {
	if mode == windowChromeAppX11 {
		return true
	}
	if mode != windowChromeApp {
		return false
	}
	if strings.EqualFold(os.Getenv("XDG_SESSION_TYPE"), "wayland") {
		return true
	}
	return strings.Contains(strings.ToLower(os.Getenv("WAYLAND_DISPLAY")), "wayland")
}
