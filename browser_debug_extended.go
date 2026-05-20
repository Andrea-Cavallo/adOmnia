package main

import (
	"encoding/json"
	"fmt"
	"log"
	"strings"
	"sync"
	"time"
)

// =============================================================================
// Console Panel — Runtime.evaluate
// =============================================================================

const maxConsoleLogs = 200

// ConsoleEntry represents a single console log or evaluation result.
type ConsoleEntry struct {
	ID        string `json:"id"`
	Type      string `json:"type"` // "log", "error", "warn", "info", "result"
	Text      string `json:"text"`
	Timestamp int64  `json:"timestamp"`
}

var (
	consoleLogs   []ConsoleEntry
	consoleLogsMu sync.Mutex
	consoleSeq    int64
)

// EvalJS executes JavaScript in the page context and returns the result as a string.
func (b *BrowserDebug) EvalJS(expression string) (ConsoleEntry, error) {
	b.mu.Lock()
	if !b.connected {
		b.mu.Unlock()
		return ConsoleEntry{}, fmt.Errorf("not connected to CDP")
	}
	b.mu.Unlock()

	result, err := b.sendCommandWithResult("Runtime.evaluate", map[string]interface{}{
		"expression":    expression,
		"returnByValue": true,
	})
	if err != nil {
		return ConsoleEntry{}, fmt.Errorf("failed to evaluate expression: %w", err)
	}

	var resp struct {
		Result struct {
			Type  string          `json:"type"`
			Value json.RawMessage `json:"value"`
			Description string   `json:"description"`
		} `json:"result"`
		ExceptionDetails *struct {
			Text      string `json:"text"`
			Exception struct {
				Description string `json:"description"`
			} `json:"exception"`
		} `json:"exceptionDetails"`
	}
	if err := json.Unmarshal(result, &resp); err != nil {
		return ConsoleEntry{}, fmt.Errorf("failed to parse eval result: %w", err)
	}

	entry := ConsoleEntry{
		ID:        fmt.Sprintf("eval-%d", nextConsoleSeq()),
		Timestamp: time.Now().UnixMilli(),
	}

	if resp.ExceptionDetails != nil {
		entry.Type = "error"
		errText := resp.ExceptionDetails.Text
		if resp.ExceptionDetails.Exception.Description != "" {
			errText = resp.ExceptionDetails.Exception.Description
		}
		entry.Text = errText
	} else {
		entry.Type = "result"
		if resp.Result.Value != nil {
			entry.Text = string(resp.Result.Value)
		} else if resp.Result.Description != "" {
			entry.Text = resp.Result.Description
		} else {
			entry.Text = resp.Result.Type
		}
	}

	log.Printf("[debug] EvalJS result: type=%s text=%s", entry.Type, truncate(entry.Text, 100))
	return entry, nil
}

// EnableConsole enables the Runtime domain and starts collecting console messages.
// After calling this, the existing reader loop should call HandleConsoleEvent for
// "Runtime.consoleAPICalled" events.
func (b *BrowserDebug) EnableConsole() error {
	b.mu.Lock()
	if !b.connected {
		b.mu.Unlock()
		return fmt.Errorf("not connected to CDP")
	}
	b.mu.Unlock()

	if err := b.sendCommand("Runtime.enable", nil); err != nil {
		return fmt.Errorf("failed to enable Runtime domain: %w", err)
	}

	consoleLogsMu.Lock()
	consoleLogs = make([]ConsoleEntry, 0, maxConsoleLogs)
	consoleLogsMu.Unlock()

	log.Printf("[debug] Console enabled, collecting Runtime.consoleAPICalled events")
	return nil
}

// GetConsoleLogs returns collected console messages.
func (b *BrowserDebug) GetConsoleLogs() []ConsoleEntry {
	consoleLogsMu.Lock()
	defer consoleLogsMu.Unlock()
	result := make([]ConsoleEntry, len(consoleLogs))
	copy(result, consoleLogs)
	return result
}

// ClearConsoleLogs clears collected console messages.
func (b *BrowserDebug) ClearConsoleLogs() {
	consoleLogsMu.Lock()
	defer consoleLogsMu.Unlock()
	consoleLogs = make([]ConsoleEntry, 0, maxConsoleLogs)
	log.Printf("[debug] console logs cleared")
}

