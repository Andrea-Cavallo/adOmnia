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
	"time"

	"github.com/gorilla/websocket"
)

// DebugTarget represents a discoverable browser tab/page.
type DebugTarget struct {
	ID                   string `json:"id"`
	Type                 string `json:"type"`
	Title                string `json:"title"`
	URL                  string `json:"url"`
	WebSocketDebuggerURL string `json:"webSocketDebuggerUrl"`
	DevtoolsFrontendURL  string `json:"devtoolsFrontendUrl"`
	FaviconURL           string `json:"faviconUrl"`
	Attached             bool   `json:"attached"`
}

// DebugEndpoint represents a discovered CDP endpoint (a running browser with debugging).
type DebugEndpoint struct {
	Port        int           `json:"port"`
	Host        string        `json:"host"`
	BrowserName string        `json:"browserName"`
	Version     string        `json:"version"`
	Targets     []DebugTarget `json:"targets"`
}

// BrowserInfo holds metadata from CDP /json/version.
type BrowserInfo struct {
	Browser              string `json:"Browser"`
	ProtocolVersion      string `json:"Protocol-Version"`
	UserAgent            string `json:"User-Agent"`
	V8Version            string `json:"V8-Version"`
	WebKitVersion        string `json:"WebKit-Version"`
	WebSocketDebuggerURL string `json:"webSocketDebuggerUrl"`
}

// DiscoverEndpoints scans known ports for active CDP endpoints.
// Returns all found browser instances with their open targets.
func (b *BrowserDebug) DiscoverEndpoints() []DebugEndpoint {
	ports := []int{9222, 9223, 9224, 9225, 9226, 9227, 9228, 9229, 9230}
	var endpoints []DebugEndpoint

	client := &http.Client{Timeout: 1 * time.Second}

	for _, port := range ports {
		info, targets, err := probePort(client, port)
		if err != nil {
			continue
		}

		browserName := "Unknown"
		version := ""
		if info != nil {
			browserName = info.Browser
			version = info.ProtocolVersion
		}

		endpoint := DebugEndpoint{
			Port:        port,
			Host:        "localhost",
			BrowserName: browserName,
			Version:     version,
			Targets:     targets,
		}
		endpoints = append(endpoints, endpoint)
	}

	log.Printf("[debug] discovered %d CDP endpoints", len(endpoints))
	return endpoints
}

// ListTargets fetches all available debug targets from a specific port.
func (b *BrowserDebug) ListTargets(port int) ([]DebugTarget, error) {
	if port <= 0 {
		port = b.debugPort
		if port == 0 {
			port = cdpDebugPort
		}
	}

	client := &http.Client{Timeout: 3 * time.Second}
	_, targets, err := probePort(client, port)
	if err != nil {
		return nil, fmt.Errorf("failed to list targets on port %d: %w", port, err)
	}

	return targets, nil
}

// ConnectToTarget connects to a specific target by its WebSocket URL.
// This allows connecting to any open tab, not just the first one.
func (b *BrowserDebug) ConnectToTarget(wsURL string) error {
	b.mu.Lock()
	if b.connected {
		b.mu.Unlock()
		return fmt.Errorf("already connected; disconnect first")
	}
	b.mu.Unlock()

	if wsURL == "" {
		return fmt.Errorf("webSocket URL is required")
	}

	log.Printf("[debug] connecting to target: %s", wsURL)

	dialer := websocket.Dialer{
		HandshakeTimeout: 5 * time.Second,
	}
	conn, _, err := dialer.Dial(wsURL, nil)
	if err != nil {
		return fmt.Errorf("failed to connect to target: %w", err)
	}

	b.mu.Lock()
	b.conn = conn
	b.connected = true
	b.stopCh = make(chan struct{})
	b.mu.Unlock()

	go b.readerLoop()

	if err := b.sendCommand("Network.enable", nil); err != nil {
		log.Printf("[debug] warning: failed to enable Network domain: %v", err)
	}

	log.Printf("[debug] connected to target, Network domain enabled")
	return nil
}

