package main

import (
	"bufio"
	"context"
	"encoding/json"
	"log"
	"os"
	"os/exec"
	"path/filepath"
	stdRuntime "runtime"
	"strings"
	"time"

	"adomnia/internal/devlog"
	"adomnia/internal/proxy"
	"adomnia/internal/sse"
	"adomnia/internal/vault"
	"adomnia/internal/ws"
	wailsRuntime "github.com/wailsapp/wails/v2/pkg/runtime"
	bolt "go.etcd.io/bbolt"
)

type App struct {
	ctx          context.Context
	store        *bolt.DB
	browserDebug *BrowserDebug
}

func NewApp() *App {
	return &App{}
}

func (a *App) OnStartup(ctx context.Context) {
	devlog.Init(dataDir())
	a.ctx = ctx
	dlogInfo("OnStartup", "avvio applicazione in corso", nil)
	if err := openStore(); err != nil {
		log.Printf("[app] WARNING: could not open bbolt DB: %v", err)
		dlogErr("OnStartup", "apertura bbolt DB fallita", err, nil)
	} else {
		a.store = storeDB
		dlog("OnStartup", "bbolt DB aperto con successo", nil)
	}
	if globalPluginManager != nil {
		if err := globalPluginManager.Init(); err != nil {
			log.Printf("[app] WARNING: could not initialize plugins: %v", err)
			dlogErr("OnStartup", "inizializzazione plugin fallita", err, nil)
		} else {
			dlog("OnStartup", "plugin manager inizializzato", nil)
		}
	}
	initSidecarToken()
	dlog("OnStartup", "sidecar token generato", nil)
	proxy.Configure(dataDir(), func(data []byte) error {
		return storePut("proxy", "rules", data)
	})
	proxy.InitRules()
	dlog("OnStartup", "regole proxy inizializzate", nil)
	proxy.AutoLoadCA()
	dlog("OnStartup", "CA proxy caricato", nil)
	startHTTPServer()
	if globalPythonBridge != nil {
		globalPythonBridge.Init(ctx, a)
	}
	if globalPluginManager != nil {
		globalPluginManager.FireEvent(PluginEvent{Type: "onStartup", Payload: map[string]interface{}{}})
	}
	dlogInfo("OnStartup", "avvio completato", map[string]any{"port": serverPort})
	log.Println("[app] startup complete")
}

func (a *App) GetServerPort() int {
	dlog("GetServerPort", "porta HTTP sidecar richiesta dal frontend", map[string]any{"port": serverPort})
	return serverPort
}

func (a *App) GetSidecarToken() string {
	return sidecarToken
}

func (a *App) SelectFolder(title string) (string, error) {
	if strings.TrimSpace(title) == "" {
		title = "Select folder"
	}
	path, err := wailsRuntime.OpenDirectoryDialog(a.ctx, wailsRuntime.OpenDialogOptions{Title: title})
	if err != nil {
		dlogErr("SelectFolder", "selezione cartella fallita", err, map[string]any{"title": title})
		return "", err
	}
	dlog("SelectFolder", "cartella selezionata", map[string]any{"path": path})
	return path, nil
}

func (a *App) GetDevLogs() string {
	path := devlog.CurrentPath()
	file, err := os.Open(path)
	if err != nil {
		dlogErr("GetDevLogs", "lettura file dev logs fallita", err, map[string]any{"path": path})
		return "[]"
	}
	defer file.Close()

	entries := make([]devlog.Entry, 0, 256)
	scanner := bufio.NewScanner(file)
	buf := make([]byte, 0, 64*1024)
	scanner.Buffer(buf, 1024*1024)
	for scanner.Scan() {
		line := strings.TrimSpace(scanner.Text())
		if line == "" {
			continue
		}
		var entry devlog.Entry
		if err := json.Unmarshal([]byte(line), &entry); err == nil {
			if entry.Source == "" {
				entry.Source = "backend"
			}
			entries = append(entries, entry)
		}
	}
	if err := scanner.Err(); err != nil {
		dlogErr("GetDevLogs", "scansione file dev logs fallita", err, map[string]any{"path": path})
	}
	if len(entries) > 2000 {
		entries = entries[len(entries)-2000:]
	}
	out, err := json.Marshal(entries)
	if err != nil {
		dlogErr("GetDevLogs", "serializzazione dev logs fallita", err, nil)
		return "[]"
	}
	return string(out)
}

func (a *App) ClearDevLogs() {
	devlog.Clear()
	dlogInfo("ClearDevLogs", "dev logs puliti", nil)
}

func (a *App) RecordFrontendLog(level string, message string) {
	level = strings.ToUpper(strings.TrimSpace(level))
	if level == "" {
		level = "LOG"
	}
	devlog.WriteSource("frontend", level, "console", message, nil)
}

// IsDevMode returns whether developer mode is enabled.
func (a *App) IsDevMode() bool {
	return isDevMode
}

// SetDevMode enables or disables developer mode.
func (a *App) SetDevMode(enabled bool) {
	isDevMode = enabled
	dlogInfo("SetDevMode", "developer mode changed", map[string]any{"enabled": enabled})
}