// HandleConsoleEvent processes Runtime.consoleAPICalled events.
// This should be called from the handleEvent method in browser_debug.go when
// msg.Method == "Runtime.consoleAPICalled".
func (b *BrowserDebug) HandleConsoleEvent(params map[string]interface{}) {
	logType, _ := params["type"].(string)
	timestamp, _ := params["timestamp"].(float64)

	args, _ := params["args"].([]interface{})
	var textParts []string
	for _, arg := range args {
		argMap, ok := arg.(map[string]interface{})
		if !ok {
			continue
		}
		if val, ok := argMap["value"]; ok {
			textParts = append(textParts, fmt.Sprintf("%v", val))
		} else if desc, ok := argMap["description"].(string); ok {
			textParts = append(textParts, desc)
		} else if preview, ok := argMap["preview"].(map[string]interface{}); ok {
			if desc, ok := preview["description"].(string); ok {
				textParts = append(textParts, desc)
			}
		}
	}

	entry := ConsoleEntry{
		ID:        fmt.Sprintf("console-%d", nextConsoleSeq()),
		Type:      logType,
		Text:      strings.Join(textParts, " "),
		Timestamp: int64(timestamp),
	}

	consoleLogsMu.Lock()
	if len(consoleLogs) >= maxConsoleLogs {
		consoleLogs = consoleLogs[1:]
	}
	consoleLogs = append(consoleLogs, entry)
	consoleLogsMu.Unlock()
}

// =============================================================================
// Debugger — JS Breakpoints
// =============================================================================

// BreakpointInfo represents a set breakpoint.
type BreakpointInfo struct {
	ID           string `json:"id"`
	ScriptURL    string `json:"scriptUrl"`
	LineNumber   int    `json:"lineNumber"`
	ColumnNumber int    `json:"columnNumber"`
	Condition    string `json:"condition,omitempty"`
}

// PausedState represents the current debugger paused state.
type PausedState struct {
	Paused     bool        `json:"paused"`
	Reason     string      `json:"reason"`
	CallFrames []CallFrame `json:"callFrames"`
	ScriptURL  string      `json:"scriptUrl"`
	LineNumber int         `json:"lineNumber"`
}

// CallFrame represents a single frame in the call stack.
type CallFrame struct {
	ID           string `json:"id"`
	FunctionName string `json:"functionName"`
	URL          string `json:"url"`
	LineNumber   int    `json:"lineNumber"`
	ColumnNumber int    `json:"columnNumber"`
}

var (
	debugBreakpoints   []BreakpointInfo
	debugBreakpointsMu sync.Mutex

	pausedState   PausedState
	pausedStateMu sync.RWMutex
)

// EnableDebugger enables the Debugger domain.
func (b *BrowserDebug) EnableDebugger() error {
	b.mu.Lock()
	if !b.connected {
		b.mu.Unlock()
		return fmt.Errorf("not connected to CDP")
	}
	b.mu.Unlock()

	if err := b.sendCommand("Debugger.enable", nil); err != nil {
		return fmt.Errorf("failed to enable Debugger domain: %w", err)
	}

	log.Printf("[debug] Debugger domain enabled")
	return nil
}

// DisableDebugger disables the Debugger domain.
func (b *BrowserDebug) DisableDebugger() error {
	b.mu.Lock()
	if !b.connected {
		b.mu.Unlock()
		return fmt.Errorf("not connected to CDP")
	}
	b.mu.Unlock()

	if err := b.sendCommand("Debugger.disable", nil); err != nil {
		return fmt.Errorf("failed to disable Debugger domain: %w", err)
	}

	debugBreakpointsMu.Lock()
	debugBreakpoints = nil
	debugBreakpointsMu.Unlock()

	pausedStateMu.Lock()
	pausedState = PausedState{}
	pausedStateMu.Unlock()

	log.Printf("[debug] Debugger domain disabled")
	return nil
}

