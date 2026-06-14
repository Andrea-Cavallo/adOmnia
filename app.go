package main

import (
	"bufio"
	"context"
	"encoding/base64"
	"encoding/json"
	"fmt"
	"log"
	"os"
	"os/exec"
	"path/filepath"
	stdRuntime "runtime"
	"strings"
	"time"

	"adomnia/internal/devlog"
	"adomnia/internal/httpexec"
	"adomnia/internal/nettools"
	"adomnia/internal/proxy"
	"adomnia/internal/sidecar"
	"adomnia/internal/sse"
	"adomnia/internal/storage"
	"adomnia/internal/vault"
	"adomnia/internal/ws"
	wailsRuntime "github.com/wailsapp/wails/v2/pkg/runtime"
)

type App struct {
	ctx          context.Context
	serverPort   int
	browserDebug *BrowserDebug
	scheduler    *SchedulerBinding
}

func NewApp() *App {
	return &App{}
}

func (a *App) OnStartup(ctx context.Context) {
	devlog.Init(dataDir())
	a.ctx = ctx
	devlog.Info("OnStartup", "avvio applicazione in corso", nil)
	if err := storage.Open(dataDir()); err != nil {
		log.Printf("[app] WARNING: could not open bbolt DB: %v", err)
		devlog.Err("OnStartup", "apertura bbolt DB fallita", err, nil)
	} else {
		devlog.Log("OnStartup", "bbolt DB aperto con successo", nil)
	}
	if globalPluginManager != nil {
		if err := globalPluginManager.Init(); err != nil {
			log.Printf("[app] WARNING: could not initialize plugins: %v", err)
			devlog.Err("OnStartup", "inizializzazione plugin fallita", err, nil)
		} else {
			devlog.Log("OnStartup", "plugin manager inizializzato", nil)
		}
	}
	sidecar.InitToken()
	devlog.Log("OnStartup", "sidecar token generato", nil)
	proxy.Configure(dataDir(), func(data []byte) error {
		return storage.Put("proxy", "rules", data)
	})
	proxy.InitRules()
	devlog.Log("OnStartup", "regole proxy inizializzate", nil)
	proxy.AutoLoadCA()
	devlog.Log("OnStartup", "CA proxy caricato", nil)
	a.serverPort = sidecar.Start()
	if globalPythonBridge != nil {
		globalPythonBridge.Init(ctx, a)
	}
	if globalPluginManager != nil {
		globalPluginManager.FireEvent(PluginEvent{Type: "onStartup", Payload: map[string]interface{}{}})
	}
	if a.scheduler != nil {
		a.scheduler.Start()
		devlog.Log("OnStartup", "scheduler avviato", nil)
	}
	devlog.Info("OnStartup", "avvio completato", map[string]any{"port": a.serverPort})
	log.Println("[app] startup complete")
}

func (a *App) GetServerPort() int {
	devlog.Log("GetServerPort", "porta HTTP sidecar richiesta dal frontend", map[string]any{"port": a.serverPort})
	return a.serverPort
}

func (a *App) GetSidecarToken() string {
	return sidecar.Token()
}

func (a *App) CompareFolders(left, right string, maxFileMB int64) (string, error) {
	result, err := nettools.ScanFolderDiff(left, right, maxFileMB)
	if err != nil {
		return "", err
	}
	data, err := json.Marshal(result)
	if err != nil {
		return "", err
	}
	return string(data), nil
}

func (a *App) ReadFolderDiffFile(scanID, path string, maxBytes int64) (string, error) {
	result, err := nettools.ReadFolderDiffFile(scanID, path, maxBytes)
	if err != nil {
		return "", err
	}
	data, err := json.Marshal(result)
	if err != nil {
		return "", err
	}
	return string(data), nil
}

func (a *App) SelectFolder(title string) (string, error) {
	if strings.TrimSpace(title) == "" {
		title = "Select folder"
	}
	path, err := wailsRuntime.OpenDirectoryDialog(a.ctx, wailsRuntime.OpenDialogOptions{Title: title})
	if err != nil {
		devlog.Err("SelectFolder", "selezione cartella fallita", err, map[string]any{"title": title})
		return "", err
	}
	devlog.Log("SelectFolder", "cartella selezionata", map[string]any{"path": path})
	return path, nil
}

func (a *App) GetDevLogs() string {
	path := devlog.CurrentPath()
	file, err := os.Open(path)
	if err != nil {
		devlog.Err("GetDevLogs", "lettura file dev logs fallita", err, map[string]any{"path": path})
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
		devlog.Err("GetDevLogs", "scansione file dev logs fallita", err, map[string]any{"path": path})
	}
	if len(entries) > 2000 {
		entries = entries[len(entries)-2000:]
	}
	out, err := json.Marshal(entries)
	if err != nil {
		devlog.Err("GetDevLogs", "serializzazione dev logs fallita", err, nil)
		return "[]"
	}
	return string(out)
}

func (a *App) ClearDevLogs() {
	devlog.Clear()
	devlog.Info("ClearDevLogs", "dev logs puliti", nil)
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
	devlog.Info("SetDevMode", "developer mode changed", map[string]any{"enabled": enabled})
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
		devlog.Err("OpenDevLogsFolder", "apertura cartella log fallita", err, map[string]any{"path": logsDir})
	}
	devlog.Info("OpenDevLogsFolder", "cartella log aperta", map[string]any{"path": logsDir})
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
	devlog.Info("SetVaultTimeout", "vault timeout aggiornato", map[string]any{"minutes": minutes})
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
		devlog.Err("ListLogFiles", "lettura cartella log fallita", err, map[string]any{"dir": dir})
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
	devlog.Log("ListLogFiles", "elenco file log", map[string]any{"count": len(result)})
	return result
}

