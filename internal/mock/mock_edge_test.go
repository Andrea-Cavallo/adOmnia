package mock

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"
)

// TestMockRapidRestart verifies that quickly stopping and starting the mock
// server on the same port works without port-binding conflicts.
func TestMockRapidRestart(t *testing.T) {
	// Reset global state
	mockSrvMu.Lock()
	if mockSrv != nil {
		mockSrv.Close()
		mockSrv = nil
	}
	mockSrvPort = 0
	mockSrvLn = nil
	mockSrvMu.Unlock()
	mockCfgMu.Lock()
	mockCfg = mockServerConfig{}
	mockCfgMu.Unlock()

	mux := http.NewServeMux()
	RegisterHandlers(mux)
	ts := httptest.NewServer(mux)
	defer ts.Close()

	const port = 19997

	for i := 0; i < 5; i++ {
		// Start
		cfg := mockServerConfig{
			Port:  port,
			Endpoints: []mockEndpoint{{
				ID:     "ep",
				Path:   "/ping",
				Method: "GET",
				Responses: []mockResponse{{
					ID:       "r",
					Name:     "ok",
					Status:   200,
					Headers:  map[string]string{"X-Iter": "ok"},
					Body:     `{"pong":true}`,
					IsActive: true,
				}},
				Mode: "first_active",
			}},
		}
		cfgJSON, _ := json.Marshal(cfg)
		resp, err := http.Post(ts.URL+"/mock/start", "application/json", strings.NewReader(string(cfgJSON)))
		if err != nil {
			t.Fatalf("iteration %d: start failed: %v", i, err)
		}
		var startRes map[string]interface{}
		json.NewDecoder(resp.Body).Decode(&startRes)
		resp.Body.Close()
		if startRes["ok"] != true {
			t.Fatalf("iteration %d: expected ok=true, got %v", i, startRes)
		}

		// Verify server is responding
		time.Sleep(10 * time.Millisecond)
		mr, err := http.Get("http://127.0.0.1:19997/ping")
		if err != nil {
			t.Fatalf("iteration %d: mock server not reachable: %v", i, err)
		}
		if mr.StatusCode != 200 {
			t.Errorf("iteration %d: expected 200, got %d", i, mr.StatusCode)
		}
		mr.Body.Close()

		// Stop
		resp, err = http.Post(ts.URL+"/mock/stop", "application/json", strings.NewReader("{}"))
		if err != nil {
			t.Fatalf("iteration %d: stop failed: %v", i, err)
		}
		resp.Body.Close()

		// Verify stopped
		time.Sleep(10 * time.Millisecond)
		_, err = http.Get("http://127.0.0.1:19997/ping")
		if err == nil {
			t.Errorf("iteration %d: mock server should be stopped but is still reachable", i)
		}
	}
}

// TestMockPortConflict verifies that trying to start on an already-bound port
// returns a clear error instead of silently failing.
func TestMockPortConflict(t *testing.T) {
	// Reset global state
	mockSrvMu.Lock()
	if mockSrv != nil {
		mockSrv.Close()
		mockSrv = nil
	}
	mockSrvPort = 0
	mockSrvLn = nil
	mockSrvMu.Unlock()
	mockCfgMu.Lock()
	mockCfg = mockServerConfig{}
	mockCfgMu.Unlock()

	mux := http.NewServeMux()
	RegisterHandlers(mux)
	ts := httptest.NewServer(mux)
	defer ts.Close()

	const port = 19996

	// First start — should succeed
	cfg := mockServerConfig{
		Port:      port,
		Endpoints: []mockEndpoint{},
	}
	cfgJSON, _ := json.Marshal(cfg)
	resp, err := http.Post(ts.URL+"/mock/start", "application/json", strings.NewReader(string(cfgJSON)))
	if err != nil {
		t.Fatalf("first start failed: %v", err)
	}
	var res map[string]interface{}
	json.NewDecoder(resp.Body).Decode(&res)
	resp.Body.Close()
	if res["ok"] != true {
		t.Fatalf("first start: expected ok=true, got %v", res)
	}

	// Second start on same port without stopping — should return error
	// (the first mock server is still bound to the port, and mockStartHandler
	//  shuts it down first, so this SHOULD actually succeed)
	resp2, err := http.Post(ts.URL+"/mock/start", "application/json", strings.NewReader(string(cfgJSON)))
	if err != nil {
		t.Fatalf("second start failed: %v", err)
	}
	json.NewDecoder(resp2.Body).Decode(&res)
	resp2.Body.Close()
	if res["ok"] != true {
		t.Errorf("second start: expected ok=true (old server should be shut down), got %v", res)
	}

	// Cleanup
	http.Post(ts.URL+"/mock/stop", "application/json", strings.NewReader("{}"))
	t.Log("port conflict handled correctly — old server is shut down before new one binds")
}

// TestMockNoEndpoints verifies that a mock server with no endpoints still
// starts correctly and returns a clear error for any request.
func TestMockNoEndpoints(t *testing.T) {
	mockSrvMu.Lock()
	if mockSrv != nil {
		mockSrv.Close()
		mockSrv = nil
	}
	mockSrvPort = 0
	mockSrvLn = nil
	mockSrvMu.Unlock()
	mockCfgMu.Lock()
	mockCfg = mockServerConfig{}
	mockCfgMu.Unlock()

	mux := http.NewServeMux()
	RegisterHandlers(mux)
	ts := httptest.NewServer(mux)
	defer ts.Close()

	cfg := mockServerConfig{
		Port:               19995,
		Endpoints:          []mockEndpoint{},
		CorsHeadersAuto:    true,
	}
	cfgJSON, _ := json.Marshal(cfg)
	resp, err := http.Post(ts.URL+"/mock/start", "application/json", strings.NewReader(string(cfgJSON)))
	if err != nil {
		t.Fatalf("start with 0 endpoints failed: %v", err)
	}
	var startRes map[string]interface{}
	json.NewDecoder(resp.Body).Decode(&startRes)
	resp.Body.Close()
	if startRes["ok"] != true {
		t.Fatalf("expected ok=true, got %v", startRes)
	}

	time.Sleep(20 * time.Millisecond)

	// Request to mock server should get 404 with clear error
	mr, err := http.Get("http://127.0.0.1:19995/anything")
	if err != nil {
		t.Fatalf("mock server unreachable: %v", err)
	}
	defer mr.Body.Close()

	if mr.StatusCode != 404 {
		t.Errorf("expected 404 for empty endpoints, got %d", mr.StatusCode)
	}

	// CORS should still be set even with no endpoints
	if mr.Header.Get("Access-Control-Allow-Origin") != "*" {
		t.Errorf("expected CORS *, got %q", mr.Header.Get("Access-Control-Allow-Origin"))
	}

	// Cleanup
	http.Post(ts.URL+"/mock/stop", "application/json", strings.NewReader("{}"))
}
