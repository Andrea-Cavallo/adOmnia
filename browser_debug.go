package main

import (
	"encoding/json"
	"fmt"
	"io"
	"log"
	"net"
	"net/http"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"sync"
	"sync/atomic"
	"time"

	"github.com/gorilla/websocket"
)

// DebugNetworkEntry represents a captured network request/response pair.
type DebugNetworkEntry struct {
	ID              string            `json:"id"`
	URL             string            `json:"url"`
	Method          string            `json:"method"`
	Status          int               `json:"status"`
	StatusText      string            `json:"statusText"`
	MimeType        string            `json:"mimeType"`
	RequestHeaders  map[string]string `json:"requestHeaders"`
	ResponseHeaders map[string]string `json:"responseHeaders"`
	Timestamp       float64           `json:"timestamp"`
	Duration        float64           `json:"duration"`
	Size            int64             `json:"size"`
	Completed       bool              `json:"completed"`
}

// cdpMessage represents a Chrome DevTools Protocol JSON-RPC message.
type cdpMessage struct {
	ID     int                    `json:"id"`
	Method string                 `json:"method,omitempty"`
	Params map[string]interface{} `json:"params,omitempty"`
	Result json.RawMessage        `json:"result,omitempty"`
	Error  *cdpError              `json:"error,omitempty"`
}

type cdpError struct {
	Code    int    `json:"code"`
	Message string `json:"message"`
}

const (
	maxTrafficEntries = 500
	cdpDebugPort      = 9223
)

// BrowserDebug manages a spawned browser process with CDP connectivity for network capture.
type BrowserDebug struct {
	mu         sync.Mutex
	conn       *websocket.Conn
	process    *exec.Cmd
	connected  bool
	traffic    []DebugNetworkEntry
	msgID      atomic.Int64
	pending    map[int]chan cdpMessage
	pendingMu  sync.Mutex
	stopCh     chan struct{}
	debugPort  int    // dynamically assigned CDP port for this session
	profileDir string // per-session temporary profile directory
}

// NewBrowserDebug creates a new BrowserDebug instance.
func NewBrowserDebug() *BrowserDebug {
	return &BrowserDebug{
		traffic:   make([]DebugNetworkEntry, 0, maxTrafficEntries),
		pending:   make(map[int]chan cdpMessage),
		debugPort: findFreePort(cdpDebugPort),
	}
}

// LaunchBrowser spawns a browser process with remote debugging enabled, pointing to the given URL.
func (b *BrowserDebug) LaunchBrowser(url string) error {
	b.mu.Lock()
	defer b.mu.Unlock()

	if b.process != nil {
		return fmt.Errorf("browser already launched; stop it first")
	}

	browserPath := findBrowserExecutable()
	if browserPath == "" {
		return fmt.Errorf("no supported browser found (looked for msedge.exe, chrome.exe)")
	}

	if b.debugPort == 0 {
		b.debugPort = findFreePort(cdpDebugPort)
	}

	profileDir, err := os.MkdirTemp("", "adomnia-debug-*")
	if err != nil {
		return fmt.Errorf("failed to create temp profile dir: %w", err)
	}
	b.profileDir = profileDir

	args := []string{
		fmt.Sprintf("--remote-debugging-port=%d", b.debugPort),
		"--no-first-run",
		"--no-default-browser-check",
		fmt.Sprintf("--user-data-dir=%s", profileDir),
		url,
	}

	cmd := exec.Command(browserPath, args...)
	cmd.Stdout = nil
	cmd.Stderr = nil

	if err := cmd.Start(); err != nil {
		os.RemoveAll(profileDir)
		b.profileDir = ""
		return fmt.Errorf("failed to launch browser: %w", err)
	}

	b.process = cmd
	log.Printf("[debug] launched browser: %s (pid %d, port %d, profile %s)", browserPath, cmd.Process.Pid, b.debugPort, profileDir)
	return nil
}

