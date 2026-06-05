package mcp

import (
	"context"
	"encoding/json"
	"fmt"
	"sync/atomic"
)

type Transport interface {
	Send(ctx context.Context, req JSONRPCRequest) (JSONRPCResponse, error)
	Close() error
}

type Client struct {
	transport     Transport
	transportType TransportType
	idCounter     atomic.Int64
}

func NewClient(cfg ConnectionConfig) (*Client, error) {
	var t Transport
	var err error
	switch cfg.Transport {
	case TransportStdio:
		t, err = newStdioTransport(cfg)
	case TransportHTTP:
		t, err = newHTTPTransport(cfg)
	default:
		err = fmt.Errorf("unknown transport: %s", cfg.Transport)
	}
	if err != nil {
		return nil, err
	}
	return &Client{transport: t, transportType: cfg.Transport}, nil
}

func (c *Client) nextID() int64 {
	return c.idCounter.Add(1)
}

func (c *Client) call(ctx context.Context, method string, params any) (json.RawMessage, error) {
	req := JSONRPCRequest{
		JSONRPC: "2.0",
		ID:      c.nextID(),
		Method:  method,
		Params:  params,
	}
	resp, err := c.transport.Send(ctx, req)
	if err != nil {
		return nil, err
	}
	if resp.Error != nil {
		return nil, fmt.Errorf("MCP error %d: %s", resp.Error.Code, resp.Error.Message)
	}
	return resp.Result, nil
}

func (c *Client) Initialize(ctx context.Context) (InitializeResult, error) {
	raw, err := c.call(ctx, "initialize", map[string]any{
		"protocolVersion": "2024-11-05",
		"capabilities":    map[string]any{},
		"clientInfo":      map[string]string{"name": "adOmnia", "version": "1.0"},
	})
	if err != nil {
		return InitializeResult{}, err
	}
	_ = c.notify(ctx, "notifications/initialized", nil)
	var result InitializeResult
	if err := json.Unmarshal(raw, &result); err != nil {
		return InitializeResult{}, fmt.Errorf("decode initialize result: %w", err)
	}
	return result, nil
}

func (c *Client) notify(ctx context.Context, method string, params any) error {
	req := JSONRPCRequest{JSONRPC: "2.0", Method: method, Params: params}
	_, err := c.transport.Send(ctx, req)
	return err
}

func (c *Client) ListTools(ctx context.Context) ([]Tool, error) {
	raw, err := c.call(ctx, "tools/list", nil)
	if err != nil {
		return nil, err
	}
	var result struct {
		Tools []Tool `json:"tools"`
	}
	if err := json.Unmarshal(raw, &result); err != nil {
		return nil, err
	}
	return result.Tools, nil
}

func (c *Client) CallTool(ctx context.Context, name string, args map[string]any) (CallToolResult, error) {
	raw, err := c.call(ctx, "tools/call", map[string]any{
		"name":      name,
		"arguments": args,
	})
	if err != nil {
		return CallToolResult{}, err
	}
	var result CallToolResult
	if err := json.Unmarshal(raw, &result); err != nil {
		return CallToolResult{}, err
	}
	return result, nil
}

func (c *Client) ListResources(ctx context.Context) ([]Resource, error) {
	raw, err := c.call(ctx, "resources/list", nil)
	if err != nil {
		return nil, err
	}
	var result struct {
		Resources []Resource `json:"resources"`
	}
	if err := json.Unmarshal(raw, &result); err != nil {
		return nil, err
	}
	return result.Resources, nil
}

func (c *Client) ListPrompts(ctx context.Context) ([]Prompt, error) {
	raw, err := c.call(ctx, "prompts/list", nil)
	if err != nil {
		return nil, err
	}
	var result struct {
		Prompts []Prompt `json:"prompts"`
	}
	if err := json.Unmarshal(raw, &result); err != nil {
		return nil, err
	}
	return result.Prompts, nil
}

func (c *Client) GetPrompt(ctx context.Context, name string, args map[string]any) (GetPromptResult, error) {
	raw, err := c.call(ctx, "prompts/get", map[string]any{
		"name":      name,
		"arguments": args,
	})
	if err != nil {
		return GetPromptResult{}, err
	}
	var result GetPromptResult
	if err := json.Unmarshal(raw, &result); err != nil {
		return GetPromptResult{}, err
	}
	return result, nil
}

func (c *Client) Close() error {
	return c.transport.Close()
}

func (c *Client) Transport() string {
	return string(c.transportType)
}

func (c *Client) ProcessState() string {
	if stateful, ok := c.transport.(interface{ ProcessState() string }); ok {
		return stateful.ProcessState()
	}
	return "n/a"
}