// ConnectToTargetByID connects to a target by its target ID on a given port.
func (b *BrowserDebug) ConnectToTargetByID(port int, targetID string) error {
	if port <= 0 {
		port = b.debugPort
		if port == 0 {
			port = cdpDebugPort
		}
	}

	targets, err := b.ListTargets(port)
	if err != nil {
		return err
	}

	for _, t := range targets {
		if t.ID == targetID {
			if t.WebSocketDebuggerURL == "" {
				return fmt.Errorf("target %s has no webSocket URL (may already be attached)", targetID)
			}
			return b.ConnectToTarget(t.WebSocketDebuggerURL)
		}
	}

	return fmt.Errorf("target %s not found on port %d", targetID, port)
}

// EnableDebuggingOnBrowser attempts to launch the default browser with remote debugging enabled.
// Unlike LaunchBrowser which opens a URL, this just enables debugging on a fresh profile.
func (b *BrowserDebug) EnableDebuggingOnBrowser(port int) error {
	if port <= 0 {
		port = b.debugPort
		if port == 0 {
			port = findFreePort(cdpDebugPort)
			b.debugPort = port
		}
	}

	if isPortOpen(port) {
		return fmt.Errorf("port %d already in use (browser may already have debugging enabled)", port)
	}

	browserPath := findBrowserExecutable()
	if browserPath == "" {
		return fmt.Errorf("no supported browser found")
	}

	profileDir, err := os.MkdirTemp("", "adomnia-debug-*")
	if err != nil {
		return fmt.Errorf("failed to create temp profile dir: %w", err)
	}
	b.profileDir = profileDir

	args := []string{
		fmt.Sprintf("--remote-debugging-port=%d", port),
		"--no-first-run",
		"--no-default-browser-check",
		fmt.Sprintf("--user-data-dir=%s", profileDir),
	}

	cmd := exec.Command(browserPath, args...)
	cmd.Stdout = nil
	cmd.Stderr = nil

	if err := cmd.Start(); err != nil {
		os.RemoveAll(profileDir)
		b.profileDir = ""
		return fmt.Errorf("failed to launch browser with debugging: %w", err)
	}

	b.mu.Lock()
	b.process = cmd
	b.debugPort = port
	b.mu.Unlock()

	log.Printf("[debug] launched browser with debugging on port %d (pid=%d, profile=%s)", port, cmd.Process.Pid, profileDir)
	return nil
}

// NavigateTarget navigates the connected target to a new URL.
func (b *BrowserDebug) NavigateTarget(url string) error {
	b.mu.Lock()
	if !b.connected {
		b.mu.Unlock()
		return fmt.Errorf("not connected to CDP")
	}
	b.mu.Unlock()

	_, err := b.sendCommandWithResult("Page.navigate", map[string]interface{}{
		"url": url,
	})
	if err != nil {
		return fmt.Errorf("failed to navigate: %w", err)
	}

	log.Printf("[debug] navigated to %s", url)
	return nil
}

// GetTargetInfo returns info about the currently connected target.
func (b *BrowserDebug) GetTargetInfo() (map[string]interface{}, error) {
	b.mu.Lock()
	if !b.connected {
		b.mu.Unlock()
		return nil, fmt.Errorf("not connected to CDP")
	}
	b.mu.Unlock()

	result, err := b.sendCommandWithResult("Target.getTargetInfo", nil)
	if err != nil {
		// Fallback: use Page.getFrameTree
		result, err = b.sendCommandWithResult("Page.getFrameTree", nil)
		if err != nil {
			return nil, fmt.Errorf("failed to get target info: %w", err)
		}
	}

	var info map[string]interface{}
	json.Unmarshal(result, &info)
	return info, nil
}

