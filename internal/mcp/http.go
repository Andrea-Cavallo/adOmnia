package mcp

import (
	"bufio"
	"bytes"
	"context"
	"encoding/json/v2"
	"fmt"
	"github.com/Andrea-Cavallo/adOmnia/internal/jsonutil"
	"io"
	"net/http"
	"strings"
	"sync"
	"time"
)

const httpTimeout = 5 * time.Minute

// httpTransport is the Streamable HTTP transport: every message is a POST; the answer is either
// plain JSON or a text/event-stream that carries the response (and possibly notifications).
// The server may hand out an Mcp-Session-Id, which every later request must repeat.
type httpTransport struct {
	baseURL     string
	bearerToken string
	client      *http.Client

	mu              sync.Mutex
	sessionID       string
	protocolVersion string
}

func newHTTPTransport(cfg ConnectionConfig) (*httpTransport, error) {
	if cfg.BaseURL == "" {
		return nil, fmt.Errorf("http transport requires baseURL")
	}
	return &httpTransport{
		baseURL:     cfg.BaseURL,
		bearerToken: cfg.BearerToken,
		client:      &http.Client{Timeout: httpTimeout},
	}, nil
}

// SetProtocolVersion is called once the handshake settled the version; it goes in a header.
func (t *httpTransport) SetProtocolVersion(version string) {
	t.mu.Lock()
	t.protocolVersion = version
	t.mu.Unlock()
}

func (t *httpTransport) headers(req *http.Request) {
	req.Header.Set("content-type", "application/json")
	req.Header.Set("accept", "application/json, text/event-stream")
	if t.bearerToken != "" {
		req.Header.Set("authorization", "Bearer "+t.bearerToken)
	}
	t.mu.Lock()
	defer t.mu.Unlock()
	if t.sessionID != "" {
		req.Header.Set("Mcp-Session-Id", t.sessionID)
	}
	if t.protocolVersion != "" {
		req.Header.Set("MCP-Protocol-Version", t.protocolVersion)
	}
}

func (t *httpTransport) Send(ctx context.Context, req JSONRPCRequest) (JSONRPCResponse, error) {
	raw, err := jsonutil.Marshal(req)
	if err != nil {
		return JSONRPCResponse{}, err
	}
	httpReq, err := http.NewRequestWithContext(ctx, http.MethodPost, t.baseURL, bytes.NewReader(raw))
	if err != nil {
		return JSONRPCResponse{}, err
	}
	t.headers(httpReq)
	resp, err := t.client.Do(httpReq)
	if err != nil {
		return JSONRPCResponse{}, fmt.Errorf("http send: %w", err)
	}
	defer resp.Body.Close()

	if id := resp.Header.Get("Mcp-Session-Id"); id != "" {
		t.mu.Lock()
		t.sessionID = id
		t.mu.Unlock()
	}
	if resp.StatusCode >= 400 {
		body, _ := io.ReadAll(io.LimitReader(resp.Body, 2048))
		return JSONRPCResponse{}, httpStatusError(resp.StatusCode, string(body), t.hasSession())
	}
	if req.ID == nil {
		return JSONRPCResponse{}, nil
	}
	if strings.HasPrefix(resp.Header.Get("content-type"), "text/event-stream") {
		return readEventStream(resp.Body, fmt.Sprint(req.ID))
	}
	var result JSONRPCResponse
	if err := json.UnmarshalRead(io.LimitReader(resp.Body, maxMessageBytes), &result); err != nil {
		return JSONRPCResponse{}, fmt.Errorf("http decode: %w", err)
	}
	return result, nil
}

func (t *httpTransport) hasSession() bool {
	t.mu.Lock()
	defer t.mu.Unlock()
	return t.sessionID != ""
}

func httpStatusError(status int, body string, hadSession bool) error {
	body = strings.TrimSpace(body)
	switch {
	case status == http.StatusUnauthorized || status == http.StatusForbidden:
		return fmt.Errorf("http %d: the server refused the credentials (check the bearer token) %s", status, body)
	case status == http.StatusNotFound && hadSession:
		return fmt.Errorf("http 404: the server forgot this session, reconnect %s", body)
	}
	return fmt.Errorf("http %d %s", status, body)
}

// readEventStream returns the response whose id matches; other events (notifications, server
// requests) are skipped.
func readEventStream(body io.Reader, wantID string) (JSONRPCResponse, error) {
	scanner := bufio.NewScanner(body)
	scanner.Buffer(make([]byte, 0, 64*1024), maxMessageBytes)
	var data []string
	flush := func() (JSONRPCResponse, bool) {
		defer func() { data = data[:0] }()
		if len(data) == 0 {
			return JSONRPCResponse{}, false
		}
		var msg incoming
		if json.Unmarshal([]byte(strings.Join(data, "\n")), &msg) != nil || msg.Method != "" || idKey(msg.ID) != wantID {
			return JSONRPCResponse{}, false
		}
		var id any
		_ = json.Unmarshal(msg.ID, &id)
		return JSONRPCResponse{JSONRPC: "2.0", ID: id, Result: msg.Result, Error: msg.Error}, true
	}
	for scanner.Scan() {
		line := strings.TrimRight(scanner.Text(), "\r")
		switch {
		case line == "":
			if resp, ok := flush(); ok {
				return resp, nil
			}
		case strings.HasPrefix(line, "data:"):
			data = append(data, strings.TrimPrefix(strings.TrimPrefix(line, "data:"), " "))
		}
	}
	if resp, ok := flush(); ok {
		return resp, nil
	}
	if err := scanner.Err(); err != nil {
		return JSONRPCResponse{}, fmt.Errorf("http stream: %w", err)
	}
	return JSONRPCResponse{}, fmt.Errorf("http stream ended without a response")
}

// Close ends the server-side session when there is one (best effort).
func (t *httpTransport) Close() error {
	if !t.hasSession() {
		return nil
	}
	ctx, cancel := context.WithTimeout(context.Background(), 2*time.Second)
	defer cancel()
	req, err := http.NewRequestWithContext(ctx, http.MethodDelete, t.baseURL, nil)
	if err != nil {
		return nil
	}
	t.headers(req)
	if resp, err := t.client.Do(req); err == nil {
		resp.Body.Close()
	}
	return nil
}
