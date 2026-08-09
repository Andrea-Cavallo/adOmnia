package main

import (
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
	if len(os.Args) > 1 && (os.Args[1] == "run" || os.Args[1] == "lint") {
		os.Exit(adomniacli.Run(os.Args[1:], os.Stdout, os.Stderr))
	}

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
			ProgramName: "adOmnia",
		},
	}
	applyPlatformOptions(&appOptions)
	desktopApp := application.New(appOptions)
	app.AttachDesktop(desktopApp)

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
	app.SetMainWindow(mainWindow)
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
		return windowChromeAppX11
	case windowChromeSystem:
		return windowChromeSystem
	default:
		return windowChromeApp
	}
}

func readStartupWindowChrome() string {
	path := filepath.Join(dataDir(), "adomnia", "adomnia.db")
	if _, err := os.Stat(path); err != nil {
		return windowChromeSystem
	}
	db, err := bolt.Open(path, 0600, &bolt.Options{ReadOnly: true, Timeout: 250 * time.Millisecond})
	if err != nil {
		return windowChromeSystem
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
	var parsed struct {
		Version    int `json:"version"`
		Appearance struct {
			WindowChrome string `json:"windowChrome"`
		} `json:"appearance"`
	}
	if json.Unmarshal(settingsJSON, &parsed) != nil {
		return windowChromeSystem
	}
	if parsed.Appearance.WindowChrome == "" {
		return windowChromeSystem
	}
	// v3 migration: the system titlebar is now the default. Pre-v3 settings that
	// still carry the legacy 'app' default are treated as 'system' on first
	// launch so the change applies before the frontend rewrites the settings.
	if parsed.Version < 3 && parsed.Appearance.WindowChrome == windowChromeApp {
		return windowChromeSystem
	}
	return normalizeWindowChrome(parsed.Appearance.WindowChrome)
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
