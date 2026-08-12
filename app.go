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

	"adomnia/internal/bootstrap"
	"adomnia/internal/collectionsstore"
	"adomnia/internal/devlog"
	"adomnia/internal/httpexec"
	"adomnia/internal/nettools"
	pluginRuntime "adomnia/internal/plugins"
	"adomnia/internal/proxy"
	"adomnia/internal/requestwindow"
	"adomnia/internal/sidecar"
	"adomnia/internal/sse"
	"adomnia/internal/startupperf"
	"adomnia/internal/storage"
	"adomnia/internal/swaggerwindow"
	"adomnia/internal/vault"
	"adomnia/internal/ws"
	"github.com/wailsapp/wails/v3/pkg/application"
)

type App struct {
	ctx            context.Context
	serverPort     int
	browserDebug   *BrowserDebug
	desktop        *application.App
	mainWindow     *application.WebviewWindow
	requestWindows *requestwindow.Manager
	swaggerWindow  *swaggerwindow.Manager
	startupStages  map[string]any
}

type DroppedFileData struct {
	Name        string `json:"name"`
	Path        string `json:"path"`
	Text        string `json:"text,omitempty"`
	BytesBase64 string `json:"bytesBase64,omitempty"`
}

const maxDroppedFileBytes = 50 * 1024 * 1024

func isSupportedDroppedFile(name string) bool {
	lower := strings.ToLower(name)
	switch {
	case strings.HasSuffix(lower, ".class"),
		strings.HasSuffix(lower, ".pdf"),
		strings.HasSuffix(lower, ".har"),
		strings.HasSuffix(lower, ".wsdl"),
		strings.HasSuffix(lower, ".mmd"),
		strings.HasSuffix(lower, ".mermaid"),
		strings.HasSuffix(lower, ".tex"),
		strings.HasSuffix(lower, ".json"),
		strings.HasSuffix(lower, ".yaml"),
		strings.HasSuffix(lower, ".yml"),
		strings.HasSuffix(lower, ".adomnia"),
		strings.HasSuffix(lower, ".bru"):
		return true
	default:
		return false
	}
}

func NewApp() *App {
	return &App{}
}

// AttachDesktop gives the binding service access to the Wails v3 application.
// Domain code remains independent from Wails; only this root binding layer
// touches native windows, dialogs, and the application event bus.
func (a *App) AttachDesktop(desktop *application.App) {
	a.desktop = desktop
	a.requestWindows = requestwindow.New(desktop)
	a.swaggerWindow = swaggerwindow.New(desktop)
}

func (a *App) SetMainWindow(window *application.WebviewWindow) {
	a.mainWindow = window
	if a.requestWindows != nil {
		a.requestWindows.SetMainWindow(window)
	}
}

// DetachRequest creates a native Wails v3 window for the existing request tab.
// snapshotJSON contains the request, response and editor view state; it is kept
// in the single app process until the request is attached again.
func (a *App) DetachRequest(tabID, snapshotJSON, title string) error {
	if a.requestWindows == nil {
		return fmt.Errorf("desktop runtime is not initialized")
	}
	return a.requestWindows.Detach(tabID, snapshotJSON, title)
}

// DetachRequestAndResponse opens the composer and response in two native
// windows while keeping a single synchronized request tab session.
func (a *App) DetachRequestAndResponse(tabID, snapshotJSON, title string) error {
	if a.requestWindows == nil {
		return fmt.Errorf("desktop runtime is not initialized")
	}
	return a.requestWindows.DetachRequestAndResponse(tabID, snapshotJSON, title)
}

func (a *App) GetDetachedRequestSnapshot(tabID string) (string, error) {
	if a.requestWindows == nil {
		return "", fmt.Errorf("desktop runtime is not initialized")
	}
	return a.requestWindows.Snapshot(tabID)
}

func (a *App) UpdateDetachedRequestSnapshot(tabID, snapshotJSON string) error {
	if a.requestWindows == nil {
		return fmt.Errorf("desktop runtime is not initialized")
	}
	return a.requestWindows.Update(tabID, snapshotJSON)
}

func (a *App) AttachRequestToMainWindow(tabID string) error {
	if a.requestWindows == nil {
		return fmt.Errorf("desktop runtime is not initialized")
	}
	return a.requestWindows.Attach(tabID)
}

