package main

import (
	"embed"
	"log"

	"github.com/wailsapp/wails/v2"
	"github.com/wailsapp/wails/v2/pkg/options"
	"github.com/wailsapp/wails/v2/pkg/options/assetserver"
	"github.com/wailsapp/wails/v2/pkg/options/windows"
)

//go:embed all:frontend/dist
var assets embed.FS

func main() {
	app := NewApp()
	browserDebug := NewBrowserDebug()
	app.browserDebug = browserDebug
	themeManager := NewThemeManager()
	templateStore := NewTemplateStore()
	pluginManager := NewPluginManager()
	wasmRuntime := NewWasmRuntime()
	dockerLab := NewDockerLab()
	pythonBridge := NewPythonBridge()

	err := wails.Run(&options.App{
		Title:     "adOmnia paratus.",
		Width:     1400,
		Height:    900,
		MinWidth:  900,
		MinHeight: 600,
		AssetServer: &assetserver.Options{
			Assets: assets,
		},
		OnStartup:  app.OnStartup,
		OnDomReady:  app.OnDomReady,
		OnShutdown: app.OnShutdown,
		Bind: []interface{}{
			app,
			browserDebug,
			themeManager,
			templateStore,
			pluginManager,
			wasmRuntime,
			dockerLab,
			pythonBridge,
		},
		Windows: &windows.Options{
			WebviewIsTransparent:              false,
			WindowIsTranslucent:               false,
			DisableWindowIcon:                 false,
			DisableFramelessWindowDecorations: false,
			WebviewUserDataPath:               dataDir(),
			Theme:                             windows.Dark,
		},
		Frameless: true,
	})
	if err != nil {
		log.Fatal("[app] ", err)
	}
}
