// Plugin runtime with isolated JavaScript execution and permission-aware host APIs.
// The exported WasmRuntime name is retained for Wails binding compatibility.

package plugins

import (
	"adomnia/internal/storage"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"log"
	"net"
	"net/http"
	"os"
	"strings"
	"sync"
	"time"

	bolt "go.etcd.io/bbolt"
)

// HostFunction is a callable function that plugins can invoke from their sandbox.
type HostFunction func(ctx context.Context, args json.RawMessage) (json.RawMessage, error)

// PluginNotification is emitted by the permission-gated ui.notify host API.
type PluginNotification struct {
	PluginID string `json:"pluginId"`
	Title    string `json:"title"`
	Message  string `json:"message"`
	Type     string `json:"type"`
}

var (
	notifierMu sync.RWMutex
	notifier   func(PluginNotification)
)

// ConfigureNotifier connects ui.notify to the desktop event layer.
func ConfigureNotifier(callback func(PluginNotification)) {
	notifierMu.Lock()
	notifier = callback
	notifierMu.Unlock()
}

// WasmRuntime manages plugin sandboxes and execution.
type WasmRuntime struct {
	mu          sync.Mutex
	sandboxes   map[string]*PluginSandbox
	memoryLimit int64
	timeLimit   time.Duration
	manager     *PluginManager
}

// PluginSandbox is an isolated execution environment for a single plugin.
type PluginSandbox struct {
	PluginID  string                  `json:"pluginId"`
	Memory    int64                   `json:"memory"`
	MaxMemory int64                   `json:"maxMemory"`
	Timeout   time.Duration           `json:"-"`
	HostFuncs map[string]HostFunction `json:"-"`
	Running   bool                    `json:"running"`
}

// ExecRequest describes a function call to execute in a plugin sandbox.
type ExecRequest struct {
	PluginID string                 `json:"pluginId"`
	Function string                 `json:"function"`
	Args     map[string]interface{} `json:"args"`
}

// ExecResult is the outcome of a sandbox execution.
type ExecResult struct {
	Success bool        `json:"success"`
	Data    interface{} `json:"data,omitempty"`
	Error   string      `json:"error,omitempty"`
	MemUsed int64       `json:"memUsed"`
	TimeMs  float64     `json:"timeMs"`
}

// defaultHostFunctions are safe functions that plugins can call.
var defaultHostFunctions = map[string]HostFunction{
	"http.fetch":     hostHTTPFetch,
	"storage.get":    hostStorageGet,
	"storage.set":    hostStorageSet,
	"storage.delete": hostStorageDelete,
	"log.info":       hostLogInfo,
	"log.error":      hostLogError,
	"ui.notify":      hostUINotify,
	"env.get":        hostEnvGet,
}

// NewWasmRuntime creates a new WasmRuntime instance.
func NewWasmRuntime() *WasmRuntime {
	return &WasmRuntime{
		sandboxes:   make(map[string]*PluginSandbox),
		memoryLimit: 64 * 1024 * 1024,
		timeLimit:   10 * time.Second,
	}
}

func (wr *WasmRuntime) attachManager(manager *PluginManager) {
	wr.mu.Lock()
	wr.manager = manager
	wr.mu.Unlock()
}

// Init initializes the runtime with default limits (64MB memory, 10s timeout).
func (wr *WasmRuntime) Init() error {
	wr.mu.Lock()
	defer wr.mu.Unlock()

	if wr.memoryLimit <= 0 {
		wr.memoryLimit = 64 * 1024 * 1024
	}
	if wr.timeLimit <= 0 {
		wr.timeLimit = 10 * time.Second
	}

	log.Printf("[plugins] runtime initialized: memoryLimit=%dMB, timeLimit=%s",
		wr.memoryLimit/(1024*1024), wr.timeLimit)
	return nil
}

