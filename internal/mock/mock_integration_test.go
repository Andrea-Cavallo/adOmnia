package mock

import (
	"bytes"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
)

// TestMockStartWithMaxBytesReader simulates the WithSecurity middleware
// that wraps request bodies with MaxBytesReader.
func TestMockStartWithMaxBytesReader(t *testing.T) {
	// Reset global state
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

	// Wrap with simulated WithSecurity middleware
	handler := http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		// Simulate MaxBytesReader
		if (r.Method == http.MethodPost || r.Method == http.MethodPut) && r.Body != nil {
			r.Body = http.MaxBytesReader(w, r.Body, 10<<20)
		}
		mux.ServeHTTP(w, r)
	})

	ts := httptest.NewServer(handler)
	defer ts.Close()

	// Build a real config similar to what frontend sends
	cfg := mockServerConfig{
		Port:     19998,
		Password: "",
		Endpoints: []mockEndpoint{
			{
				ID:     "ep-1",
				Path:   "/api/users",
				Method: "GET",
				Responses: []mockResponse{
					{
						ID:       "resp-1",
						Name:     "Success",
						Status:   200,
						Headers:  map[string]string{"Content-Type": "application/json"},
						Body:     `{"users": [{"id": 1, "name": "Alice"}]}`,
						DelayMs:  0,
						IsActive: true,
					},
				},
				Mode: "first_active",
			},
		},
		DefaultResponseDelayMs: 0,
		CorsHeadersAuto:        true,
		LogHitsToFile:          false,
	}
	cfgJSON, _ := json.Marshal(cfg)

	resp, err := http.Post(ts.URL+"/mock/start", "application/json", bytes.NewReader(cfgJSON))
	if err != nil {
		t.Fatalf("POST /mock/start failed: %v", err)
	}
	defer resp.Body.Close()

	var startRes map[string]interface{}
	if err := json.NewDecoder(resp.Body).Decode(&startRes); err != nil {
		t.Fatalf("failed to decode start response: %v", err)
	}

	if errMsg, ok := startRes["error"]; ok {
		t.Fatalf("mock server start error: %v", errMsg)
	}
	if ok, _ := startRes["ok"].(bool); !ok {
		t.Fatalf("expected ok=true, got %v", startRes)
	}
	t.Logf("Start response: %+v", startRes)

	// Make a request to the mock server
	mockResp, err := http.Get("http://127.0.0.1:19998/api/users")
	if err != nil {
		t.Fatalf("request to mock server failed: %v", err)
	}
	defer mockResp.Body.Close()

	if mockResp.StatusCode != 200 {
		t.Errorf("expected 200, got %d", mockResp.StatusCode)
	}

	var body map[string]interface{}
	json.NewDecoder(mockResp.Body).Decode(&body)
	t.Logf("Mock response: %+v", body)

	if users, ok := body["users"]; !ok {
		t.Errorf("expected 'users' in response body")
	} else {
		t.Logf("Users: %v", users)
	}

	// Check that CORS headers are set
	if mockResp.Header.Get("Access-Control-Allow-Origin") != "*" {
		t.Errorf("expected CORS header Access-Control-Allow-Origin: *, got: %s",
			mockResp.Header.Get("Access-Control-Allow-Origin"))
	}

	// Stop the server
	resp, err = http.Post(ts.URL+"/mock/stop", "application/json", strings.NewReader("{}"))
	if err != nil {
		t.Fatalf("POST /mock/stop failed: %v", err)
	}
	resp.Body.Close()

	// Verify stopped
	resp, err = http.Get(ts.URL + "/mock/status")
	if err != nil {
		t.Fatalf("GET /mock/status failed: %v", err)
	}
	var status map[string]interface{}
	json.NewDecoder(resp.Body).Decode(&status)
	resp.Body.Close()
	if status["running"] != false {
		t.Errorf("expected running=false after stop, got %v", status["running"])
	}
}