// OpenSwaggerEditorWindow opens the OpenAPI editor in its own native window.
// The editor remains local-first: its draft is persisted by the frontend in
// local storage and can be saved into any local collection from that window.
func (a *App) OpenSwaggerEditorWindow() error {
	if a.swaggerWindow == nil {
		return fmt.Errorf("desktop runtime is not initialized")
	}
	a.swaggerWindow.Open()
	return nil
}

// ServiceStartup is Wails v3's lifecycle hook. The existing OnStartup method
// remains the application lifecycle owner so no domain initialisation moves
// into the desktop shell.
func (a *App) ServiceStartup(ctx context.Context, _ application.ServiceOptions) error {
	a.OnStartup(ctx)
	return nil
}

func (a *App) ServiceShutdown() error {
	a.OnShutdown(a.ctx)
	return nil
}

func (a *App) OnApplicationShutdown() {
	a.OnShutdown(a.ctx)
}

func (a *App) OnStartup(ctx context.Context) {
	startupStarted := time.Now()
	stageStarted := startupStarted
	devlog.Init(dataDir())
	startupStages := map[string]any{
		"devlogMs": float64(time.Since(stageStarted).Microseconds()) / 1000,
	}
	a.ctx = ctx
	pluginRuntime.ConfigureNotifier(func(notification pluginRuntime.PluginNotification) {
		if a.desktop != nil {
			a.desktop.Event.Emit("plugin:notification", notification)
		}
	})
	devlog.Info("OnStartup", "avvio applicazione in corso", nil)
	stageStarted = time.Now()
	if err := storage.Open(dataDir()); err != nil {
		log.Printf("[app] WARNING: could not open bbolt DB: %v", err)
		devlog.Err("OnStartup", "apertura bbolt DB fallita", err, nil)
	} else {
		devlog.Log("OnStartup", "bbolt DB aperto con successo", nil)
	}
	startupStages["storageMs"] = float64(time.Since(stageStarted).Microseconds()) / 1000
	stageStarted = time.Now()
	if globalPluginManager != nil {
		if err := globalPluginManager.Init(); err != nil {
			log.Printf("[app] WARNING: could not initialize plugins: %v", err)
			devlog.Err("OnStartup", "inizializzazione plugin fallita", err, nil)
		} else {
			devlog.Log("OnStartup", "plugin manager inizializzato", nil)
		}
	}
	startupStages["pluginsMs"] = float64(time.Since(stageStarted).Microseconds()) / 1000
	stageStarted = time.Now()
	sidecar.InitToken()
	devlog.Log("OnStartup", "sidecar token generato", nil)
	proxy.Configure(dataDir(), func(data []byte) error {
		return storage.Put("proxy", "rules", data)
	})
	proxy.InitRules()
	devlog.Log("OnStartup", "regole proxy inizializzate", nil)
	proxy.AutoLoadCA()
	devlog.Log("OnStartup", "CA proxy caricato", nil)
	startupStages["proxyMs"] = float64(time.Since(stageStarted).Microseconds()) / 1000
	stageStarted = time.Now()
	a.serverPort = sidecar.Start()
	startupStages["sidecarMs"] = float64(time.Since(stageStarted).Microseconds()) / 1000
	stageStarted = time.Now()
	if globalPluginManager != nil {
		globalPluginManager.FireEvent(PluginEvent{Type: "onStartup", Payload: map[string]interface{}{}})
	}
	startupStages["pluginEventMs"] = float64(time.Since(stageStarted).Microseconds()) / 1000
	startupStages["totalMs"] = float64(time.Since(startupStarted).Microseconds()) / 1000
	startupStages["port"] = a.serverPort
	a.startupStages = startupStages
	devlog.Info("StartupPerformance", "avvio backend completato", startupStages)
	log.Printf("[app] startup performance: %+v", startupStages)
	log.Println("[app] startup complete")
}

func (a *App) GetServerPort() int {
	devlog.Log("GetServerPort", "porta HTTP sidecar richiesta dal frontend", map[string]any{"port": a.serverPort})
	return a.serverPort
}

func (a *App) GetSidecarToken() string {
	return sidecar.Token()
}

