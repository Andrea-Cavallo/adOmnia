package main

import (
	"adomnia/internal/netpolicy"

	"adomnia/internal/adomniacli"
	"adomnia/internal/browser"
	"adomnia/internal/docker"
	"adomnia/internal/plugins"
	"adomnia/internal/templates"
	"adomnia/internal/themes"
	"embed"
	"encoding/json"
	"log"
	"os"
	"path/filepath"
	"runtime"
	"strings"
	"time"

	"github.com/wailsapp/wails/v3/pkg/application"
	bolt "go.etcd.io/bbolt"
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
	windowChromeApp    = "app"
	windowChromeAppX11 = "app-xwayland"
	windowChromeSystem = "system"
	settingsBucket     = "workspace"
	settingsKey        = "settings"
)

var startupWindowChrome = readStartupWindowChrome()

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
	configureWindowChromeBackend(startupWindowChrome)

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

	mainWindow = desktopApp.Window.NewWithOptions(application.WebviewWindowOptions{
		Name:      "main",
		Title:     "adOmnia paratus.",
		Width:     1400,
		Height:    900,
		MinWidth:  900,
		MinHeight: 600,
		URL:       "/",
		Frameless: isAppChrome(startupWindowChrome),
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

func normalizeWindowChrome(value string) string {
	switch strings.ToLower(strings.TrimSpace(value)) {
	case windowChromeAppX11:
		// Backward-compatible alias: never force XWayland for old settings.
		return windowChromeApp
	case windowChromeSystem:
		return windowChromeSystem
	default:
		return windowChromeApp
	}
}

// defaultWindowChrome: barra integrata nell'app, tranne su Linux dove WebKitGTK/Wayland resta sulla cornice di sistema.
func defaultWindowChrome(goos string) string {
	if goos == "linux" {
		return windowChromeSystem
	}
	return windowChromeApp
}

func readStartupWindowChrome() string {
	path := filepath.Join(dataDir(), "adomnia", "adomnia.db")
	if _, err := os.Stat(path); err != nil {
		return defaultWindowChrome(runtime.GOOS)
	}
	db, err := bolt.Open(path, 0600, &bolt.Options{ReadOnly: true, Timeout: 250 * time.Millisecond})
	if err != nil {
		return defaultWindowChrome(runtime.GOOS)
	}
	defer db.Close()
	var settingsJSON []byte
	_ = db.View(func(tx *bolt.Tx) error {
		bucket := tx.Bucket([]byte(settingsBucket))
		if bucket != nil {
			settingsJSON = append([]byte(nil), bucket.Get([]byte(settingsKey))...)
		}
		return nil
	})
	return startupWindowChromeFromSettings(settingsJSON, runtime.GOOS)
}

// startupWindowChromeFromSettings rispecchia le migrazioni del frontend (settings.ts) per decidere la cornice
// prima che il frontend riscriva le impostazioni: così il cambio vale già a questo avvio.
func startupWindowChromeFromSettings(settingsJSON []byte, goos string) string {
	fallback := defaultWindowChrome(goos)
	var parsed struct {
		Version    int `json:"version"`
		Appearance struct {
			WindowChrome string `json:"windowChrome"`
		} `json:"appearance"`
	}
	if json.Unmarshal(settingsJSON, &parsed) != nil || parsed.Appearance.WindowChrome == "" {
		return fallback
	}
	chrome := parsed.Appearance.WindowChrome
	// v3: il vecchio default 'app' era diventato 'system'.
	if parsed.Version < 3 && chrome == windowChromeApp {
		chrome = windowChromeSystem
	}
	// v13: la barra integrata torna predefinita fuori da Linux, una volta sola (v12 la saltava per chi aveva scelto System).
	if parsed.Version < 13 && chrome == windowChromeSystem && goos != "linux" {
		chrome = windowChromeApp
	}
	return normalizeWindowChrome(chrome)
}

func isAppChrome(mode string) bool {
	return mode == windowChromeApp || mode == windowChromeAppX11
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
