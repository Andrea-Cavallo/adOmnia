//go:build linux

package windowchrome

import (
	"os"
	"testing"
)

func TestNativeSessionBackend(t *testing.T) {
	for _, tc := range []struct {
		session, display, want string
	}{
		{"wayland", "wayland-0", "wayland"},
		{"wayland", "", "wayland"},
		{"x11", "", "x11"},
		{"x11", "wayland-0", "x11"},
		{"", "/run/user/1000/custom-socket", "wayland"},
		{"", "", ""},
	} {
		if got := nativeSessionBackend(tc.session, tc.display); got != tc.want {
			t.Errorf("nativeSessionBackend(%q, %q) = %q, want %q", tc.session, tc.display, got, tc.want)
		}
	}
}

func TestWindowChromeUsesNativeBackendForLegacySettings(t *testing.T) {
	t.Setenv("XDG_SESSION_TYPE", "wayland")
	t.Setenv("WAYLAND_DISPLAY", "wayland-0")
	t.Setenv("GDK_BACKEND", "x11")
	t.Setenv("LC_NUMERIC", "C")
	ConfigureBackend(AppX11)
	if got := Normalize(AppX11); got != App {
		t.Fatalf("legacy chrome mode = %q, want app", got)
	}
	if got := os.Getenv("GDK_BACKEND"); got != "wayland" {
		t.Fatalf("GDK_BACKEND = %q, want wayland", got)
	}
}
