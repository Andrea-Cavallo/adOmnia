package mcp

import (
	"adomnia/internal/jsonutil"
	"context"
	"encoding/json/v2"
	"net/http"
	"net/http/httptest"
	"testing"
)

func okServer(t *testing.T) *httptest.Server {
	t.Helper()
	return httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		var req JSONRPCRequest
		_ = json.UnmarshalRead(r.Body, &req)
		if req.ID == nil {
			w.WriteHeader(http.StatusAccepted)
			return
		}
		result, _ := jsonutil.Marshal(map[string]any{"protocolVersion": ProtocolVersion, "capabilities": map[string]any{"tools": map[string]any{}}, "serverInfo": map[string]any{"name": "s"}})
		_ = jsonutil.MarshalWrite(w, JSONRPCResponse{JSONRPC: "2.0", ID: req.ID, Result: result})
	}))
}

func TestSessions_Lifecycle(t *testing.T) {
	srv := okServer(t)
	defer srv.Close()
	s := NewSessions()
	ctx := context.Background()
	cfg := ConnectionConfig{Transport: TransportHTTP, BaseURL: srv.URL}

	if _, err := s.Connect(ctx, "", cfg); err == nil {
		t.Fatal("empty id must fail")
	}
	if _, err := s.Connect(ctx, "a", ConnectionConfig{Transport: "x"}); err == nil {
		t.Fatal("bad transport must fail")
	}
	if _, err := s.Connect(ctx, "a", cfg); err != nil {
		t.Fatal(err)
	}
	if got := s.Status("a"); got != "connected" {
		t.Fatalf("status = %s", got)
	}
	if got := s.Status("nope"); got != "disconnected" {
		t.Fatalf("unknown status = %s", got)
	}
	// Connecting the same id replaces the client.
	if _, err := s.Connect(ctx, "a", cfg); err != nil {
		t.Fatal(err)
	}
	if list := s.List(); len(list) != 1 || list[0].Transport != "http" {
		t.Fatalf("list = %+v", list)
	}
	if _, err := s.Client("a"); err != nil {
		t.Fatal(err)
	}
	if _, err := s.Restart(ctx, "a"); err != nil {
		t.Fatal(err)
	}
	if _, err := s.Restart(ctx, "missing"); err == nil {
		t.Fatal("restart of unknown session must fail")
	}
	if err := s.Disconnect("a"); err != nil {
		t.Fatal(err)
	}
	if err := s.Disconnect("a"); err != nil {
		t.Fatal("second disconnect is a no-op")
	}
	if _, err := s.Client("a"); err == nil {
		t.Fatal("client after disconnect must fail")
	}
}

func TestSessions_StdioStatusAndFailedHandshakeKeepsNothing(t *testing.T) {
	s := NewSessions()
	if _, err := s.Connect(context.Background(), "fake", fakeConfig()); err != nil {
		t.Fatal(err)
	}
	if got := s.Status("fake"); got != "connected" {
		t.Fatalf("status = %s", got)
	}
	_ = s.Disconnect("fake")
	// A process that exits during the handshake must not leave a session behind.
	bad := ConnectionConfig{Transport: TransportStdio, Command: "go", Args: []string{"version"}}
	if _, err := s.Connect(context.Background(), "bad", bad); err == nil {
		t.Fatal("handshake with a non-MCP process must fail")
	}
	if s.Status("bad") != "disconnected" {
		t.Fatal("failed handshake left a session")
	}
}

func TestCallToolResultText(t *testing.T) {
	r := CallToolResult{Content: []Content{{Type: "text", Text: "a"}, {Type: "image"}, {Type: "text", Text: "b"}}}
	if r.Text() != "a\nb" {
		t.Fatalf("text = %q", r.Text())
	}
}