// TakeScreenshot captures a screenshot of the connected page.
func (b *BrowserDebug) TakeScreenshot(format string, quality int) (string, error) {
	b.mu.Lock()
	if !b.connected {
		b.mu.Unlock()
		return "", fmt.Errorf("not connected to CDP")
	}
	b.mu.Unlock()

	if format == "" {
		format = "png"
	}
	if quality <= 0 {
		quality = 80
	}

	params := map[string]interface{}{
		"format": format,
	}
	if format == "jpeg" || format == "webp" {
		params["quality"] = quality
	}

	result, err := b.sendCommandWithResult("Page.captureScreenshot", params)
	if err != nil {
		return "", fmt.Errorf("failed to capture screenshot: %w", err)
	}

	var resp struct {
		Data string `json:"data"`
	}
	if err := json.Unmarshal(result, &resp); err != nil {
		return "", fmt.Errorf("failed to parse screenshot response: %w", err)
	}

	return resp.Data, nil
}

// GetPageSource returns the full HTML source of the connected page.
func (b *BrowserDebug) GetPageSource() (string, error) {
	b.mu.Lock()
	if !b.connected {
		b.mu.Unlock()
		return "", fmt.Errorf("not connected to CDP")
	}
	b.mu.Unlock()

	result, err := b.sendCommandWithResult("Runtime.evaluate", map[string]interface{}{
		"expression":    "document.documentElement.outerHTML",
		"returnByValue": true,
	})
	if err != nil {
		return "", fmt.Errorf("failed to get page source: %w", err)
	}

	var resp struct {
		Result struct {
			Value string `json:"value"`
		} `json:"result"`
	}
	if err := json.Unmarshal(result, &resp); err != nil {
		return "", fmt.Errorf("failed to parse page source: %w", err)
	}

	return resp.Result.Value, nil
}

// EmulateDevice sets device metrics (mobile emulation).
func (b *BrowserDebug) EmulateDevice(width, height int, mobile bool, deviceScaleFactor float64) error {
	b.mu.Lock()
	if !b.connected {
		b.mu.Unlock()
		return fmt.Errorf("not connected to CDP")
	}
	b.mu.Unlock()

	if deviceScaleFactor <= 0 {
		deviceScaleFactor = 1
	}

	if err := b.sendCommand("Emulation.setDeviceMetricsOverride", map[string]interface{}{
		"width":             width,
		"height":            height,
		"mobile":            mobile,
		"deviceScaleFactor": deviceScaleFactor,
	}); err != nil {
		return fmt.Errorf("failed to set device metrics: %w", err)
	}

	log.Printf("[debug] device emulation set: %dx%d mobile=%v scale=%.1f", width, height, mobile, deviceScaleFactor)
	return nil
}

// ClearDeviceEmulation removes device emulation.
func (b *BrowserDebug) ClearDeviceEmulation() error {
	b.mu.Lock()
	if !b.connected {
		b.mu.Unlock()
		return fmt.Errorf("not connected to CDP")
	}
	b.mu.Unlock()

	if err := b.sendCommand("Emulation.clearDeviceMetricsOverride", nil); err != nil {
		return fmt.Errorf("failed to clear device emulation: %w", err)
	}
	return nil
}

// GetPerformanceMetrics returns runtime performance metrics from the page.
func (b *BrowserDebug) GetPerformanceMetrics() (map[string]float64, error) {
	b.mu.Lock()
	if !b.connected {
		b.mu.Unlock()
		return nil, fmt.Errorf("not connected to CDP")
	}
	b.mu.Unlock()

	_ = b.sendCommand("Performance.enable", nil)

	result, err := b.sendCommandWithResult("Performance.getMetrics", nil)
	if err != nil {
		return nil, fmt.Errorf("failed to get performance metrics: %w", err)
	}

	var resp struct {
		Metrics []struct {
			Name  string  `json:"name"`
			Value float64 `json:"value"`
		} `json:"metrics"`
	}
	if err := json.Unmarshal(result, &resp); err != nil {
		return nil, fmt.Errorf("failed to parse metrics: %w", err)
	}

	metrics := make(map[string]float64, len(resp.Metrics))
	for _, m := range resp.Metrics {
		metrics[m.Name] = m.Value
	}
	return metrics, nil
}

// --- Helpers ---

