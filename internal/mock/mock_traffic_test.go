package mock

import (
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
)

func TestMockHitIncludesRoutingDecision(t *testing.T) {
	mockCfgMu.Lock()
	mockCfg = mockServerConfig{Endpoints: []mockEndpoint{{
		ID:     "users-endpoint",
		Path:   "/users/:id",
		Method: "GET",
		Responses: []mockResponse{{
			ID:       "user-response",
			Name:     "User found",
			Status:   http.StatusOK,
			Body:     `{"id":"u_1"}`,
			IsActive: true,
		}},
	}}}
	mockCfgMu.Unlock()
	mockHitsMu.Lock()
	mockHits = nil
	mockHitsMu.Unlock()

	request := httptest.NewRequest(http.MethodGet, "/users/u_1", nil)
	response := httptest.NewRecorder()
	mockRequestHandler(response, request)

	if response.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d", response.Code)
	}
	mockHitsMu.Lock()
	defer mockHitsMu.Unlock()
	if len(mockHits) != 1 {
		t.Fatalf("expected one hit, got %d", len(mockHits))
	}
	hit := mockHits[0]
	if hit.EndpointID != "users-endpoint" || hit.EndpointPath != "/users/:id" {
		t.Fatalf("expected endpoint routing metadata, got %+v", hit)
	}
	if hit.ResponseName != "User found" || hit.ResponseID != "user-response" {
		t.Fatalf("expected response metadata, got %+v", hit)
	}
}

func TestMockHitsClearRemovesServerHistory(t *testing.T) {
	mockHitsMu.Lock()
	mockHits = []mockHitEntry{{ID: "existing"}}
	mockHitsMu.Unlock()

	request := httptest.NewRequest(http.MethodPost, "/mock/hits/clear", nil)
	response := httptest.NewRecorder()
	mockHitsClearHandler(response, request)

	if response.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d", response.Code)
	}
	mockHitsMu.Lock()
	defer mockHitsMu.Unlock()
	if len(mockHits) != 0 {
		t.Fatalf("expected cleared history, got %d entries", len(mockHits))
	}
}

func TestMockConfigUpdatesRunningServerWithoutChangingPort(t *testing.T) {
	mockSrvMu.Lock()
	previousServer, previousPort := mockSrv, mockSrvPort
	mockSrv = &http.Server{}
	mockSrvPort = 19555
	mockSrvMu.Unlock()
	defer func() {
		mockSrvMu.Lock()
		mockSrv, mockSrvPort = previousServer, previousPort
		mockSrvMu.Unlock()
	}()

	request := httptest.NewRequest(http.MethodPost, "/mock/config", strings.NewReader(`{
		"port": 1234,
		"endpoints": [{
			"id": "live-endpoint",
			"path": "/live",
			"method": "GET",
			"responses": [{"id": "live-response", "status": 200, "isActive": true}]
		}]
	}`))
	response := httptest.NewRecorder()
	mockConfigHandler(response, request)

	if response.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d: %s", response.Code, response.Body.String())
	}
	mockCfgMu.RLock()
	defer mockCfgMu.RUnlock()
	if mockCfg.Port != 19555 {
		t.Fatalf("expected active port to stay 19555, got %d", mockCfg.Port)
	}
	if len(mockCfg.Endpoints) != 1 || mockCfg.Endpoints[0].ID != "live-endpoint" {
		t.Fatalf("expected live configuration to be installed, got %+v", mockCfg.Endpoints)
	}
}
