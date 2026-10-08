//go:build !linux

package windowchrome

// ConfigureBackend prepares the native GTK backend before the window opens (Linux only).
func ConfigureBackend(mode string) {}
