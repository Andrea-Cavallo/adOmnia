package sidecar

import (
	"bytes"
	"encoding/json"
	"fmt"
	"io"
	"net"
	"net/http"
	"testing"
	"time"

	"adomnia/internal/storage"
)

// TestLiveMockStartStop exercises the exact path the frontend uses:
// boot the real sidecar, authenticate with the session token through
// WithSecurity, start the mock server, hit it, then stop it.
func TestLiveMockStartStop(t *testing.T) {
	if err := storage.Open(t.TempDir()); err != nil {
		t.Fatalf("storage open: %v", err)
	}
	defer storage.Close()
	InitToken()
	port := Start()
	if port == 0 {
		t.Fatal("sidecar failed to start (port 0)")
	}
	defer Stop()

	base := fmt.Sprintf("http://127.0.0.1:%d", port)
	tok := Token()

	call := func(path string, body any) (*http.Response, []byte) {
		var rdr io.Reader
		method := http.MethodGet
		if body != nil {
			b, _ := json.Marshal(body)
			rdr = bytes.NewReader(b)
			method = http.MethodPost
		}
		req, _ := http.NewRequest(method, base+path, rdr)
		req.Header.Set("X-Sidecar-Token", tok)
		req.Header.Set("Origin", "http://localhost:5173")
		if body != nil {
			req.Header.Set("Content-Type", "application/json")
		}
		res, err := http.DefaultClient.Do(req)
		if err != nil {
			t.Fatalf("%s: request failed: %v", path, err)
		}
		data, _ := io.ReadAll(res.Body)
		res.Body.Close()
		return res, data
	}

	mockPort := freePort(t)
	res, data := call("/mock/start", map[string]any{
		"port": mockPort,
		"endpoints": []map[string]any{
			{
				"id":     "e1",
				"method": "GET",
				"path":   "/ping",
				"mode":   "first_active",
				"responses": []map[string]any{
					{"id": "r1", "name": "ok", "status": 200, "headers": map[string]string{"Content-Type": "text/plain"}, "body": "pong", "delayMs": 0, "isActive": true},
				},
				"enabled": true,
			},
		},
	})
	if res.StatusCode != 200 {
		t.Fatalf("/mock/start status %d: %s", res.StatusCode, data)
	}

	// Give the mock listener a moment, then hit it like a real client.
	deadline := time.Now().Add(2 * time.Second)
	var ok bool
	for time.Now().Before(deadline) {
		r, err := http.Get(fmt.Sprintf("http://127.0.0.1:%d/ping", mockPort))
		if err == nil {
			b, _ := io.ReadAll(r.Body)
			r.Body.Close()
			if r.StatusCode == 200 && string(b) == "pong" {
				ok = true
				break
			}
		}
		time.Sleep(50 * time.Millisecond)
	}
	if !ok {
		t.Fatal("mock server did not serve /ping")
	}

	res, data = call("/mock/stop", map[string]any{})
	if res.StatusCode != 200 {
		t.Fatalf("/mock/stop status %d: %s", res.StatusCode, data)
	}
}

func freePort(t *testing.T) int {
	t.Helper()
	ln, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		t.Fatalf("freePort: %v", err)
	}
	port := ln.Addr().(*net.TCPAddr).Port
	ln.Close()
	return port
}