// OpenDevLogsFolder opens the dev logs directory in the OS file manager.
func (a *App) OpenDevLogsFolder() {
	logsDir := devlog.Dir()
	var cmd *exec.Cmd
	switch stdRuntime.GOOS {
	case "darwin":
		cmd = exec.Command("open", logsDir)
	case "linux":
		cmd = exec.Command("xdg-open", logsDir)
	default:
		cmd = exec.Command("explorer", logsDir)
	}
	if err := cmd.Start(); err != nil {
		dlogErr("OpenDevLogsFolder", "apertura cartella log fallita", err, map[string]any{"path": logsDir})
	}
	dlogInfo("OpenDevLogsFolder", "cartella log aperta", map[string]any{"path": logsDir})
}

// GetVaultTimeout returns the vault auto-lock timeout in minutes.
func (a *App) GetVaultTimeout() int {
	return vault.TimeoutMinutes()
}

// SetVaultTimeout sets the vault auto-lock timeout in minutes.
func (a *App) SetVaultTimeout(minutes int) {
	if minutes < 1 {
		minutes = 1
	}
	if minutes > 120 {
		minutes = 120
	}
	vault.SetTimeoutMinutes(minutes)
	dlogInfo("SetVaultTimeout", "vault timeout aggiornato", map[string]any{"minutes": minutes})
}

// LogFileEntry represents a log file in the logs directory.
type LogFileEntry struct {
	Name    string `json:"name"`
	Size    int64  `json:"size"`
	ModTime string `json:"modTime"`
}

// ListLogFiles returns the list of JSONL log files in the logs directory.
func (a *App) ListLogFiles() []LogFileEntry {
	dir := devlog.Dir()
	entries, err := os.ReadDir(dir)
	if err != nil {
		dlogErr("ListLogFiles", "lettura cartella log fallita", err, map[string]any{"dir": dir})
		return nil
	}

	var result []LogFileEntry
	for _, e := range entries {
		if e.IsDir() || !strings.HasSuffix(e.Name(), ".jsonl") {
			continue
		}
		info, err := e.Info()
		if err != nil {
			continue
		}
		result = append(result, LogFileEntry{
			Name:    e.Name(),
			Size:    info.Size(),
			ModTime: info.ModTime().UTC().Format(time.RFC3339),
		})
	}
	dlog("ListLogFiles", "elenco file log", map[string]any{"count": len(result)})
	return result
}

// ReadLogFile reads a JSONL log file and returns its entries as a JSON array.
func (a *App) ReadLogFile(filename string) string {
	// Prevent path traversal
	cleaned := filepath.Clean(filename)
	if strings.Contains(cleaned, "..") || filepath.IsAbs(cleaned) {
		dlogErr("ReadLogFile", "percorso file non valido", nil, map[string]any{"filename": filename})
		return "[]"
	}

	path := filepath.Join(devlog.Dir(), cleaned)
	file, err := os.Open(path)
	if err != nil {
		dlogErr("ReadLogFile", "apertura file fallita", err, map[string]any{"path": path})
		return "[]"
	}
	defer file.Close()

	entries := make([]devlog.Entry, 0, 256)
	scanner := bufio.NewScanner(file)
	buf := make([]byte, 0, 64*1024)
	scanner.Buffer(buf, 1024*1024)
	for scanner.Scan() {
		line := strings.TrimSpace(scanner.Text())
		if line == "" {
			continue
		}
		var entry devlog.Entry
		if err := json.Unmarshal([]byte(line), &entry); err == nil {
			if entry.Source == "" {
				entry.Source = "backend"
			}
			entries = append(entries, entry)
		}
	}
	if err := scanner.Err(); err != nil {
		dlogErr("ReadLogFile", "scansione file fallita", err, map[string]any{"path": path})
	}

	out, err := json.Marshal(entries)
	if err != nil {
		dlogErr("ReadLogFile", "serializzazione fallita", err, nil)
		return "[]"
	}
	dlog("ReadLogFile", "file log letto", map[string]any{"path": cleaned, "count": len(entries)})
	return string(out)
}

func (a *App) OnDomReady(ctx context.Context) {
	dlogInfo("OnDomReady", "DOM frontend pronto", nil)
	log.Println("[app] frontend DOM ready")
}

func (a *App) OnShutdown(ctx context.Context) {
	dlogInfo("OnShutdown", "arresto applicazione", nil)
	if globalPluginManager != nil {
		globalPluginManager.FireEvent(PluginEvent{Type: "onShutdown", Payload: map[string]interface{}{}})
		globalPluginManager.Shutdown()
	}
	if globalPythonBridge != nil {
		globalPythonBridge.Shutdown()
	}
	if a.browserDebug != nil {
		if err := a.browserDebug.StopBrowser(); err != nil {
			log.Printf("[app] browser debug stop error: %v", err)
		}
	}
	ws.WsShutdown()
	sse.SseShutdown()
	stopHTTPServer()
	closeStore()
	log.Println("[app] shutdown complete")
}