// Connect establishes a WebSocket connection to the CDP debug target and enables the Network domain.
func (b *BrowserDebug) Connect() error {
	b.mu.Lock()
	if b.connected {
		b.mu.Unlock()
		return fmt.Errorf("already connected")
	}
	b.mu.Unlock()

	// Fetch the list of debug targets
	wsURL, err := b.discoverDebugTarget()
	if err != nil {
		return fmt.Errorf("failed to discover debug target: %w", err)
	}

	log.Printf("[debug] connecting to CDP at %s", wsURL)

	dialer := websocket.Dialer{
		HandshakeTimeout: 5 * time.Second,
	}
	conn, _, err := dialer.Dial(wsURL, nil)
	if err != nil {
		return fmt.Errorf("failed to connect to CDP: %w", err)
	}

	b.mu.Lock()
	b.conn = conn
	b.connected = true
	b.stopCh = make(chan struct{})
	b.mu.Unlock()

	// Start reader loop
	go b.readerLoop()

	// Enable Network domain
	if err := b.sendCommand("Network.enable", nil); err != nil {
		b.Disconnect()
		return fmt.Errorf("failed to enable Network domain: %w", err)
	}
	if err := b.disableBrowserCache(); err != nil {
		log.Printf("[debug] warning: failed to disable browser cache: %v", err)
	}

	log.Printf("[debug] CDP connected, Network domain enabled, cache disabled")
	return nil
}

// Disconnect closes the WebSocket connection to CDP.
func (b *BrowserDebug) Disconnect() error {
	b.mu.Lock()
	defer b.mu.Unlock()

	if !b.connected {
		return nil
	}

	b.connected = false
	close(b.stopCh)

	if b.conn != nil {
		err := b.conn.Close()
		b.conn = nil
		if err != nil {
			return fmt.Errorf("failed to close CDP connection: %w", err)
		}
	}

	log.Printf("[debug] CDP disconnected")
	return nil
}

// IsConnected returns whether the CDP WebSocket connection is active.
func (b *BrowserDebug) IsConnected() bool {
	b.mu.Lock()
	defer b.mu.Unlock()
	return b.connected
}

// GetTraffic returns all captured network entries.
func (b *BrowserDebug) GetTraffic() []DebugNetworkEntry {
	b.mu.Lock()
	defer b.mu.Unlock()
	result := make([]DebugNetworkEntry, len(b.traffic))
	copy(result, b.traffic)
	return result
}

// GetTrafficFiltered returns entries matching the given filter by URL substring or HTTP method.
func (b *BrowserDebug) GetTrafficFiltered(filter string) []DebugNetworkEntry {
	b.mu.Lock()
	defer b.mu.Unlock()

	filterLower := strings.ToLower(filter)
	var result []DebugNetworkEntry
	for _, entry := range b.traffic {
		if strings.Contains(strings.ToLower(entry.URL), filterLower) ||
			strings.EqualFold(entry.Method, filter) {
			result = append(result, entry)
		}
	}
	return result
}

// GetRequestBody fetches the posted data for a given request via CDP.
func (b *BrowserDebug) GetRequestBody(requestId string) (string, error) {
	b.mu.Lock()
	if !b.connected {
		b.mu.Unlock()
		return "", fmt.Errorf("not connected to CDP")
	}
	b.mu.Unlock()

	result, err := b.sendCommandWithResult("Network.getRequestPostData", map[string]interface{}{
		"requestId": requestId,
	})
	if err != nil {
		return "", fmt.Errorf("failed to get request body: %w", err)
	}

	var resp struct {
		PostData string `json:"postData"`
	}
	if err := json.Unmarshal(result, &resp); err != nil {
		return "", fmt.Errorf("failed to parse request body response: %w", err)
	}
	return resp.PostData, nil
}

// GetResponseBody fetches the response body for a given request via CDP Network.getResponseBody.
func (b *BrowserDebug) GetResponseBody(requestId string) (string, error) {
	b.mu.Lock()
	if !b.connected {
		b.mu.Unlock()
		return "", fmt.Errorf("not connected to CDP")
	}
	b.mu.Unlock()

	result, err := b.sendCommandWithResult("Network.getResponseBody", map[string]interface{}{
		"requestId": requestId,
	})
	if err != nil {
		return "", fmt.Errorf("failed to get response body: %w", err)
	}

	var resp struct {
		Body          string `json:"body"`
		Base64Encoded bool   `json:"base64Encoded"`
	}
	if err := json.Unmarshal(result, &resp); err != nil {
		return "", fmt.Errorf("failed to parse response body: %w", err)
	}
	return resp.Body, nil
}

