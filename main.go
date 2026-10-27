// Command adomnia is the adOmnia desktop application, a local-first API development toolbox and IDE built on Wails 3.
//
// The root package only wires Wails services and their bindings; feature logic lives in the internal packages.
package main

import (
	"github.com/Andrea-Cavallo/adOmnia/internal/netpolicy"
	"github.com/Andrea-Cavallo/adOmnia/internal/resources"
	"github.com/Andrea-Cavallo/adOmnia/internal/update"
	"github.com/Andrea-Cavallo/adOmnia/internal/windowfit"

	"embed"
	"github.com/Andrea-Cavallo/adOmnia/internal/adomniacli"
	"github.com/Andrea-Cavallo/adOmnia/internal/browser"
	"github.com/Andrea-Cavallo/adOmnia/internal/devlog"
	"github.com/Andrea-Cavallo/adOmnia/internal/docker"
	"github.com/Andrea-Cavallo/adOmnia/internal/plugins"
	"github.com/Andrea-Cavallo/adOmnia/internal/templates"
	"github.com/Andrea-Cavallo/adOmnia/internal/themes"
	"github.com/Andrea-Cavallo/adOmnia/internal/windowchrome"
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

// startupWindowChrome is read in main, after the CLI dispatch: reading it at package init made every
// `adomnia mcp|run|stress` wait the 250 ms bbolt lock timeout while the desktop app held the database.
var startupWindowChrome string

// singleInstanceKey only protects the local hand-off payload between two
// launches. It is not used for application or user data encryption.
var singleInstanceKey = [32]byte{
	0x11, 0x42, 0x3a, 0x7c, 0x24, 0x5e, 0x19, 0x6b,
	0xa5, 0xd2, 0x4f, 0x88, 0x32, 0x71, 0xc6, 0x0d,
	0xf1, 0x57, 0x9a, 0x2e, 0x64, 0xb3, 0x08, 0xdc,
	0x46, 0x95, 0x1f, 0x7a, 0xce, 0x30, 0x5d, 0xe4,
}

// isCLICommand reports whether the process runs a headless subcommand instead of the desktop app.
func isCLICommand(args []string) bool {
	if len(args) < 2 {
		return false
	}
	switch args[1] {
	case "run", "lint", "stress", "mcp":
		return true
	}
	return false
}

func main() {
	if len(os.Args) == 3 && os.Args[1] == "--adomnia-update-helper" {
		if err := update.RunHelper(os.Args[2], Version); err != nil {
			log.Print("[update] ", err)
			os.Exit(1)
		}
		return
	}
	if isCLICommand(os.Args) {
		os.Exit(adomniacli.Run(os.Args[1:], os.Stdout, os.Stderr))
	}

	netpolicy.Configure(dataDir())
	if err := resources.ConfigureRuntime(filepath.Join(dataDir(), "resource-settings.json")); err != nil {
		log.Printf("[resources] memory settings: %v", err)
	}
	startupWindowChrome = windowchrome.ReadStartup(filepath.Join(dataDir(), "adomnia", "adomnia.db"), settingsBucket, settingsKey, runtime.GOOS)
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
	mcpServerGenerator := NewMCPServerGenerator()
	collectionFS := NewCollectionFS()
	oasLint := NewOASLint()
	securityIntel := NewSecurityIntel()
	goIDE := NewGoIDE()
	devContext := NewDevContext(goIDE)
	goIDE.service.SetExtensionManager(pluginManager.PluginManager)
	devSession := NewDevSession(goIDE)
	copilotService := NewCopilot(goIDE)
	milkService := NewMilk()
	claudeService := NewClaudeCode()
	milkService.manager.SetTurnObserver(goIDE.agentReview)
	claudeService.manager.SetTurnObserver(goIDE.agentReview)
	collabService := NewCollab(goIDE.sessionRoot)

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
			application.NewService(mcpServerGenerator),
			application.NewService(collectionFS),
			application.NewService(oasLint),
			application.NewService(securityIntel),
			application.NewService(goIDE),
			application.NewService(devContext),
			application.NewService(devSession),
			application.NewService(copilotService),
			application.NewService(milkService),
			application.NewService(claudeService),
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
	claudeService.attachDesktop(desktopApp)
	collabService.attachDesktop(desktopApp)

	winW, winH, winMinW, winMinH := windowfit.Size(desktopApp, 1400, 900, 900, 600)
	mainWindow = desktopApp.Window.NewWithOptions(application.WebviewWindowOptions{
		Name:      "main",
		Title:     "adOmnia paratus.",
		Width:     winW,
		Height:    winH,
		MinWidth:  winMinW,
		MinHeight: winMinH,
		URL:       "/",
		Frameless: windowchrome.IsApp(startupWindowChrome),
		// Carries over the v2 DragAndDrop.EnableFileDrop behaviour. Without it
		// the drop handlers never fire and App.ReadDroppedFiles is unreachable.
		EnableFileDrop: true,
	})
	configureNativeWindowIcon(mainWindow)
	confirmUpdateWhenWindowReady(mainWindow)
	app.SetMainWindow(mainWindow)
	goIDE.attachMainWindow(mainWindow)
	app.attachPanelWindowsToMain(mainWindow)
	if err := desktopApp.Run(); err != nil {
		devlog.Init(dataDir())
		devlog.Err("DesktopRun", "webview creation or application run failed", err, map[string]any{"window": "main"})
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
	_ = os.MkdirAll(p, 0755) // #nosec G703 -- APPDATA (or ~/.config) is the user's own profile folder, only the fixed app name is appended
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