// SetBreakpoint sets a breakpoint at the given URL and line. Returns breakpoint ID.
func (b *BrowserDebug) SetBreakpoint(url string, line int, condition string) (string, error) {
	b.mu.Lock()
	if !b.connected {
		b.mu.Unlock()
		return "", fmt.Errorf("not connected to CDP")
	}
	b.mu.Unlock()

	params := map[string]interface{}{
		"url":        url,
		"lineNumber": line,
	}
	if condition != "" {
		params["condition"] = condition
	}

	result, err := b.sendCommandWithResult("Debugger.setBreakpointByUrl", params)
	if err != nil {
		return "", fmt.Errorf("failed to set breakpoint: %w", err)
	}

	var resp struct {
		BreakpointID string `json:"breakpointId"`
		Locations    []struct {
			ScriptID     string `json:"scriptId"`
			LineNumber   int    `json:"lineNumber"`
			ColumnNumber int    `json:"columnNumber"`
		} `json:"locations"`
	}
	if err := json.Unmarshal(result, &resp); err != nil {
		return "", fmt.Errorf("failed to parse breakpoint response: %w", err)
	}

	info := BreakpointInfo{
		ID:        resp.BreakpointID,
		ScriptURL: url,
		LineNumber: line,
		Condition: condition,
	}
	if len(resp.Locations) > 0 {
		info.LineNumber = resp.Locations[0].LineNumber
		info.ColumnNumber = resp.Locations[0].ColumnNumber
	}

	debugBreakpointsMu.Lock()
	debugBreakpoints = append(debugBreakpoints, info)
	debugBreakpointsMu.Unlock()

	log.Printf("[debug] breakpoint set: id=%s url=%s line=%d", resp.BreakpointID, url, line)
	return resp.BreakpointID, nil
}

// RemoveBreakpoint removes a breakpoint by ID.
func (b *BrowserDebug) RemoveBreakpoint(breakpointId string) error {
	b.mu.Lock()
	if !b.connected {
		b.mu.Unlock()
		return fmt.Errorf("not connected to CDP")
	}
	b.mu.Unlock()

	if err := b.sendCommand("Debugger.removeBreakpoint", map[string]interface{}{
		"breakpointId": breakpointId,
	}); err != nil {
		return fmt.Errorf("failed to remove breakpoint: %w", err)
	}

	debugBreakpointsMu.Lock()
	for i, bp := range debugBreakpoints {
		if bp.ID == breakpointId {
			debugBreakpoints = append(debugBreakpoints[:i], debugBreakpoints[i+1:]...)
			break
		}
	}
	debugBreakpointsMu.Unlock()

	log.Printf("[debug] breakpoint removed: %s", breakpointId)
	return nil
}

// GetBreakpoints returns all active breakpoints.
func (b *BrowserDebug) GetBreakpoints() []BreakpointInfo {
	debugBreakpointsMu.Lock()
	defer debugBreakpointsMu.Unlock()
	result := make([]BreakpointInfo, len(debugBreakpoints))
	copy(result, debugBreakpoints)
	return result
}

// Resume resumes execution after a breakpoint pause.
func (b *BrowserDebug) Resume() error {
	b.mu.Lock()
	if !b.connected {
		b.mu.Unlock()
		return fmt.Errorf("not connected to CDP")
	}
	b.mu.Unlock()

	if err := b.sendCommand("Debugger.resume", nil); err != nil {
		return fmt.Errorf("failed to resume: %w", err)
	}
	log.Printf("[debug] debugger resumed")
	return nil
}

// StepOver steps over the current statement.
func (b *BrowserDebug) StepOver() error {
	b.mu.Lock()
	if !b.connected {
		b.mu.Unlock()
		return fmt.Errorf("not connected to CDP")
	}
	b.mu.Unlock()

	if err := b.sendCommand("Debugger.stepOver", nil); err != nil {
		return fmt.Errorf("failed to step over: %w", err)
	}
	log.Printf("[debug] debugger step over")
	return nil
}

// StepInto steps into the current function call.
func (b *BrowserDebug) StepInto() error {
	b.mu.Lock()
	if !b.connected {
		b.mu.Unlock()
		return fmt.Errorf("not connected to CDP")
	}
	b.mu.Unlock()

	if err := b.sendCommand("Debugger.stepInto", nil); err != nil {
		return fmt.Errorf("failed to step into: %w", err)
	}
	log.Printf("[debug] debugger step into")
	return nil
}

// StepOut steps out of the current function.
func (b *BrowserDebug) StepOut() error {
	b.mu.Lock()
	if !b.connected {
		b.mu.Unlock()
		return fmt.Errorf("not connected to CDP")
	}
	b.mu.Unlock()

	if err := b.sendCommand("Debugger.stepOut", nil); err != nil {
		return fmt.Errorf("failed to step out: %w", err)
	}
	log.Printf("[debug] debugger step out")
	return nil
}

// GetPausedState returns current debugger state.
func (b *BrowserDebug) GetPausedState() PausedState {
	pausedStateMu.RLock()
	defer pausedStateMu.RUnlock()
	return pausedState
}