func (wr *WasmRuntime) ensureSandbox(pluginID string) *PluginSandbox {
	if sandbox, exists := wr.sandboxes[pluginID]; exists {
		return sandbox
	}
	hostFuncs := make(map[string]HostFunction, len(defaultHostFunctions))
	for name, fn := range defaultHostFunctions {
		hostFuncs[name] = fn
	}
	sandbox := &PluginSandbox{
		PluginID:  pluginID,
		MaxMemory: wr.memoryLimit,
		Timeout:   wr.timeLimit,
		HostFuncs: hostFuncs,
	}
	wr.sandboxes[pluginID] = sandbox
	return sandbox
}

// CreateSandbox creates an isolated sandbox for a plugin.
func (wr *WasmRuntime) CreateSandbox(pluginID string) error {
	wr.mu.Lock()
	defer wr.mu.Unlock()

	if _, exists := wr.sandboxes[pluginID]; exists {
		return fmt.Errorf("sandbox already exists for plugin: %s", pluginID)
	}

	hostFuncs := make(map[string]HostFunction, len(defaultHostFunctions))
	for name, fn := range defaultHostFunctions {
		hostFuncs[name] = fn
	}

	wr.sandboxes[pluginID] = &PluginSandbox{
		PluginID:  pluginID,
		Memory:    0,
		MaxMemory: wr.memoryLimit,
		Timeout:   wr.timeLimit,
		HostFuncs: hostFuncs,
		Running:   false,
	}

	log.Printf("[plugins] sandbox created for plugin: %s", pluginID)
	return nil
}

// DestroySandbox removes and cleans up a plugin's sandbox.
func (wr *WasmRuntime) DestroySandbox(pluginID string) error {
	wr.mu.Lock()
	defer wr.mu.Unlock()

	sandbox, exists := wr.sandboxes[pluginID]
	if !exists {
		return fmt.Errorf("sandbox not found for plugin: %s", pluginID)
	}

	if sandbox.Running {
		return fmt.Errorf("cannot destroy sandbox while running: %s", pluginID)
	}

	delete(wr.sandboxes, pluginID)
	log.Printf("[plugins] sandbox destroyed for plugin: %s", pluginID)
	return nil
}

// Execute runs a function in a plugin's sandbox with timeout and memory tracking.
func (wr *WasmRuntime) Execute(req ExecRequest) ExecResult {
	wr.mu.Lock()
	sandbox := wr.ensureSandbox(req.PluginID)
	manager := wr.manager

	if sandbox.Running {
		wr.mu.Unlock()
		return failedExecResult(fmt.Errorf("sandbox already running for plugin: %s", req.PluginID))
	}

	sandbox.Running = true
	timeLimit := sandbox.Timeout
	memoryLimit := sandbox.MaxMemory
	wr.mu.Unlock()
	defer func() {
		wr.mu.Lock()
		sandbox.Running = false
		wr.mu.Unlock()
	}()

	start := time.Now()
	if manager == nil {
		return timedExecError(start, fmt.Errorf("plugin runtime is not attached to the plugin manager"))
	}
	plugin, err := manager.pluginForExecution(req.PluginID)
	if err != nil {
		return timedExecError(start, err)
	}
	if plugin.Manifest.Runtime != "js" {
		return timedExecError(start, fmt.Errorf("runtime %s is not executable", plugin.Manifest.Runtime))
	}
	data, memUsed, err := executeJavaScriptPlugin(plugin, req.Function, req.Args, sandbox.HostFuncs, timeLimit, memoryLimit)
	if err != nil {
		result := timedExecError(start, err)
		result.MemUsed = memUsed
		return result
	}
	wr.mu.Lock()
	sandbox.Memory = memUsed
	wr.mu.Unlock()
	return ExecResult{
		Success: true,
		Data:    data,
		MemUsed: memUsed,
		TimeMs:  float64(time.Since(start).Microseconds()) / 1000,
	}
}

func failedExecResult(err error) ExecResult {
	return ExecResult{Success: false, Error: err.Error()}
}

func timedExecError(start time.Time, err error) ExecResult {
	return ExecResult{Success: false, Error: err.Error(), TimeMs: float64(time.Since(start).Microseconds()) / 1000}
}

