//go:build linux && !gtk3

package main

import (
	"log"

	"github.com/Andrea-Cavallo/adOmnia/internal/nativeicon"
	"github.com/wailsapp/wails/v3/pkg/application"
	"github.com/wailsapp/wails/v3/pkg/events"
)

func configureNativeWindowIcon(window *application.WebviewWindow) {
	window.OnWindowEvent(events.Common.WindowRuntimeReady, func(_ *application.WindowEvent) {
		application.InvokeSync(func() {
			if !nativeicon.Set(window.NativeWindow()) {
				log.Print("[window] unable to set embedded GTK icon")
			}
		})
	})
}