// HandleDebuggerEvent processes Debugger.paused and Debugger.resumed events.
// This should be called from the handleEvent method in browser_debug.go when
// msg.Method starts with "Debugger.".
func (b *BrowserDebug) HandleDebuggerEvent(method string, params map[string]interface{}) {
	switch method {
	case "Debugger.paused":
		reason, _ := params["reason"].(string)
		callFramesRaw, _ := params["callFrames"].([]interface{})

		var frames []CallFrame
		for _, cfRaw := range callFramesRaw {
			cfMap, ok := cfRaw.(map[string]interface{})
			if !ok {
				continue
			}
			frame := CallFrame{
				ID:           fmt.Sprintf("%v", cfMap["callFrameId"]),
				FunctionName: stringFromMap(cfMap, "functionName"),
			}
			if loc, ok := cfMap["location"].(map[string]interface{}); ok {
				frame.LineNumber = intFromMap(loc, "lineNumber")
				frame.ColumnNumber = intFromMap(loc, "columnNumber")
			}
			if urlVal, ok := cfMap["url"].(string); ok {
				frame.URL = urlVal
			}
			frames = append(frames, frame)
		}

		state := PausedState{
			Paused:     true,
			Reason:     reason,
			CallFrames: frames,
		}
		if len(frames) > 0 {
			state.ScriptURL = frames[0].URL
			state.LineNumber = frames[0].LineNumber
		}

		pausedStateMu.Lock()
		pausedState = state
		pausedStateMu.Unlock()

		log.Printf("[debug] debugger paused: reason=%s at %s:%d", reason, state.ScriptURL, state.LineNumber)

	case "Debugger.resumed":
		pausedStateMu.Lock()
		pausedState = PausedState{Paused: false}
		pausedStateMu.Unlock()

		log.Printf("[debug] debugger resumed")
	}
}

// =============================================================================
// DOM Inspector
// =============================================================================

// DOMNode represents a node in the DOM tree.
type DOMNode struct {
	NodeID     int       `json:"nodeId"`
	NodeType   int       `json:"nodeType"`
	NodeName   string    `json:"nodeName"`
	LocalName  string    `json:"localName"`
	Attributes []string  `json:"attributes"`
	ChildCount int       `json:"childCount"`
	Children   []DOMNode `json:"children,omitempty"`
}

var (
	domRootNodeID   int
	domRootNodeIDMu sync.Mutex
)

// EnableDOM enables the DOM domain and gets the document root.
func (b *BrowserDebug) EnableDOM() error {
	b.mu.Lock()
	if !b.connected {
		b.mu.Unlock()
		return fmt.Errorf("not connected to CDP")
	}
	b.mu.Unlock()

	if err := b.sendCommand("DOM.enable", nil); err != nil {
		return fmt.Errorf("failed to enable DOM domain: %w", err)
	}

	result, err := b.sendCommandWithResult("DOM.getDocument", map[string]interface{}{
		"depth": 0,
	})
	if err != nil {
		return fmt.Errorf("failed to get document root: %w", err)
	}

	var resp struct {
		Root struct {
			NodeID int `json:"nodeId"`
		} `json:"root"`
	}
	if err := json.Unmarshal(result, &resp); err != nil {
		return fmt.Errorf("failed to parse document root: %w", err)
	}

	domRootNodeIDMu.Lock()
	domRootNodeID = resp.Root.NodeID
	domRootNodeIDMu.Unlock()

	log.Printf("[debug] DOM domain enabled, root nodeId=%d", resp.Root.NodeID)
	return nil
}

// GetDocument returns the DOM tree up to the specified depth.
func (b *BrowserDebug) GetDocument(depth int) (*DOMNode, error) {
	b.mu.Lock()
	if !b.connected {
		b.mu.Unlock()
		return nil, fmt.Errorf("not connected to CDP")
	}
	b.mu.Unlock()

	result, err := b.sendCommandWithResult("DOM.getDocument", map[string]interface{}{
		"depth": depth,
	})
	if err != nil {
		return nil, fmt.Errorf("failed to get document: %w", err)
	}

	var resp struct {
		Root json.RawMessage `json:"root"`
	}
	if err := json.Unmarshal(result, &resp); err != nil {
		return nil, fmt.Errorf("failed to parse document response: %w", err)
	}

	node, err := parseDOMNode(resp.Root)
	if err != nil {
		return nil, fmt.Errorf("failed to parse DOM tree: %w", err)
	}

	return node, nil
}

