package mcp

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"
)

func TestNewClient_UnknownTransport(t *testing.T) {
	if _, err := NewClient(ConnectionConfig{Transport: "carrier-pigeon"}); err == nil {
		t.Fatalf("expected error for unknown transport")
	}
}

func TestNewHTTPTransport_RequiresBaseURL(t *testing.T) {
	if _, err := newHTTPTransport(ConnectionConfig{Transport: TransportHTTP}); err == nil {
		t.Fatalf("expected error when baseURL is empty")
	}
	if _, err := newHTTPTransport(ConnectionConfig{Transport: TransportHTTP, BaseURL: "http://x"}); err != nil {
		t.Fatalf("unexpected error with baseURL: %v", err)
	}
}

func TestNewStdioTransport_RequiresCommand(t *testing.T) {
	if _, err := newStdioTransport(ConnectionConfig{Transport: TransportStdio}); err == nil {
		t.Fatalf("expected error when command is empty")
	}
}

func TestClient_ListTools_RoundTrip(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		var req JSONRPCRequest
		_ = json.NewDecoder(r.Body).Decode(&req)
		result, _ := json.Marshal(map[string]any{
			"tools": []Tool{{Name: "echo", Description: "echoes input"}},
		})
		_ = json.NewEncoder(w).Encode(JSONRPCResponse{
			JSONRPC: "2.0",
			ID:      req.ID,
			Result:  result,
		})
	}))
	defer srv.Close()

	c, err := NewClient(ConnectionConfig{Transport: TransportHTTP, BaseURL: srv.URL})
	if err != nil {
		t.Fatalf("NewClient: %v", err)
	}
	defer c.Close()

	tools, err := c.ListTools(context.Background())
	if err != nil {
		t.Fatalf("ListTools: %v", err)
	}
	if len(tools) != 1 || tools[0].Name != "echo" {
		t.Fatalf("unexpected tools: %+v", tools)
	}
}

func TestClient_PropagatesJSONRPCError(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		var req JSONRPCRequest
		_ = json.NewDecoder(r.Body).Decode(&req)
		_ = json.NewEncoder(w).Encode(JSONRPCResponse{
			JSONRPC: "2.0",
			ID:      req.ID,
			Error:   &JSONRPCError{Code: -32601, Message: "method not found"},
		})
	}))
	defer srv.Close()

	c, err := NewClient(ConnectionConfig{Transport: TransportHTTP, BaseURL: srv.URL})
	if err != nil {
		t.Fatalf("NewClient: %v", err)
	}
	defer c.Close()

	if _, err := c.ListTools(context.Background()); err == nil {
		t.Fatalf("expected JSON-RPC error to propagate")
	}
}
