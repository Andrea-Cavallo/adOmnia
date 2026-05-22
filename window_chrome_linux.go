//go:build linux

package main

import (
	"log"
	"os"
)

func configureWindowChromeBackend(mode string) {
	_ = os.Setenv("LC_NUMERIC", "C")

	if mode == windowChromeAppX11 {
		if os.Getenv("GDK_BACKEND") == "" {
			_ = os.Setenv("GDK_BACKEND", "x11")
		}
	} else if mode == windowChromeApp && os.Getenv("XDG_SESSION_TYPE") == "wayland" {
		if os.Getenv("GDK_BACKEND") == "" {
			_ = os.Setenv("GDK_BACKEND", "wayland")
		}
		if os.Getenv("GTK_CSD") == "" {
			_ = os.Setenv("GTK_CSD", "1")
		}
	}
	log.Printf("[window] chrome=%s session=%s gdk=%s gtk_csd=%s lc_numeric=%s", mode, os.Getenv("XDG_SESSION_TYPE"), os.Getenv("GDK_BACKEND"), os.Getenv("GTK_CSD"), os.Getenv("LC_NUMERIC"))
}
