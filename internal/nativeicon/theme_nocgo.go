//go:build linux && !cgo

package nativeicon

import "unsafe"

// Linux builds always use cgo (GTK); this stub only keeps cgo-less tooling (gopls) quiet.
func setThemeIcon(unsafe.Pointer, string, string) {}

// Set mirrors the cgo implementation for cgo-less tooling.
func Set(unsafe.Pointer) bool { return false }
