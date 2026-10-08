package main

import (
	"adomnia/internal/netpolicy"

	"adomnia/internal/adomniacli"
	"adomnia/internal/browser"
	"adomnia/internal/docker"
	"adomnia/internal/plugins"
	"adomnia/internal/templates"
	"adomnia/internal/themes"
	"adomnia/internal/windowchrome"
	"embed"
	"log"
	"os"
	"path/filepath"
	"runtime"

	"github.com/wailsapp/wails/v3/pkg/application"
)

//go:embed all:frontend/dist
var assets embed.FS

var (
	Version   = "dev"
	BuildDate = "unknown"
	GitCommit = "unknown"
	isDevMode bool
)

const (
	settingsBucket = "workspace"
	settingsKey    = "settings"
)

var startupWindowChrome = windowchrome.ReadStartup(filepath.Join(dataDir(), "adomnia", "adomnia.db"), settingsBucket, settingsKey, runtime.GOOS)

// singleInstanceKey only protects the local hand-off payload between two
// launches. It is not used for application or user data encryption.
var singleInstanceKey = [32]byte{
	0x11, 0x42, 0x3a, 0x7c, 0x24, 0x5e, 0x19, 0x6b,
	0xa5, 0xd2, 0x4f, 0x88, 0x32, 0x71, 0xc6, 0x0d,
	0xf1, 0x57, 0x9a, 0x2e, 0x64, 0xb3, 0x08, 0xdc,
	0x46, 0x95, 0x1f, 0x7a, 0xce, 0x30, 0x5d, 0xe4,
}

func main() {
	if len(os.Args) > 1 && (os.Args[1] == "run" || os.Args[1] == "lint" || os.Args[1] == "stress") {
		os.Exit(adomniacli.Run(os.Args[1:], os.Stdout, os.Stderr))
	}

	netpolicy.Configure(dataDir())
	windowchrome.ConfigureBackend(startupWindowChrome)

	app := NewApp()
	browserDebug := NewBrowserDebug()
	app.browserDebug = browserDebug
	themeManager := NewThemeManager()
	templateStore := NewTemplateStore()
	pluginManager := NewPluginManager()
	globalPluginManager = pluginManager
	wasmRuntime := NewWasmRuntime()
	plugins.AttachRuntime(pluginManager.PluginManager, wasmRuntime.WasmRuntime)
	dockerLab := NewDockerLab()
	aiEngine := NewAIEngine()
	globalAIEngine = aiEngine
	gitSync := NewGitSync(dataDir())
	mcpClient := NewMCPClient()
	mcpServerGenerator := NewMCPServerGenerator()
	collectionFS := NewCollectionFS()
	oasLint := NewOASLint()
	goIDE := NewGoIDE()
	devContext := NewDevContext(goIDE)
	goIDE.service.SetExtensionManager(pluginManager.PluginManager)
	devSession := NewDevSession(goIDE)
	copilotService := NewCopilot(goIDE)
	milkService := NewMilk()
	collabService := NewCollab()

	var mainWindow *application.WebviewWindow
	appOptions := application.Options{
		Name: "adOmnia paratus.",
		Assets: application.AssetOptions{
			Handler: application.BundledAssetFileServer(assets),
		},
		Services: []application.Service{
			application.NewService(app),
			application.NewService(browserDebug),
			application.NewService(themeManager),
			application.NewService(templateStore),
			application.NewService(pluginManager),
			application.NewService(wasmRuntime),
			application.NewService(dockerLab),
			application.NewService(aiEngine),
			application.NewService(gitSync),
			application.NewService(mcpClient),
			application.NewService(mcpServerGenerator),
			application.NewService(collectionFS),
			application.NewService(oasLint),
			application.NewService(goIDE),
			application.NewService(devContext),
			application.NewService(devSession),
			application.NewService(copilotService),
			application.NewService(milkService),
			application.NewService(collabService),
		},
		// Only one process may hold the bbolt lock. Additional launches focus
		// the running main window instead of starting with an empty workspace.
		SingleInstance: &application.SingleInstanceOptions{
			UniqueID:      "com.adomnia.app.single-instance",
			EncryptionKey: singleInstanceKey,
			OnSecondInstanceLaunch: func(_ application.SecondInstanceData) {
				if mainWindow == nil {
					return
				}
				mainWindow.Restore()
				mainWindow.Focus()
			},
		},
		Windows: application.WindowsOptions{
			WebviewUserDataPath: dataDir(),
		},
		Linux: application.LinuxOptions{
			ProgramName: "adomnia",
		},
	}
	applyPlatformOptions(&appOptions)
	desktopApp := application.New(appOptions)
	app.AttachDesktop(desktopApp)
	goIDE.attachDesktop(desktopApp)
	devContext.attachDesktop(desktopApp)
	devSession.attachDesktop(desktopApp)
	copilotService.attachDesktop(desktopApp)
	milkService.attachDesktop(desktopApp)
	collabService.attachDesktop(desktopApp)

	mainWindow = desktopApp.Window.NewWithOptions(application.WebviewWindowOptions{
		Name:      "main",
		Title:     "adOmnia paratus.",
		Width:     1400,
		Height:    900,
		MinWidth:  900,
		MinHeight: 600,
		URL:       "/",
		Frameless: windowchrome.IsApp(startupWindowChrome),
		// Carries over the v2 DragAndDrop.EnableFileDrop behaviour. Without it
		// the drop handlers never fire and App.ReadDroppedFiles is unreachable.
		EnableFileDrop: true,
	})
	configureNativeWindowIcon(mainWindow)
	app.SetMainWindow(mainWindow)
	goIDE.attachMainWindow(mainWindow)
	app.attachPanelWindowsToMain(mainWindow)
	if err := desktopApp.Run(); err != nil {
		log.Fatal("[app] ", err)
	}
}

func dataDir() string {
	dir := os.Getenv("APPDATA")
	if dir == "" {
		home, _ := os.UserHomeDir()
		dir = filepath.Join(home, ".config")
	}
	p := filepath.Join(dir, "adomnia")
	_ = os.MkdirAll(p, 0755)
	return p
}

// The adapters below keep Wails runtime method names under go.main for React.
type BrowserDebug struct{ *browser.BrowserDebug }

func NewBrowserDebug() *BrowserDebug { return &BrowserDebug{BrowserDebug: browser.NewBrowserDebug()} }

type ThemeManager struct{ *themes.ThemeManager }

func NewThemeManager() *ThemeManager { return &ThemeManager{ThemeManager: themes.NewThemeManager()} }

type TemplateStore struct{ *templates.TemplateStore }

func NewTemplateStore() *TemplateStore {
	return &TemplateStore{TemplateStore: templates.NewTemplateStore()}
}

type DockerLab struct{ *docker.DockerLab }

func NewDockerLab() *DockerLab { return &DockerLab{DockerLab: docker.NewDockerLab()} }

type PluginEvent = plugins.PluginEvent
type PluginManager struct{ *plugins.PluginManager }

var globalPluginManager *PluginManager

func NewPluginManager() *PluginManager {
	plugins.Configure(dataDir())
	return &PluginManager{PluginManager: plugins.NewPluginManager()}
}

type WasmRuntime struct{ *plugins.WasmRuntime }

func NewWasmRuntime() *WasmRuntime { return &WasmRuntime{WasmRuntime: plugins.NewWasmRuntime()} }