// GetNodeHTML returns outerHTML for a given nodeId.
func (b *BrowserDebug) GetNodeHTML(nodeId int) (string, error) {
	b.mu.Lock()
	if !b.connected {
		b.mu.Unlock()
		return "", fmt.Errorf("not connected to CDP")
	}
	b.mu.Unlock()

	result, err := b.sendCommandWithResult("DOM.getOuterHTML", map[string]interface{}{
		"nodeId": nodeId,
	})
	if err != nil {
		return "", fmt.Errorf("failed to get outer HTML: %w", err)
	}

	var resp struct {
		OuterHTML string `json:"outerHTML"`
	}
	if err := json.Unmarshal(result, &resp); err != nil {
		return "", fmt.Errorf("failed to parse outer HTML response: %w", err)
	}
	return resp.OuterHTML, nil
}

// QuerySelector finds a node matching the CSS selector.
func (b *BrowserDebug) QuerySelector(selector string) (*DOMNode, error) {
	b.mu.Lock()
	if !b.connected {
		b.mu.Unlock()
		return nil, fmt.Errorf("not connected to CDP")
	}
	b.mu.Unlock()

	domRootNodeIDMu.Lock()
	rootID := domRootNodeID
	domRootNodeIDMu.Unlock()

	if rootID == 0 {
		return nil, fmt.Errorf("DOM not enabled; call EnableDOM first")
	}

	result, err := b.sendCommandWithResult("DOM.querySelector", map[string]interface{}{
		"nodeId":   rootID,
		"selector": selector,
	})
	if err != nil {
		return nil, fmt.Errorf("failed to query selector: %w", err)
	}

	var resp struct {
		NodeID int `json:"nodeId"`
	}
	if err := json.Unmarshal(result, &resp); err != nil {
		return nil, fmt.Errorf("failed to parse querySelector response: %w", err)
	}

	if resp.NodeID == 0 {
		return nil, fmt.Errorf("no node found matching selector: %s", selector)
	}

	// Describe the found node to get details
	descResult, err := b.sendCommandWithResult("DOM.describeNode", map[string]interface{}{
		"nodeId": resp.NodeID,
		"depth":  0,
	})
	if err != nil {
		// Return at least the nodeId even if describe fails
		return &DOMNode{NodeID: resp.NodeID}, nil
	}

	var descResp struct {
		Node json.RawMessage `json:"node"`
	}
	if err := json.Unmarshal(descResult, &descResp); err != nil {
		return &DOMNode{NodeID: resp.NodeID}, nil
	}

	node, err := parseDOMNode(descResp.Node)
	if err != nil {
		return &DOMNode{NodeID: resp.NodeID}, nil
	}
	node.NodeID = resp.NodeID
	return node, nil
}

// GetComputedStyle returns computed CSS properties for a node.
func (b *BrowserDebug) GetComputedStyle(nodeId int) (map[string]string, error) {
	b.mu.Lock()
	if !b.connected {
		b.mu.Unlock()
		return nil, fmt.Errorf("not connected to CDP")
	}
	b.mu.Unlock()

	// Enable CSS domain if not already enabled
	_ = b.sendCommand("CSS.enable", nil)

	result, err := b.sendCommandWithResult("CSS.getComputedStyleForNode", map[string]interface{}{
		"nodeId": nodeId,
	})
	if err != nil {
		return nil, fmt.Errorf("failed to get computed style: %w", err)
	}

	var resp struct {
		ComputedStyle []struct {
			Name  string `json:"name"`
			Value string `json:"value"`
		} `json:"computedStyle"`
	}
	if err := json.Unmarshal(result, &resp); err != nil {
		return nil, fmt.Errorf("failed to parse computed style response: %w", err)
	}

	styles := make(map[string]string, len(resp.ComputedStyle))
	for _, prop := range resp.ComputedStyle {
		styles[prop.Name] = prop.Value
	}
	return styles, nil
}

