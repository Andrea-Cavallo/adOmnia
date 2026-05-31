package main

import (
	"adomnia/internal/mcp"
	"context"
	"encoding/json"
	"fmt"
	"sync"
)

type MCPClient struct {
	mu     sync.Mutex
	client *mcp.Client
}

func NewMCPClient() *MCPClient { return &MCPClient{} }

func (m *MCPClient) Connect(cfgJSON string) (string, error) {
	var cfg mcp.ConnectionConfig
	if err := json.Unmarshal([]byte(cfgJSON), &cfg); err != nil {
		return "", fmt.Errorf("invalid config: %w", err)
	}
	c, err := mcp.NewClient(cfg)
	if err != nil {
		return "", err
	}
	result, err := c.Initialize(context.Background())
	if err != nil {
		_ = c.Close()
		return "", err
	}
	m.mu.Lock()
	if m.client != nil {
		_ = m.client.Close()
	}
	m.client = c
	m.mu.Unlock()
	raw, _ := json.Marshal(result)
	return string(raw), nil
}

func (m *MCPClient) Disconnect() error {
	m.mu.Lock()
	defer m.mu.Unlock()
	if m.client == nil {
		return nil
	}
	err := m.client.Close()
	m.client = nil
	return err
}

func (m *MCPClient) ListTools() (string, error) {
	m.mu.Lock()
	c := m.client
	m.mu.Unlock()
	if c == nil {
		return "", fmt.Errorf("non connesso")
	}
	tools, err := c.ListTools(context.Background())
	if err != nil {
		return "", err
	}
	raw, _ := json.Marshal(tools)
	return string(raw), nil
}

func (m *MCPClient) CallTool(name, argsJSON string) (string, error) {
	m.mu.Lock()
	c := m.client
	m.mu.Unlock()
	if c == nil {
		return "", fmt.Errorf("non connesso")
	}
	var args map[string]any
	if argsJSON != "" {
		if err := json.Unmarshal([]byte(argsJSON), &args); err != nil {
			return "", fmt.Errorf("invalid args JSON: %w", err)
		}
	}
	result, err := c.CallTool(context.Background(), name, args)
	if err != nil {
		return "", err
	}
	raw, _ := json.Marshal(result)
	return string(raw), nil
}

func (m *MCPClient) ListResources() (string, error) {
	m.mu.Lock()
	c := m.client
	m.mu.Unlock()
	if c == nil {
		return "", fmt.Errorf("non connesso")
	}
	res, err := c.ListResources(context.Background())
	if err != nil {
		return "", err
	}
	raw, _ := json.Marshal(res)
	return string(raw), nil
}

func (m *MCPClient) ListPrompts() (string, error) {
	m.mu.Lock()
	c := m.client
	m.mu.Unlock()
	if c == nil {
		return "", fmt.Errorf("non connesso")
	}
	prompts, err := c.ListPrompts(context.Background())
	if err != nil {
		return "", err
	}
	raw, _ := json.Marshal(prompts)
	return string(raw), nil
}