func probePort(client *http.Client, port int) (*BrowserInfo, []DebugTarget, error) {
	base := fmt.Sprintf("http://localhost:%d", port)

	// Get browser info
	var info *BrowserInfo
	versionResp, err := client.Get(base + "/json/version")
	if err == nil {
		body, _ := io.ReadAll(versionResp.Body)
		versionResp.Body.Close()
		var bi BrowserInfo
		if json.Unmarshal(body, &bi) == nil {
			info = &bi
		}
	}

	// Get targets
	resp, err := client.Get(base + "/json")
	if err != nil {
		return nil, nil, err
	}
	body, err := io.ReadAll(resp.Body)
	resp.Body.Close()
	if err != nil {
		return nil, nil, err
	}

	var rawTargets []struct {
		ID                   string `json:"id"`
		Type                 string `json:"type"`
		Title                string `json:"title"`
		URL                  string `json:"url"`
		WebSocketDebuggerURL string `json:"webSocketDebuggerUrl"`
		DevtoolsFrontendURL  string `json:"devtoolsFrontendUrl"`
		FaviconURL           string `json:"faviconUrl"`
	}
	if err := json.Unmarshal(body, &rawTargets); err != nil {
		return nil, nil, err
	}

	targets := make([]DebugTarget, 0, len(rawTargets))
	for _, t := range rawTargets {
		targets = append(targets, DebugTarget{
			ID:                   t.ID,
			Type:                 t.Type,
			Title:                t.Title,
			URL:                  t.URL,
			WebSocketDebuggerURL: t.WebSocketDebuggerURL,
			DevtoolsFrontendURL:  t.DevtoolsFrontendURL,
			FaviconURL:           t.FaviconURL,
			Attached:             t.WebSocketDebuggerURL == "",
		})
	}

	return info, targets, nil
}

func isPortOpen(port int) bool {
	conn, err := net.DialTimeout("tcp", fmt.Sprintf("localhost:%d", port), 500*time.Millisecond)
	if err != nil {
		return false
	}
	conn.Close()
	return true
}

// LaunchBrowserForDebug launches a browser and immediately discovers its targets.
// Returns the list of targets once the browser is ready.
func (b *BrowserDebug) LaunchBrowserForDebug(url string, port int) ([]DebugTarget, error) {
	if port <= 0 {
		port = b.debugPort
		if port == 0 {
			port = findFreePort(cdpDebugPort)
			b.debugPort = port
		}
	}

	b.mu.Lock()
	if b.process != nil {
		b.mu.Unlock()
		return nil, fmt.Errorf("browser already launched; stop it first")
	}
	b.mu.Unlock()

	browserPath := findBrowserExecutable()
	if browserPath == "" {
		return nil, fmt.Errorf("no supported browser found (looked for msedge.exe, chrome.exe)")
	}

	profileDir, err := os.MkdirTemp("", "adomnia-debug-*")
	if err != nil {
		return nil, fmt.Errorf("failed to create temp profile dir: %w", err)
	}

	args := []string{
		fmt.Sprintf("--remote-debugging-port=%d", port),
		"--no-first-run",
		"--no-default-browser-check",
		fmt.Sprintf("--user-data-dir=%s", profileDir),
	}
	if url != "" {
		args = append(args, url)
	}

	cmd := exec.Command(browserPath, args...)
	cmd.Stdout = nil
	cmd.Stderr = nil

	if err := cmd.Start(); err != nil {
		os.RemoveAll(profileDir)
		return nil, fmt.Errorf("failed to launch browser: %w", err)
	}

	b.mu.Lock()
	b.process = cmd
	b.profileDir = profileDir
	b.debugPort = port
	b.mu.Unlock()

	log.Printf("[debug] launched browser for debug: %s (pid %d, port %d, profile %s)", browserPath, cmd.Process.Pid, port, profileDir)

	// Wait for CDP to become available
	client := &http.Client{Timeout: 2 * time.Second}
	var targets []DebugTarget
	for attempt := 0; attempt < 20; attempt++ {
		time.Sleep(300 * time.Millisecond)
		_, t, err := probePort(client, port)
		if err == nil && len(t) > 0 {
			targets = t
			break
		}
	}

	if targets == nil {
		return []DebugTarget{}, nil
	}

	return targets, nil
}
