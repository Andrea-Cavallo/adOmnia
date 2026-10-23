package mcp

import (
	"context"
	jsonv1 "encoding/json"
	"encoding/json/v2"
	"fmt"
	"sync/atomic"
	"time"
)

// ProtocolVersion is the newest MCP revision this client speaks; a server may answer with an
// older one it supports, and that version is then used for the rest of the session.
const ProtocolVersion = "2025-06-18"

// DefaultCallTimeout bounds a call whose context has no deadline, so a hung server cannot
// freeze the UI forever.
const DefaultCallTimeout = 2 * time.Minute

// maxPages stops a server that keeps returning a cursor from looping the client.
const maxPages = 100

type Transport interface {
	Send(ctx context.Context, req JSONRPCRequest) (JSONRPCResponse, error)
	Close() error
}

type Client struct {
	transport     Transport
	transportType TransportType
	idCounter     atomic.Int64
	initialized   atomic.Pointer[InitializeResult]
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

func (c *Client) call(ctx context.Context, method string, params any) (jsonv1.RawMessage, error) {
	if _, ok := ctx.Deadline(); !ok {
		var cancel context.CancelFunc
		ctx, cancel = context.WithTimeout(ctx, DefaultCallTimeout)
		defer cancel()
	}
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
		"protocolVersion": ProtocolVersion,
		"capabilities":    map[string]any{},
		"clientInfo":      map[string]string{"name": "adOmnia", "version": "1.0"},
	})
	if err != nil {
		return InitializeResult{}, err
	}
	var result InitializeResult
	if err := json.Unmarshal(raw, &result); err != nil {
		return InitializeResult{}, fmt.Errorf("decode initialize result: %w", err)
	}
	if versioned, ok := c.transport.(interface{ SetProtocolVersion(string) }); ok && result.ProtocolVersion != "" {
		versioned.SetProtocolVersion(result.ProtocolVersion)
	}
	_ = c.notify(ctx, "notifications/initialized", nil)
	c.initialized.Store(&result)
	return result, nil
}

// Server returns what the server announced at the handshake (zero before Initialize).
func (c *Client) Server() InitializeResult {
	if result := c.initialized.Load(); result != nil {
		return *result
	}
	return InitializeResult{}
}

// Supports reports whether the server announced a capability ("tools", "resources", "prompts"…).
// Before the handshake it answers true, so nothing is hidden by mistake.
func (c *Client) Supports(capability string) bool {
	result := c.initialized.Load()
	if result == nil {
		return true
	}
	_, ok := result.Capabilities[capability]
	return ok
}

func (c *Client) notify(ctx context.Context, method string, params any) error {
	req := JSONRPCRequest{JSONRPC: "2.0", Method: method, Params: params}
	_, err := c.transport.Send(ctx, req)
	return err
}

// Ping checks that the server is alive and answering.
func (c *Client) Ping(ctx context.Context) error {
	_, err := c.call(ctx, "ping", nil)
	return err
}

// listAll follows nextCursor until the server has no more pages.
func listAll[T any](ctx context.Context, c *Client, method, field string) ([]T, error) {
	var all []T
	cursor := ""
	for page := 0; page < maxPages; page++ {
		var params any
		if cursor != "" {
			params = map[string]any{"cursor": cursor}
		}
		raw, err := c.call(ctx, method, params)
		if err != nil {
			return nil, err
		}
		var envelope map[string]jsonv1.RawMessage
		if err := json.Unmarshal(raw, &envelope); err != nil {
			return nil, fmt.Errorf("decode %s: %w", method, err)
		}
		if items, ok := envelope[field]; ok {
			var batch []T
			if err := json.Unmarshal(items, &batch); err != nil {
				return nil, fmt.Errorf("decode %s: %w", method, err)
			}
			all = append(all, batch...)
		}
		cursor = ""
		if next, ok := envelope["nextCursor"]; ok {
			_ = json.Unmarshal(next, &cursor)
		}
		if cursor == "" {
			return all, nil
		}
	}
	return all, fmt.Errorf("%s: more than %d pages, stopped", method, maxPages)
}

func (c *Client) ListTools(ctx context.Context) ([]Tool, error) {
	return listAll[Tool](ctx, c, "tools/list", "tools")
}

func (c *Client) CallTool(ctx context.Context, name string, args map[string]any) (CallToolResult, error) {
	if args == nil {
		args = map[string]any{}
	}
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
	return listAll[Resource](ctx, c, "resources/list", "resources")
}

func (c *Client) ListResourceTemplates(ctx context.Context) ([]ResourceTemplate, error) {
	return listAll[ResourceTemplate](ctx, c, "resources/templates/list", "resourceTemplates")
}

func (c *Client) ReadResource(ctx context.Context, uri string) (ReadResourceResult, error) {
	raw, err := c.call(ctx, "resources/read", map[string]any{"uri": uri})
	if err != nil {
		return ReadResourceResult{}, err
	}
	var result ReadResourceResult
	if err := json.Unmarshal(raw, &result); err != nil {
		return ReadResourceResult{}, err
	}
	return result, nil
}

func (c *Client) ListPrompts(ctx context.Context) ([]Prompt, error) {
	return listAll[Prompt](ctx, c, "prompts/list", "prompts")
}

func (c *Client) GetPrompt(ctx context.Context, name string, args map[string]any) (GetPromptResult, error) {
	// Prompt arguments are strings on the wire, whatever the caller passed.
	wire := make(map[string]string, len(args))
	for key, value := range args {
		if text, ok := value.(string); ok {
			wire[key] = text
		} else {
			wire[key] = fmt.Sprint(value)
		}
	}
	raw, err := c.call(ctx, "prompts/get", map[string]any{
		"name":      name,
		"arguments": wire,
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
