//go:build !linux || gtk3

package main

import "github.com/wailsapp/wails/v3/pkg/application"

// GTK3 already applies Options.Icon; other platforms retain their native icons.
func configureNativeWindowIcon(window *application.WebviewWindow) {}