func (a *App) ReadDroppedFiles(paths []string) (string, error) {
	result := make([]DroppedFileData, 0, len(paths))
	for _, rawPath := range paths {
		path := strings.TrimSpace(rawPath)
		if path == "" {
			continue
		}
		cleaned := filepath.Clean(path)
		info, err := os.Stat(cleaned)
		if err != nil {
			return "", fmt.Errorf("could not read dropped file %q: %w", filepath.Base(cleaned), err)
		}
		if info.IsDir() {
			return "", fmt.Errorf("%s is a folder; drop a supported file instead", filepath.Base(cleaned))
		}
		if info.Size() > maxDroppedFileBytes {
			return "", fmt.Errorf("%s is too large to import from drag and drop", filepath.Base(cleaned))
		}
		if !isSupportedDroppedFile(info.Name()) {
			return "", fmt.Errorf("%s is not a supported drag-and-drop file type", filepath.Base(cleaned))
		}
		data, err := os.ReadFile(cleaned)
		if err != nil {
			return "", fmt.Errorf("could not read dropped file %q: %w", filepath.Base(cleaned), err)
		}
		entry := DroppedFileData{Name: filepath.Base(cleaned), Path: cleaned}
		lower := strings.ToLower(entry.Name)
		if strings.HasSuffix(lower, ".pdf") || strings.HasSuffix(lower, ".class") {
			entry.BytesBase64 = base64.StdEncoding.EncodeToString(data)
		} else {
			entry.Text = string(data)
		}
		result = append(result, entry)
	}
	out, err := json.Marshal(result)
	if err != nil {
		return "", fmt.Errorf("failed to serialize dropped files: %w", err)
	}
	return string(out), nil
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
	if a.desktop == nil {
		return "", fmt.Errorf("desktop runtime not initialized")
	}
	path, err := a.desktop.Dialog.OpenFile().
		CanChooseFiles(false).
		CanChooseDirectories(true).
		SetTitle(title).
		PromptForSingleSelection()
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
	if globalPluginManager != nil {
		globalPluginManager.EmitEvent(PluginEvent{Type: "onShutdown", Payload: map[string]interface{}{}})
		globalPluginManager.Shutdown()
	}
	pluginRuntime.ConfigureNotifier(nil)
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
	if globalPluginManager != nil {
		return httpexec.ExecuteWithHooks(reqJSON, globalPluginManager.ApplyEventJSON)
	}
	return httpexec.Execute(reqJSON)
}

// CancelHTTP aborts an in-flight ExecuteHTTP request by its frontend id.
func (a *App) CancelHTTP(id string) {
	httpexec.Cancel(id)
}

func (a *App) GetStartupWindowChrome() string {
	return startupWindowChrome
}

// LoadBootstrapState keeps the Wails binding thin while the internal package
// performs one transaction for all state required by the first workspace.
func (a *App) LoadBootstrapState() (bootstrap.State, error) {
	return bootstrap.Load()
}

func (a *App) LoadBootstrapStateV2() (bootstrap.StateV2, error) {
	return bootstrap.LoadV2()
}

// LoadCollectionWorkspace hydrates one non-active workspace on first access.
func (a *App) LoadCollectionWorkspace(workspaceID string) (string, error) {
	return collectionsstore.LoadWorkspace(workspaceID)
}

// SaveCollectionWorkspaces atomically updates the v3 shards and the complete
// v2 compatibility snapshot outside the startup critical path.
func (a *App) SaveCollectionWorkspaces(indexJSON string, workspaceJSON []string) error {
	return collectionsstore.Save(indexJSON, workspaceJSON)
}

// RecordStartupPerformance appends one timing-only sample after the renderer's
// first stable frame. The internal recorder is local-only and independent from
// Dev Log cleanup, so medians can be calculated across process launches.
func (a *App) RecordStartupPerformance(frontendJSON string) error {
	return startupperf.Record(dataDir(), frontendJSON, a.startupStages)
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
	if a.desktop == nil {
		return "", fmt.Errorf("app context not initialized")
	}
	if strings.TrimSpace(defaultName) == "" {
		defaultName = "export.bin"
	}
	data, err := base64.StdEncoding.DecodeString(dataBase64)
	if err != nil {
		return "", fmt.Errorf("invalid base64 payload: %w", err)
	}
	path, err := a.desktop.Dialog.SaveFile().
		SetFilename(filepath.Base(defaultName)).
		PromptForSingleSelection()
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
