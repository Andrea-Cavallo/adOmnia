//go:build linux

package windowchrome

import (
	"log"
	"os"
	"strings"
)

// ConfigureBackend prepares the native GTK backend before the window opens (Linux only).
func ConfigureBackend(mode string) {
	_ = os.Setenv("LC_NUMERIC", "C")

	if backend := nativeSessionBackend(os.Getenv("XDG_SESSION_TYPE"), os.Getenv("WAYLAND_DISPLAY")); backend != "" {
		_ = os.Setenv("GDK_BACKEND", backend)
	}
	log.Printf("[window] chrome=%s session=%s gdk=%s gtk_csd=%s lc_numeric=%s", mode, os.Getenv("XDG_SESSION_TYPE"), os.Getenv("GDK_BACKEND"), os.Getenv("GTK_CSD"), os.Getenv("LC_NUMERIC"))
}

func nativeSessionBackend(session, waylandDisplay string) string {
	switch strings.ToLower(session) {
	case "wayland":
		return "wayland"
	case "x11":
		return "x11"
	default:
		if waylandDisplay != "" {
			return "wayland"
		}
		return ""
	}
}