// GetSandboxStatus returns the current status of a plugin's sandbox.
func (wr *WasmRuntime) GetSandboxStatus(pluginID string) (*PluginSandbox, error) {
	wr.mu.Lock()
	defer wr.mu.Unlock()

	sandbox := wr.ensureSandbox(pluginID)

	// Return a copy without the host functions
	return &PluginSandbox{
		PluginID:  sandbox.PluginID,
		Memory:    sandbox.Memory,
		MaxMemory: sandbox.MaxMemory,
		Timeout:   sandbox.Timeout,
		Running:   sandbox.Running,
	}, nil
}

// SetMemoryLimit sets the per-plugin memory limit in bytes.
func (wr *WasmRuntime) SetMemoryLimit(pluginID string, bytes int64) error {
	wr.mu.Lock()
	defer wr.mu.Unlock()

	sandbox, exists := wr.sandboxes[pluginID]
	if !exists {
		return fmt.Errorf("sandbox not found for plugin: %s", pluginID)
	}

	if bytes <= 0 {
		return fmt.Errorf("memory limit must be positive")
	}

	sandbox.MaxMemory = bytes
	log.Printf("[plugins] memory limit set for %s: %d bytes", pluginID, bytes)
	return nil
}

// SetTimeLimit sets the per-plugin execution time limit.
func (wr *WasmRuntime) SetTimeLimit(pluginID string, ms int64) error {
	wr.mu.Lock()
	defer wr.mu.Unlock()

	sandbox, exists := wr.sandboxes[pluginID]
	if !exists {
		return fmt.Errorf("sandbox not found for plugin: %s", pluginID)
	}

	if ms <= 0 {
		return fmt.Errorf("time limit must be positive")
	}

	sandbox.Timeout = time.Duration(ms) * time.Millisecond
	log.Printf("[plugins] time limit set for %s: %dms", pluginID, ms)
	return nil
}

// GetRuntimeMode returns the current execution mode of the plugin runtime.
func (wr *WasmRuntime) GetRuntimeMode() map[string]interface{} {
	return map[string]interface{}{
		"mode":        "javascript",
		"description": "Installed JavaScript entrypoints execute in an isolated goja runtime with permissions, timeout and I/O memory limits.",
		"jsReady":     true,
		"wasmReady":   false,
	}
}

// GetHostFunctions returns a list of available host function names.
func (wr *WasmRuntime) GetHostFunctions() []string {
	names := make([]string, 0, len(defaultHostFunctions))
	for name := range defaultHostFunctions {
		names = append(names, name)
	}
	return names
}

// --- Host Function Implementations ---

// allowedEnvVars is the allowlist for env.get to prevent leaking secrets.
var allowedEnvVars = map[string]bool{
	"PATH":        true,
	"HOME":        true,
	"USERPROFILE": true,
	"APPDATA":     true,
	"TEMP":        true,
	"TMP":         true,
}

// hostHTTPFetch makes an HTTP request with restrictions:
// max 10s timeout, max 1MB response, blocked private IPs.
func hostHTTPFetch(ctx context.Context, args json.RawMessage) (json.RawMessage, error) {
	var params struct {
		URL     string            `json:"url"`
		Method  string            `json:"method"`
		Headers map[string]string `json:"headers"`
		Body    string            `json:"body"`
	}
	if err := json.Unmarshal(args, &params); err != nil {
		return nil, fmt.Errorf("invalid args for http.fetch: %w", err)
	}

	if params.URL == "" {
		return nil, fmt.Errorf("url is required")
	}
	if params.Method == "" {
		params.Method = "GET"
	}

	// Block private IPs
	if err := checkPrivateIP(params.URL); err != nil {
		return nil, err
	}

	client := &http.Client{
		Timeout: 10 * time.Second,
	}

	var bodyReader io.Reader
	if params.Body != "" {
		bodyReader = strings.NewReader(params.Body)
	}

	req, err := http.NewRequestWithContext(ctx, params.Method, params.URL, bodyReader)
	if err != nil {
		return nil, fmt.Errorf("failed to create request: %w", err)
	}

	for k, v := range params.Headers {
		req.Header.Set(k, v)
	}

	resp, err := client.Do(req)
	if err != nil {
		return nil, fmt.Errorf("request failed: %w", err)
	}
	defer resp.Body.Close()

	// Limit response to 1MB
	body, err := io.ReadAll(io.LimitReader(resp.Body, 1*1024*1024))
	if err != nil {
		return nil, fmt.Errorf("failed to read response: %w", err)
	}

	headers := make(map[string]string)
	for k := range resp.Header {
		headers[k] = resp.Header.Get(k)
	}

	result := map[string]interface{}{
		"status":  resp.StatusCode,
		"headers": headers,
		"body":    string(body),
	}

	return json.Marshal(result)
}

