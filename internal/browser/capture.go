package browser

import (
	"context"
	"encoding/base64"
	jsonv1 "encoding/json"
	"errors"
	"fmt"
	"time"
)

// PageCapture is what an automatic page check measured: a screenshot, the errors the
// page reported and its network requests. It comes from a throwaway headless browser,
// so it never mixes with an interactive Browser Debugging session.
type PageCapture struct {
	PNG      []byte              `json:"-"`
	Title    string              `json:"title"`
	Errors   []string            `json:"errors"`
	Requests []DebugNetworkEntry `json:"requests"`
}

// errorHook collects uncaught errors, rejected promises and console.error in the page
// itself, before any page script runs.
const errorHook = `(() => {
  const errors = window.__adomniaErrors = [];
  const push = (text) => { if (errors.length < 200) errors.push(String(text).slice(0, 2000)); };
  window.addEventListener('error', (event) => push((event.error && event.error.stack) || event.message));
  window.addEventListener('unhandledrejection', (event) => push('Unhandled rejection: ' + ((event.reason && event.reason.stack) || event.reason)));
  const original = console.error;
  console.error = function (...args) { push(args.map(String).join(' ')); return original.apply(this, args); };
})();`

// CapturePage opens url in a headless browser with an empty profile, waits settle after
// the navigation and returns what the page did. The browser is always closed.
func CapturePage(ctx context.Context, url string, settle time.Duration) (PageCapture, error) {
	debug := NewBrowserDebug()
	debug.headless = true
	targets, err := debug.LaunchBrowserForDebug("about:blank", 0)
	defer func() { _ = debug.StopBrowser() }() // the capture owns this browser: always closed
	if err != nil {
		return PageCapture{}, err
	}
	if len(targets) == 0 {
		return PageCapture{}, errors.New("the headless browser did not expose a page in time")
	}
	if err := debug.ConnectToTarget(targets[0].WebSocketDebuggerURL); err != nil {
		return PageCapture{}, err
	}
	if _, err := debug.sendCommandWithResult("Page.enable", nil); err != nil {
		return PageCapture{}, fmt.Errorf("enable the page domain: %w", err)
	}
	if _, err := debug.sendCommandWithResult("Page.addScriptToEvaluateOnNewDocument", map[string]any{"source": errorHook}); err != nil {
		return PageCapture{}, fmt.Errorf("install the error hook: %w", err)
	}
	if err := debug.NavigateTarget(url); err != nil {
		return PageCapture{}, err
	}
	select {
	case <-ctx.Done():
		return PageCapture{}, ctx.Err()
	case <-time.After(settle):
	}
	encoded, err := debug.TakeScreenshot("png", 0)
	if err != nil {
		return PageCapture{}, err
	}
	png, err := base64.StdEncoding.DecodeString(encoded)
	if err != nil {
		return PageCapture{}, fmt.Errorf("decode the screenshot: %w", err)
	}
	capture := PageCapture{PNG: png, Errors: []string{}, Requests: debug.GetTraffic()}
	var page struct {
		Title  string   `json:"title"`
		Errors []string `json:"errors"`
	}
	if text, err := debug.evaluateString(`JSON.stringify({title: document.title, errors: window.__adomniaErrors || []})`); err == nil {
		if jsonv1.Unmarshal([]byte(text), &page) == nil {
			capture.Title, capture.Errors = page.Title, page.Errors
		}
	}
	return capture, nil
}

// evaluateString runs expression in the page and returns its string value, without
// touching the shared console log of the interactive debugger.
func (b *BrowserDebug) evaluateString(expression string) (string, error) {
	raw, err := b.sendCommandWithResult("Runtime.evaluate", map[string]any{"expression": expression, "returnByValue": true})
	if err != nil {
		return "", err
	}
	var response struct {
		Result struct {
			Value string `json:"value"`
		} `json:"result"`
	}
	if err := jsonv1.Unmarshal(raw, &response); err != nil {
		return "", err
	}
	return response.Result.Value, nil
}