// HighlightNode highlights a node in the page with an overlay.
func (b *BrowserDebug) HighlightNode(nodeId int) error {
	b.mu.Lock()
	if !b.connected {
		b.mu.Unlock()
		return fmt.Errorf("not connected to CDP")
	}
	b.mu.Unlock()

	if err := b.sendCommand("DOM.highlightNode", map[string]interface{}{
		"nodeId": nodeId,
		"highlightConfig": map[string]interface{}{
			"showInfo": true,
			"contentColor": map[string]interface{}{
				"r": 111, "g": 168, "b": 220, "a": 0.66,
			},
			"paddingColor": map[string]interface{}{
				"r": 147, "g": 196, "b": 125, "a": 0.55,
			},
			"borderColor": map[string]interface{}{
				"r": 255, "g": 229, "b": 153, "a": 0.75,
			},
			"marginColor": map[string]interface{}{
				"r": 246, "g": 178, "b": 107, "a": 0.50,
			},
		},
	}); err != nil {
		return fmt.Errorf("failed to highlight node: %w", err)
	}

	log.Printf("[debug] highlighting node %d", nodeId)
	return nil
}

// HideHighlight removes the highlight overlay.
func (b *BrowserDebug) HideHighlight() error {
	b.mu.Lock()
	if !b.connected {
		b.mu.Unlock()
		return fmt.Errorf("not connected to CDP")
	}
	b.mu.Unlock()

	if err := b.sendCommand("DOM.hideHighlight", nil); err != nil {
		return fmt.Errorf("failed to hide highlight: %w", err)
	}
	return nil
}

// =============================================================================
// Storage Viewer
// =============================================================================

// CookieEntry represents a browser cookie.
type CookieEntry struct {
	Name     string  `json:"name"`
	Value    string  `json:"value"`
	Domain   string  `json:"domain"`
	Path     string  `json:"path"`
	Expires  float64 `json:"expires"`
	Size     int     `json:"size"`
	HttpOnly bool    `json:"httpOnly"`
	Secure   bool    `json:"secure"`
	SameSite string  `json:"sameSite"`
}

// StorageItem represents a key-value pair from web storage.
type StorageItem struct {
	Key   string `json:"key"`
	Value string `json:"value"`
}

// GetCookies returns all cookies for the current page.
func (b *BrowserDebug) GetCookies() ([]CookieEntry, error) {
	b.mu.Lock()
	if !b.connected {
		b.mu.Unlock()
		return nil, fmt.Errorf("not connected to CDP")
	}
	b.mu.Unlock()

	result, err := b.sendCommandWithResult("Network.getCookies", nil)
	if err != nil {
		return nil, fmt.Errorf("failed to get cookies: %w", err)
	}

	var resp struct {
		Cookies []struct {
			Name     string  `json:"name"`
			Value    string  `json:"value"`
			Domain   string  `json:"domain"`
			Path     string  `json:"path"`
			Expires  float64 `json:"expires"`
			Size     int     `json:"size"`
			HttpOnly bool    `json:"httpOnly"`
			Secure   bool    `json:"secure"`
			SameSite string  `json:"sameSite"`
		} `json:"cookies"`
	}
	if err := json.Unmarshal(result, &resp); err != nil {
		return nil, fmt.Errorf("failed to parse cookies response: %w", err)
	}

	cookies := make([]CookieEntry, len(resp.Cookies))
	for i, c := range resp.Cookies {
		cookies[i] = CookieEntry{
			Name:     c.Name,
			Value:    c.Value,
			Domain:   c.Domain,
			Path:     c.Path,
			Expires:  c.Expires,
			Size:     c.Size,
			HttpOnly: c.HttpOnly,
			Secure:   c.Secure,
			SameSite: c.SameSite,
		}
	}
	return cookies, nil
}

// DeleteCookie deletes a cookie by name and domain.
func (b *BrowserDebug) DeleteCookie(name string, domain string) error {
	b.mu.Lock()
	if !b.connected {
		b.mu.Unlock()
		return fmt.Errorf("not connected to CDP")
	}
	b.mu.Unlock()

	if err := b.sendCommand("Network.deleteCookies", map[string]interface{}{
		"name":   name,
		"domain": domain,
	}); err != nil {
		return fmt.Errorf("failed to delete cookie: %w", err)
	}

	log.Printf("[debug] deleted cookie: name=%s domain=%s", name, domain)
	return nil
}

// GetLocalStorage returns localStorage key-value pairs.
func (b *BrowserDebug) GetLocalStorage() ([]StorageItem, error) {
	return b.getWebStorage("localStorage")
}

// GetSessionStorage returns sessionStorage key-value pairs.
func (b *BrowserDebug) GetSessionStorage() ([]StorageItem, error) {
	return b.getWebStorage("sessionStorage")
}

