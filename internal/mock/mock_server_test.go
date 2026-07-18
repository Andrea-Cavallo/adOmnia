package mock

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"
)

func TestMockServerStartStop(t *testing.T) {
	// Reset global state before test
	mockSrvMu.Lock()
	if mockSrv != nil {
		mockSrv.Close()
		mockSrv = nil
	}
	mockSrvPort = 0
	mockSrvMu.Unlock()
	mockCfgMu.Lock()
	mockCfg = mockServerConfig{}
	mockCfgMu.Unlock()

	mux := http.NewServeMux()
	RegisterHandlers(mux)
	ts := httptest.NewServer(mux)
	defer ts.Close()

	// Test 1: Status before start - should be not running
	resp, err := http.Get(ts.URL + "/mock/status")
	if err != nil {
		t.Fatalf("GET /mock/status failed: %v", err)
	}
	var status map[string]interface{}
	json.NewDecoder(resp.Body).Decode(&status)
	resp.Body.Close()
	if status["running"] != false {
		t.Errorf("expected running=false, got %v", status["running"])
	}
	t.Logf("Initial status: running=%v, port=%v", status["running"], status["port"])

	// Test 2: Start the mock server
	cfg := mockServerConfig{
		Port:                   19999, // use a high port unlikely to conflict
		Password:               "",
		Endpoints:              []mockEndpoint{},
		DefaultResponseDelayMs: 0,
		CorsHeadersAuto:        true,
	}
	cfgJSON, _ := json.Marshal(cfg)
	resp, err = http.Post(ts.URL+"/mock/start", "application/json", strings.NewReader(string(cfgJSON)))
	if err != nil {
		t.Fatalf("POST /mock/start failed: %v", err)
	}
	var startRes map[string]interface{}
	json.NewDecoder(resp.Body).Decode(&startRes)
	resp.Body.Close()
	t.Logf("Start response: %+v", startRes)

	if errMsg, ok := startRes["error"]; ok {
		t.Fatalf("mock server failed to start: %v", errMsg)
	}
	if startRes["ok"] != true {
		t.Errorf("expected ok=true, got %v", startRes["ok"])
	}
	if port, ok := startRes["port"].(float64); !ok || int(port) != 19999 {
		t.Errorf("expected port=19999, got %v", startRes["port"])
	}

	// Test 3: Status after start - should be running
	resp, err = http.Get(ts.URL + "/mock/status")
	if err != nil {
		t.Fatalf("GET /mock/status failed: %v", err)
	}
	json.NewDecoder(resp.Body).Decode(&status)
	resp.Body.Close()
	t.Logf("After start status: running=%v, port=%v", status["running"], status["port"])
	if status["running"] != true {
		t.Errorf("expected running=true, got %v", status["running"])
	}

	// Test 4: Make a request to the mock server to verify it's actually serving
	time.Sleep(100 * time.Millisecond) // give the server goroutine time to start
	mockResp, err := http.Get("http://127.0.0.1:19999/anything")
	if err != nil {
		t.Fatalf("request to mock server failed: %v", err)
	}
	mockResp.Body.Close()
	t.Logf("Mock server response status: %d", mockResp.StatusCode)

	// Test 5: Stop the mock server
	resp, err = http.Post(ts.URL+"/mock/stop", "application/json", strings.NewReader("{}"))
	if err != nil {
		t.Fatalf("POST /mock/stop failed: %v", err)
	}
	var stopRes map[string]interface{}
	json.NewDecoder(resp.Body).Decode(&stopRes)
	resp.Body.Close()
	if stopRes["ok"] != true {
		t.Errorf("expected ok=true from stop, got %v", stopRes)
	}

	// Test 6: Status after stop
	resp, err = http.Get(ts.URL + "/mock/status")
	if err != nil {
		t.Fatalf("GET /mock/status failed: %v", err)
	}
	json.NewDecoder(resp.Body).Decode(&status)
	resp.Body.Close()
	if status["running"] != false {
		t.Errorf("expected running=false after stop, got %v", status["running"])
	}
	t.Logf("After stop status: running=%v, port=%v", status["running"], status["port"])
}