// ClearTraffic removes all captured network entries.
func (b *BrowserDebug) ClearTraffic() {
	b.mu.Lock()
	defer b.mu.Unlock()
	b.traffic = make([]DebugNetworkEntry, 0, maxTrafficEntries)
	log.Printf("[debug] traffic cleared")
}

// StopBrowser kills the spawned browser process and cleans up the temporary profile.
func (b *BrowserDebug) StopBrowser() error {
	b.Disconnect()

	b.mu.Lock()
	defer b.mu.Unlock()

	if b.process == nil {
		return nil
	}

	profileDir := b.profileDir

	if b.process.Process != nil {
		if err := b.process.Process.Kill(); err != nil {
			return fmt.Errorf("failed to kill browser process: %w", err)
		}
		b.process.Wait()
		log.Printf("[debug] browser process killed (pid %d)", b.process.Process.Pid)
	}

	b.process = nil
	b.profileDir = ""

	if profileDir != "" {
		go func(dir string) {
			time.Sleep(2 * time.Second)
			if err := os.RemoveAll(dir); err != nil {
				log.Printf("[debug] failed to clean profile dir %s: %v", dir, err)
			} else {
				log.Printf("[debug] cleaned profile dir: %s", dir)
			}
		}(profileDir)
	}

	return nil
}

// sendCommand sends a CDP command without waiting for a specific result.
func (b *BrowserDebug) sendCommand(method string, params map[string]interface{}) error {
	_, err := b.sendCommandWithResult(method, params)
	return err
}

// sendCommandWithResult sends a CDP command and waits for the result.
func (b *BrowserDebug) sendCommandWithResult(method string, params map[string]interface{}) (json.RawMessage, error) {
	id := int(b.msgID.Add(1))

	msg := cdpMessage{
		ID:     id,
		Method: method,
		Params: params,
	}

	data, err := json.Marshal(msg)
	if err != nil {
		return nil, fmt.Errorf("failed to marshal CDP message: %w", err)
	}

	// Register pending response channel
	ch := make(chan cdpMessage, 1)
	b.pendingMu.Lock()
	b.pending[id] = ch
	b.pendingMu.Unlock()

	defer func() {
		b.pendingMu.Lock()
		delete(b.pending, id)
		b.pendingMu.Unlock()
	}()

	b.mu.Lock()
	conn := b.conn
	b.mu.Unlock()

	if conn == nil {
		return nil, fmt.Errorf("no active CDP connection")
	}

	if err := conn.WriteMessage(websocket.TextMessage, data); err != nil {
		return nil, fmt.Errorf("failed to send CDP message: %w", err)
	}

	// Wait for response with timeout
	select {
	case resp := <-ch:
		if resp.Error != nil {
			return nil, fmt.Errorf("CDP error %d: %s", resp.Error.Code, resp.Error.Message)
		}
		return resp.Result, nil
	case <-time.After(10 * time.Second):
		return nil, fmt.Errorf("CDP command timed out: %s", method)
	}
}

// readerLoop reads messages from the CDP WebSocket and dispatches them.
func (b *BrowserDebug) readerLoop() {
	for {
		b.mu.Lock()
		conn := b.conn
		connected := b.connected
		b.mu.Unlock()

		if !connected || conn == nil {
			return
		}

		_, data, err := conn.ReadMessage()
		if err != nil {
			b.mu.Lock()
			stillConnected := b.connected
			b.mu.Unlock()
			if stillConnected {
				log.Printf("[debug] CDP read error: %v", err)
			}
			return
		}

		var msg cdpMessage
		if err := json.Unmarshal(data, &msg); err != nil {
			log.Printf("[debug] failed to parse CDP message: %v", err)
			continue
		}

		// If it has an ID, it's a response to a command
		if msg.ID > 0 {
			b.pendingMu.Lock()
			ch, ok := b.pending[msg.ID]
			b.pendingMu.Unlock()
			if ok {
				ch <- msg
			}
			continue
		}

		// Otherwise it's an event
		b.handleEvent(msg)
	}
}

