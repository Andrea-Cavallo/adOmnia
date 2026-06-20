package main

import (
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

	"github.com/wailsapp/wails/v2"
	"github.com/wailsapp/wails/v2/pkg/options"
	"github.com/wailsapp/wails/v2/pkg/options/assetserver"
	"github.com/wailsapp/wails/v2/pkg/options/windows"
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

func main() {
	configureWindowChromeBackend(startupWindowChrome)

	app := NewApp()
	browserDebug := NewBrowserDebug()
	app.browserDebug = browserDebug
	themeManager := NewThemeManager()
	templateStore := NewTemplateStore()
	pluginManager := NewPluginManager()
	globalPluginManager = pluginManager
	wasmRuntime := NewWasmRuntime()
	dockerLab := NewDockerLab()
	aiEngine := NewAIEngine()
	globalAIEngine = aiEngine
	gitSync := NewGitSync(dataDir())
	mcpClient := NewMCPClient()
	mcpServerGenerator := NewMCPServerGenerator()

	appOptions := &options.App{
		Title:     "adOmnia paratus.",
		Width:     1400,
		Height:    900,
		MinWidth:  900,
		MinHeight: 600,
		AssetServer: &assetserver.Options{
			Assets: assets,
		},
		OnStartup:  app.OnStartup,
		OnDomReady: app.OnDomReady,
		OnShutdown: app.OnShutdown,
		Bind: []interface{}{
			app,
			browserDebug,
			themeManager,
			templateStore,
			pluginManager,
			wasmRuntime,
			dockerLab,
			aiEngine,
			gitSync,
			mcpClient,
			mcpServerGenerator,
		},
		Windows: &windows.Options{
			WebviewIsTransparent:              false,
			WindowIsTranslucent:               false,
			DisableWindowIcon:                 false,
			DisableFramelessWindowDecorations: false,
			WebviewUserDataPath:               dataDir(),
			Theme:                             windows.Dark,
		},
		DragAndDrop: &options.DragAndDrop{
			EnableFileDrop: true,
		},
		Frameless: isAppChrome(startupWindowChrome),
	}
	applyPlatformOptions(appOptions)

	err := wails.Run(appOptions)
	if err != nil {
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