// ReadLogFile reads a JSONL log file and returns its entries as a JSON array.
func (a *App) ReadLogFile(filename string) string {
	// Prevent path traversal
	cleaned := filepath.Clean(filename)
	if strings.Contains(cleaned, "..") || filepath.IsAbs(cleaned) {
		devlog.Err("ReadLogFile", "percorso file non valido", nil, map[string]any{"filename": filename})
		return "[]"
	}

	path := filepath.Join(devlog.Dir(), cleaned)
	file, err := os.Open(path)
	if err != nil {
		devlog.Err("ReadLogFile", "apertura file fallita", err, map[string]any{"path": path})
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
		devlog.Err("ReadLogFile", "scansione file fallita", err, map[string]any{"path": path})
	}

	out, err := json.Marshal(entries)
	if err != nil {
		devlog.Err("ReadLogFile", "serializzazione fallita", err, nil)
		return "[]"
	}
	devlog.Log("ReadLogFile", "file log letto", map[string]any{"path": cleaned, "count": len(entries)})
	return string(out)
}

func (a *App) OnDomReady(ctx context.Context) {
	devlog.Info("OnDomReady", "DOM frontend pronto", nil)
	log.Println("[app] frontend DOM ready")
}

func (a *App) OnShutdown(ctx context.Context) {
	devlog.Info("OnShutdown", "arresto applicazione", nil)
	if a.scheduler != nil {
		a.scheduler.Stop()
	}
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
	sidecar.Stop()
	storage.Close()
	log.Println("[app] shutdown complete")
}

// ExecuteHTTP preserves the public Wails binding while execution lives in the HTTP module.
func (a *App) ExecuteHTTP(reqJSON string) string {
	return httpexec.Execute(reqJSON)
}

func (a *App) GetStartupWindowChrome() string {
	return startupWindowChrome
}

func (a *App) LoadSettings() (string, error) {
	if storage.DB() == nil {
		return "{}", nil
	}
	data, err := storage.Get(settingsBucket, settingsKey)
	if err != nil {
		return "{}", fmt.Errorf("failed to load settings: %w", err)
	}
	if data == nil {
		return "{}", nil
	}
	return string(data), nil
}

func (a *App) SaveSettings(settingsJSON string) error {
	if storage.DB() == nil {
		return fmt.Errorf("storage not initialized")
	}
	if !json.Valid([]byte(settingsJSON)) {
		return fmt.Errorf("invalid settings JSON")
	}
	return storage.Put(settingsBucket, settingsKey, []byte(settingsJSON))
}

type StorageEntry struct {
	Bucket string `json:"bucket"`
	Key    string `json:"key"`
	Value  string `json:"value"`
}

func (a *App) StorageGet(bucket, key string) (string, error) {
	if storage.DB() == nil {
		return "", fmt.Errorf("storage not initialized")
	}
	data, err := storage.Get(bucket, key)
	if err != nil || data == nil {
		return "", err
	}
	return string(data), nil
}

func (a *App) StoragePut(bucket, key, value string) error {
	if storage.DB() == nil {
		return fmt.Errorf("storage not initialized")
	}
	return storage.Put(bucket, key, []byte(value))
}

func (a *App) StorageDelete(bucket, key string) error {
	if storage.DB() == nil {
		return fmt.Errorf("storage not initialized")
	}
	return storage.Delete(bucket, key)
}

func (a *App) StorageList(bucket, prefix string) ([]string, error) {
	if storage.DB() == nil {
		return nil, fmt.Errorf("storage not initialized")
	}
	return storage.List(bucket, prefix)
}

func (a *App) StorageGetAll(bucket string) ([]StorageEntry, error) {
	keys, err := a.StorageList(bucket, "")
	if err != nil {
		return nil, err
	}
	entries := make([]StorageEntry, 0, len(keys))
	for _, key := range keys {
		value, err := storage.Get(bucket, key)
		if err == nil {
			entries = append(entries, StorageEntry{Bucket: bucket, Key: key, Value: string(value)})
		}
	}
	return entries, nil
}

func (a *App) SaveBinaryFileBase64(defaultName, dataBase64 string) (string, error) {
	if a.ctx == nil {
		return "", fmt.Errorf("app context not initialized")
	}
	if strings.TrimSpace(defaultName) == "" {
		defaultName = "export.bin"
	}
	data, err := base64.StdEncoding.DecodeString(dataBase64)
	if err != nil {
		return "", fmt.Errorf("invalid base64 payload: %w", err)
	}
	path, err := wailsRuntime.SaveFileDialog(a.ctx, wailsRuntime.SaveDialogOptions{
		Title:           "Save file",
		DefaultFilename: filepath.Base(defaultName),
	})
	if err != nil {
		return "", err
	}
	if path == "" {
		return "", nil
	}
	if err := os.WriteFile(path, data, 0644); err != nil {
		return "", fmt.Errorf("failed to write file: %w", err)
	}
	return path, nil
}