// handleEvent processes CDP events for network capture, console, and debugger.
func (b *BrowserDebug) handleEvent(msg cdpMessage) {
	switch msg.Method {
	case "Network.requestWillBeSent":
		b.handleRequestWillBeSent(msg.Params)
	case "Network.responseReceived":
		b.handleResponseReceived(msg.Params)
	case "Network.loadingFinished":
		b.handleLoadingFinished(msg.Params)
	case "Runtime.consoleAPICalled":
		b.HandleConsoleEvent(msg.Params)
	case "Debugger.paused", "Debugger.resumed", "Debugger.scriptParsed":
		b.HandleDebuggerEvent(msg.Method, msg.Params)
	}
}

func (b *BrowserDebug) handleRequestWillBeSent(params map[string]interface{}) {
	requestID, _ := params["requestId"].(string)
	timestamp, _ := params["timestamp"].(float64)

	request, _ := params["request"].(map[string]interface{})
	if request == nil {
		return
	}

	url, _ := request["url"].(string)
	method, _ := request["method"].(string)
	headers := extractHeaders(request["headers"])

	entry := DebugNetworkEntry{
		ID:             requestID,
		URL:            url,
		Method:         method,
		RequestHeaders: headers,
		Timestamp:      timestamp,
		Completed:      false,
	}

	b.mu.Lock()
	defer b.mu.Unlock()

	// Evict oldest if at capacity
	if len(b.traffic) >= maxTrafficEntries {
		b.traffic = b.traffic[1:]
	}
	b.traffic = append(b.traffic, entry)
}

func (b *BrowserDebug) handleResponseReceived(params map[string]interface{}) {
	requestID, _ := params["requestId"].(string)

	response, _ := params["response"].(map[string]interface{})
	if response == nil {
		return
	}

	status := int(toFloat64(response["status"]))
	statusText, _ := response["statusText"].(string)
	mimeType, _ := response["mimeType"].(string)
	headers := extractHeaders(response["headers"])

	b.mu.Lock()
	defer b.mu.Unlock()

	for i := len(b.traffic) - 1; i >= 0; i-- {
		if b.traffic[i].ID == requestID {
			b.traffic[i].Status = status
			b.traffic[i].StatusText = statusText
			b.traffic[i].MimeType = mimeType
			b.traffic[i].ResponseHeaders = headers
			break
		}
	}
}

func (b *BrowserDebug) handleLoadingFinished(params map[string]interface{}) {
	requestID, _ := params["requestId"].(string)
	timestamp, _ := params["timestamp"].(float64)
	encodedDataLength := int64(toFloat64(params["encodedDataLength"]))

	b.mu.Lock()
	defer b.mu.Unlock()

	for i := len(b.traffic) - 1; i >= 0; i-- {
		if b.traffic[i].ID == requestID {
			b.traffic[i].Completed = true
			b.traffic[i].Size = encodedDataLength
			if b.traffic[i].Timestamp > 0 && timestamp > 0 {
				b.traffic[i].Duration = timestamp - b.traffic[i].Timestamp
			}
			break
		}
	}
}

// DebugStatus carries runtime status for the browser debug session.
type DebugStatus struct {
	Connected  bool   `json:"connected"`
	Port       int    `json:"port"`
	ProfileDir string `json:"profileDir"`
	BrowserPID int    `json:"browserPid"`
}

// GetDebugStatus returns the current debug port, profile path, and connection state.
func (b *BrowserDebug) GetDebugStatus() DebugStatus {
	b.mu.Lock()
	defer b.mu.Unlock()
	s := DebugStatus{
		Connected:  b.connected,
		Port:       b.debugPort,
		ProfileDir: b.profileDir,
	}
	if b.process != nil && b.process.Process != nil {
		s.BrowserPID = b.process.Process.Pid
	}
	return s
}

// findFreePort tries to find an available TCP port starting from base.
// If the base port is unavailable it scans the next 99 ports, then falls back to an OS-assigned port.
func findFreePort(base int) int {
	for port := base; port < base+100; port++ {
		ln, err := net.Listen("tcp", fmt.Sprintf("127.0.0.1:%d", port))
		if err == nil {
			ln.Close()
			return port
		}
	}
	ln, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		log.Printf("[debug] WARNING: could not bind any port: %v", err)
		return base
	}
	defer ln.Close()
	return ln.Addr().(*net.TCPAddr).Port
}