// GetIndexedDBDatabases returns a list of IndexedDB database names.
func (b *BrowserDebug) GetIndexedDBDatabases() ([]string, error) {
	b.mu.Lock()
	if !b.connected {
		b.mu.Unlock()
		return nil, fmt.Errorf("not connected to CDP")
	}
	b.mu.Unlock()

	expression := `(async()=>{const dbs=await indexedDB.databases(); return JSON.stringify(dbs.map(d=>d.name))})()`
	result, err := b.sendCommandWithResult("Runtime.evaluate", map[string]interface{}{
		"expression":    expression,
		"returnByValue": true,
		"awaitPromise":  true,
	})
	if err != nil {
		return nil, fmt.Errorf("failed to get IndexedDB databases: %w", err)
	}

	var resp struct {
		Result struct {
			Value json.RawMessage `json:"value"`
		} `json:"result"`
		ExceptionDetails *struct {
			Text string `json:"text"`
		} `json:"exceptionDetails"`
	}
	if err := json.Unmarshal(result, &resp); err != nil {
		return nil, fmt.Errorf("failed to parse IndexedDB response: %w", err)
	}

	if resp.ExceptionDetails != nil {
		return nil, fmt.Errorf("IndexedDB query failed: %s", resp.ExceptionDetails.Text)
	}

	var names []string
	if resp.Result.Value != nil {
		if err := json.Unmarshal(resp.Result.Value, &names); err != nil {
			return nil, fmt.Errorf("failed to parse IndexedDB database names: %w", err)
		}
	}
	return names, nil
}

// getWebStorage retrieves key-value pairs from localStorage or sessionStorage.
func (b *BrowserDebug) getWebStorage(storageType string) ([]StorageItem, error) {
	b.mu.Lock()
	if !b.connected {
		b.mu.Unlock()
		return nil, fmt.Errorf("not connected to CDP")
	}
	b.mu.Unlock()

	expression := fmt.Sprintf(`JSON.stringify(Object.entries(%s))`, storageType)
	result, err := b.sendCommandWithResult("Runtime.evaluate", map[string]interface{}{
		"expression":    expression,
		"returnByValue": true,
	})
	if err != nil {
		return nil, fmt.Errorf("failed to get %s: %w", storageType, err)
	}

	var resp struct {
		Result struct {
			Value json.RawMessage `json:"value"`
		} `json:"result"`
		ExceptionDetails *struct {
			Text string `json:"text"`
		} `json:"exceptionDetails"`
	}
	if err := json.Unmarshal(result, &resp); err != nil {
		return nil, fmt.Errorf("failed to parse %s response: %w", storageType, err)
	}

	if resp.ExceptionDetails != nil {
		return nil, fmt.Errorf("%s query failed: %s", storageType, resp.ExceptionDetails.Text)
	}

	// The value is a JSON string containing the array
	var rawStr string
	if resp.Result.Value != nil {
		if err := json.Unmarshal(resp.Result.Value, &rawStr); err != nil {
			return nil, fmt.Errorf("failed to unwrap %s value: %w", storageType, err)
		}
	}

	var entries [][]string
	if rawStr != "" {
		if err := json.Unmarshal([]byte(rawStr), &entries); err != nil {
			return nil, fmt.Errorf("failed to parse %s entries: %w", storageType, err)
		}
	}

	items := make([]StorageItem, 0, len(entries))
	for _, entry := range entries {
		if len(entry) >= 2 {
			items = append(items, StorageItem{
				Key:   entry[0],
				Value: entry[1],
			})
		}
	}
	return items, nil
}

// =============================================================================
// Network Throttling
// =============================================================================

// ThrottleProfile defines a named network throttling configuration.
type ThrottleProfile struct {
	Name         string  `json:"name"`
	DownloadKbps float64 `json:"downloadKbps"`
	UploadKbps   float64 `json:"uploadKbps"`
	LatencyMs    float64 `json:"latencyMs"`
}

// ThrottleProfiles contains predefined network throttling profiles.
var ThrottleProfiles = []ThrottleProfile{
	{Name: "No Throttling", DownloadKbps: 0, UploadKbps: 0, LatencyMs: 0},
	{Name: "Slow 3G", DownloadKbps: 400, UploadKbps: 400, LatencyMs: 2000},
	{Name: "Fast 3G", DownloadKbps: 1500, UploadKbps: 750, LatencyMs: 563},
	{Name: "Regular 4G", DownloadKbps: 4000, UploadKbps: 3000, LatencyMs: 170},
	{Name: "WiFi", DownloadKbps: 30000, UploadKbps: 15000, LatencyMs: 2},
	{Name: "Offline", DownloadKbps: 0.001, UploadKbps: 0.001, LatencyMs: 0},
}

