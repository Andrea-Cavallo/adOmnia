package mcp

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"net/http"
)

type httpTransport struct {
	baseURL     string
	bearerToken string
	client      *http.Client
}

func newHTTPTransport(cfg ConnectionConfig) (*httpTransport, error) {
	if cfg.BaseURL == "" {
		return nil, fmt.Errorf("http transport requires baseURL")
	}
	return &httpTransport{
		baseURL:     cfg.BaseURL,
		bearerToken: cfg.BearerToken,
		client:      &http.Client{},
	}, nil
}

func (t *httpTransport) Send(ctx context.Context, req JSONRPCRequest) (JSONRPCResponse, error) {
	raw, _ := json.Marshal(req)
	httpReq, err := http.NewRequestWithContext(ctx, http.MethodPost, t.baseURL, bytes.NewReader(raw))
	if err != nil {
		return JSONRPCResponse{}, err
	}
	httpReq.Header.Set("content-type", "application/json")
	if t.bearerToken != "" {
		httpReq.Header.Set("authorization", "Bearer "+t.bearerToken)
	}
	resp, err := t.client.Do(httpReq)
	if err != nil {
		return JSONRPCResponse{}, fmt.Errorf("http send: %w", err)
	}
	defer resp.Body.Close()

	if req.ID == nil {
		return JSONRPCResponse{}, nil
	}

	var result JSONRPCResponse
	if err := json.NewDecoder(resp.Body).Decode(&result); err != nil {
		return JSONRPCResponse{}, fmt.Errorf("http decode: %w", err)
	}
	return result, nil
}

func (t *httpTransport) Close() error { return nil }