// discoverDebugTarget queries the CDP /json endpoint to find the first page target's WS URL.
func (b *BrowserDebug) discoverDebugTarget() (string, error) {
	port := b.debugPort
	if port == 0 {
		port = cdpDebugPort
	}
	client := &http.Client{Timeout: 5 * time.Second}

	// Retry a few times as the browser may still be starting
	var lastErr error
	for attempt := 0; attempt < 10; attempt++ {
		resp, err := client.Get(fmt.Sprintf("http://localhost:%d/json", port))
		if err != nil {
			lastErr = err
			time.Sleep(500 * time.Millisecond)
			continue
		}

		body, err := io.ReadAll(resp.Body)
		resp.Body.Close()
		if err != nil {
			lastErr = err
			time.Sleep(500 * time.Millisecond)
			continue
		}

		var targets []struct {
			Type                 string `json:"type"`
			WebSocketDebuggerURL string `json:"webSocketDebuggerUrl"`
		}
		if err := json.Unmarshal(body, &targets); err != nil {
			lastErr = err
			time.Sleep(500 * time.Millisecond)
			continue
		}

		for _, t := range targets {
			if t.Type == "page" && t.WebSocketDebuggerURL != "" {
				return t.WebSocketDebuggerURL, nil
			}
		}

		lastErr = fmt.Errorf("no page target found in %d targets", len(targets))
		time.Sleep(500 * time.Millisecond)
	}

	return "", fmt.Errorf("could not discover debug target after retries: %w", lastErr)
}

// findBrowserExecutable searches Windows paths for Edge or Chrome.
func findBrowserExecutable() string {
	candidates := buildBrowserCandidates()
	for _, path := range candidates {
		if _, err := os.Stat(path); err == nil {
			log.Printf("[debug] found browser at: %s", path)
			return path
		}
	}
	return ""
}

// buildBrowserCandidates returns a list of potential browser executable paths on Windows.
func buildBrowserCandidates() []string {
	var paths []string

	localAppData := os.Getenv("LOCALAPPDATA")
	programFiles := os.Getenv("ProgramFiles")
	programFilesX86 := os.Getenv("ProgramFiles(x86)")

	// Microsoft Edge paths
	edgeRelative := filepath.Join("Microsoft", "Edge", "Application", "msedge.exe")
	if programFilesX86 != "" {
		paths = append(paths, filepath.Join(programFilesX86, edgeRelative))
	}
	if programFiles != "" {
		paths = append(paths, filepath.Join(programFiles, edgeRelative))
	}
	if localAppData != "" {
		paths = append(paths, filepath.Join(localAppData, edgeRelative))
	}

	// Google Chrome paths
	chromeRelative := filepath.Join("Google", "Chrome", "Application", "chrome.exe")
	if programFiles != "" {
		paths = append(paths, filepath.Join(programFiles, chromeRelative))
	}
	if programFilesX86 != "" {
		paths = append(paths, filepath.Join(programFilesX86, chromeRelative))
	}
	if localAppData != "" {
		paths = append(paths, filepath.Join(localAppData, chromeRelative))
	}

	return paths
}

// extractHeaders converts a CDP headers object (map[string]interface{}) to map[string]string.
func extractHeaders(raw interface{}) map[string]string {
	result := make(map[string]string)
	if raw == nil {
		return result
	}
	m, ok := raw.(map[string]interface{})
	if !ok {
		return result
	}
	for k, v := range m {
		if s, ok := v.(string); ok {
			result[k] = s
		} else {
			result[k] = fmt.Sprintf("%v", v)
		}
	}
	return result
}

// toFloat64 safely converts an interface{} to float64.
func toFloat64(v interface{}) float64 {
	switch n := v.(type) {
	case float64:
		return n
	case int:
		return float64(n)
	case int64:
		return float64(n)
	case json.Number:
		f, _ := n.Float64()
		return f
	default:
		return 0
	}
}