// checkPrivateIP blocks requests to private/loopback addresses.
func checkPrivateIP(rawURL string) error {
	// Extract host from URL
	// Simple approach: find host portion
	host := rawURL
	if idx := strings.Index(host, "://"); idx != -1 {
		host = host[idx+3:]
	}
	if idx := strings.Index(host, "/"); idx != -1 {
		host = host[:idx]
	}
	if idx := strings.Index(host, ":"); idx != -1 {
		host = host[:idx]
	}

	// Resolve to IP
	ips, err := net.LookupHost(host)
	if err != nil {
		// Allow if we can't resolve — the HTTP client will fail anyway
		return nil
	}

	for _, ipStr := range ips {
		ip := net.ParseIP(ipStr)
		if ip == nil {
			continue
		}
		if ip.IsLoopback() || ip.IsPrivate() || ip.IsLinkLocalUnicast() || ip.IsLinkLocalMulticast() {
			return fmt.Errorf("blocked: request to private/loopback address %s", ipStr)
		}
	}

	return nil
}

// hostStorageGet reads from plugin's own storage namespace in bbolt.
func hostStorageGet(_ context.Context, args json.RawMessage) (json.RawMessage, error) {
	var params struct {
		Key      string `json:"key"`
		PluginID string `json:"pluginId"`
	}
	if err := json.Unmarshal(args, &params); err != nil {
		return nil, fmt.Errorf("invalid args for storage.get: %w", err)
	}

	if params.Key == "" {
		return nil, fmt.Errorf("key is required")
	}

	if storage.DB() == nil {
		return nil, fmt.Errorf("storage not available")
	}

	storageKey := params.PluginID + ":" + params.Key

	var value []byte
	err := storage.DB().View(func(tx *bolt.Tx) error {
		b := tx.Bucket([]byte("plugin_storage"))
		if b == nil {
			return nil
		}
		v := b.Get([]byte(storageKey))
		if v != nil {
			value = make([]byte, len(v))
			copy(value, v)
		}
		return nil
	})
	if err != nil {
		return nil, fmt.Errorf("storage read failed: %w", err)
	}

	result := map[string]interface{}{
		"key":   params.Key,
		"value": nil,
	}
	if value != nil {
		result["value"] = string(value)
	}

	return json.Marshal(result)
}

// hostStorageSet writes to plugin's own storage namespace in bbolt.
func hostStorageSet(_ context.Context, args json.RawMessage) (json.RawMessage, error) {
	var params struct {
		Key      string `json:"key"`
		Value    string `json:"value"`
		PluginID string `json:"pluginId"`
	}
	if err := json.Unmarshal(args, &params); err != nil {
		return nil, fmt.Errorf("invalid args for storage.set: %w", err)
	}

	if params.Key == "" {
		return nil, fmt.Errorf("key is required")
	}

	if storage.DB() == nil {
		return nil, fmt.Errorf("storage not available")
	}

	storageKey := params.PluginID + ":" + params.Key

	err := storage.DB().Update(func(tx *bolt.Tx) error {
		b := tx.Bucket([]byte("plugin_storage"))
		if b == nil {
			return fmt.Errorf("plugin_storage bucket not found")
		}
		return b.Put([]byte(storageKey), []byte(params.Value))
	})
	if err != nil {
		return nil, fmt.Errorf("storage write failed: %w", err)
	}

	result := map[string]interface{}{
		"ok": true,
	}
	return json.Marshal(result)
}