// SetThrottling applies a network throttling profile.
func (b *BrowserDebug) SetThrottling(downloadKbps, uploadKbps, latencyMs float64) error {
	b.mu.Lock()
	if !b.connected {
		b.mu.Unlock()
		return fmt.Errorf("not connected to CDP")
	}
	b.mu.Unlock()

	offline := downloadKbps < 1
	downloadThroughput := downloadKbps * 1024 / 8
	uploadThroughput := uploadKbps * 1024 / 8

	if err := b.sendCommand("Network.emulateNetworkConditions", map[string]interface{}{
		"offline":            offline,
		"downloadThroughput": downloadThroughput,
		"uploadThroughput":   uploadThroughput,
		"latency":            latencyMs,
	}); err != nil {
		return fmt.Errorf("failed to set network throttling: %w", err)
	}

	log.Printf("[debug] network throttling set: download=%.0f kbps, upload=%.0f kbps, latency=%.0f ms, offline=%v",
		downloadKbps, uploadKbps, latencyMs, offline)
	return nil
}

// ClearThrottling removes network throttling.
func (b *BrowserDebug) ClearThrottling() error {
	b.mu.Lock()
	if !b.connected {
		b.mu.Unlock()
		return fmt.Errorf("not connected to CDP")
	}
	b.mu.Unlock()

	if err := b.sendCommand("Network.emulateNetworkConditions", map[string]interface{}{
		"offline":            false,
		"downloadThroughput": -1,
		"uploadThroughput":   -1,
		"latency":            0,
	}); err != nil {
		return fmt.Errorf("failed to clear network throttling: %w", err)
	}

	log.Printf("[debug] network throttling cleared")
	return nil
}

// GetThrottleProfiles returns the list of predefined throttle profiles.
func (b *BrowserDebug) GetThrottleProfiles() []ThrottleProfile {
	result := make([]ThrottleProfile, len(ThrottleProfiles))
	copy(result, ThrottleProfiles)
	return result
}

// =============================================================================
// Internal helpers
// =============================================================================

func nextConsoleSeq() int64 {
	consoleLogsMu.Lock()
	consoleSeq++
	seq := consoleSeq
	consoleLogsMu.Unlock()
	return seq
}

func truncate(s string, maxLen int) string {
	if len(s) <= maxLen {
		return s
	}
	return s[:maxLen] + "..."
}

func stringFromMap(m map[string]interface{}, key string) string {
	v, _ := m[key].(string)
	return v
}

func intFromMap(m map[string]interface{}, key string) int {
	switch v := m[key].(type) {
	case float64:
		return int(v)
	case int:
		return v
	case json.Number:
		n, _ := v.Int64()
		return int(n)
	default:
		return 0
	}
}

// parseDOMNode recursively parses a CDP DOM node JSON into a DOMNode struct.
func parseDOMNode(raw json.RawMessage) (*DOMNode, error) {
	if raw == nil {
		return nil, fmt.Errorf("nil node data")
	}

	var nodeMap struct {
		NodeID     int               `json:"nodeId"`
		NodeType   int               `json:"nodeType"`
		NodeName   string            `json:"nodeName"`
		LocalName  string            `json:"localName"`
		Attributes []string          `json:"attributes"`
		ChildCount int               `json:"childNodeCount"`
		Children   []json.RawMessage `json:"children"`
	}
	if err := json.Unmarshal(raw, &nodeMap); err != nil {
		return nil, err
	}

	node := &DOMNode{
		NodeID:     nodeMap.NodeID,
		NodeType:   nodeMap.NodeType,
		NodeName:   nodeMap.NodeName,
		LocalName:  nodeMap.LocalName,
		Attributes: nodeMap.Attributes,
		ChildCount: nodeMap.ChildCount,
	}

	if node.Attributes == nil {
		node.Attributes = []string{}
	}

	for _, childRaw := range nodeMap.Children {
		child, err := parseDOMNode(childRaw)
		if err != nil {
			continue
		}
		node.Children = append(node.Children, *child)
	}

	return node, nil
}