// hostStorageDelete removes a key from plugin's own storage namespace.
func hostStorageDelete(_ context.Context, args json.RawMessage) (json.RawMessage, error) {
	var params struct {
		Key      string `json:"key"`
		PluginID string `json:"pluginId"`
	}
	if err := json.Unmarshal(args, &params); err != nil {
		return nil, fmt.Errorf("invalid args for storage.delete: %w", err)
	}

	if params.Key == "" {
		return nil, fmt.Errorf("key is required")
	}

	if storage.DB() == nil {
		return nil, fmt.Errorf("storage not available")
	}

	storageKey := params.PluginID + ":" + params.Key

	err := storage.DB().Update(func(tx *bolt.Tx) error {
		b := tx.Bucket([]byte("plugin_storage"))
		if b == nil {
			return fmt.Errorf("plugin_storage bucket not found")
		}
		return b.Delete([]byte(storageKey))
	})
	if err != nil {
		return nil, fmt.Errorf("storage delete failed: %w", err)
	}

	result := map[string]interface{}{
		"ok": true,
	}
	return json.Marshal(result)
}

// hostLogInfo logs an info message with plugin prefix.
func hostLogInfo(_ context.Context, args json.RawMessage) (json.RawMessage, error) {
	var params struct {
		Message  string `json:"message"`
		PluginID string `json:"pluginId"`
	}
	if err := json.Unmarshal(args, &params); err != nil {
		return nil, fmt.Errorf("invalid args for log.info: %w", err)
	}

	log.Printf("[plugin:%s] INFO: %s", params.PluginID, params.Message)

	result := map[string]interface{}{"ok": true}
	return json.Marshal(result)
}

// hostLogError logs an error message with plugin prefix.
func hostLogError(_ context.Context, args json.RawMessage) (json.RawMessage, error) {
	var params struct {
		Message  string `json:"message"`
		PluginID string `json:"pluginId"`
	}
	if err := json.Unmarshal(args, &params); err != nil {
		return nil, fmt.Errorf("invalid args for log.error: %w", err)
	}

	log.Printf("[plugin:%s] ERROR: %s", params.PluginID, params.Message)

	result := map[string]interface{}{"ok": true}
	return json.Marshal(result)
}

// hostUINotify emits a desktop notification event for the frontend toast host.
func hostUINotify(_ context.Context, args json.RawMessage) (json.RawMessage, error) {
	var params struct {
		Title    string `json:"title"`
		Message  string `json:"message"`
		Type     string `json:"type"` // "info", "warning", "error", "success"
		PluginID string `json:"pluginId"`
	}
	if err := json.Unmarshal(args, &params); err != nil {
		return nil, fmt.Errorf("invalid args for ui.notify: %w", err)
	}

	if params.Type == "" {
		params.Type = "info"
	}
	switch params.Type {
	case "info", "warning", "error", "success":
	default:
		return nil, fmt.Errorf("invalid notification type: %s", params.Type)
	}
	if strings.TrimSpace(params.Message) == "" {
		return nil, fmt.Errorf("message is required")
	}

	notifierMu.RLock()
	callback := notifier
	notifierMu.RUnlock()
	if callback == nil {
		return nil, fmt.Errorf("notification host is not available")
	}
	callback(PluginNotification{
		PluginID: params.PluginID,
		Title:    params.Title,
		Message:  params.Message,
		Type:     params.Type,
	})
	log.Printf("[plugin:%s] NOTIFY [%s] %s: %s", params.PluginID, params.Type, params.Title, params.Message)

	result := map[string]interface{}{"ok": true}
	return json.Marshal(result)
}

// hostEnvGet reads an OS environment variable from the allowlist only.
func hostEnvGet(_ context.Context, args json.RawMessage) (json.RawMessage, error) {
	var params struct {
		Name string `json:"name"`
	}
	if err := json.Unmarshal(args, &params); err != nil {
		return nil, fmt.Errorf("invalid args for env.get: %w", err)
	}

	if params.Name == "" {
		return nil, fmt.Errorf("name is required")
	}

	upperName := strings.ToUpper(params.Name)
	if !allowedEnvVars[upperName] {
		return nil, fmt.Errorf("access denied: env var %s is not in allowlist", params.Name)
	}

	value := os.Getenv(upperName)

	result := map[string]interface{}{
		"name":  upperName,
		"value": value,
	}
	return json.Marshal(result)
}
