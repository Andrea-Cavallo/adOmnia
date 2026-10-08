package main

import (
	"adomnia/internal/mcp"
	"context"
	"encoding/json"
	"fmt"
)

const defaultMCPSessionID = "default"

// MCPClient exposes the MCP sessions of internal/mcp; results are JSON strings.
type MCPClient struct {
	sessions *mcp.Sessions
}

func NewMCPClient() *MCPClient {
	return &MCPClient{sessions: mcp.NewSessions()}
}

func mcpJSON(value any) string {
	raw, _ := json.Marshal(value)
	return string(raw)
}

func mcpArgs(argsJSON string) (map[string]any, error) {
	var args map[string]any
	if argsJSON != "" {
		if err := json.Unmarshal([]byte(argsJSON), &args); err != nil {
			return nil, fmt.Errorf("invalid args JSON: %w", err)
		}
	}
	return args, nil
}

func (m *MCPClient) ConnectSession(sessionID, cfgJSON string) (string, error) {
	var cfg mcp.ConnectionConfig
	if err := json.Unmarshal([]byte(cfgJSON), &cfg); err != nil {
		return "", fmt.Errorf("invalid config: %w", err)
	}
	result, err := m.sessions.Connect(context.Background(), sessionID, cfg)
	if err != nil {
		return "", err
	}
	return mcpJSON(result), nil
}

func (m *MCPClient) DisconnectSession(sessionID string) error {
	return m.sessions.Disconnect(sessionID)
}

func (m *MCPClient) GetSessionStatus(sessionID string) string {
	return m.sessions.Status(sessionID)
}

func (m *MCPClient) RestartSession(sessionID string) (string, error) {
	result, err := m.sessions.Restart(context.Background(), sessionID)
	if err != nil {
		return "", err
	}
	return mcpJSON(result), nil
}

func (m *MCPClient) ListSessions() string {
	return mcpJSON(m.sessions.List())
}

func (m *MCPClient) Connect(cfgJSON string) (string, error) {
	return m.ConnectSession(defaultMCPSessionID, cfgJSON)
}

func (m *MCPClient) Disconnect() error {
	return m.DisconnectSession(defaultMCPSessionID)
}

func (m *MCPClient) ListTools() (string, error) {
	return m.ListToolsSession(defaultMCPSessionID)
}

func (m *MCPClient) ListToolsSession(sessionID string) (string, error) {
	c, err := m.sessions.Client(sessionID)
	if err != nil {
		return "", err
	}
	tools, err := c.ListTools(context.Background())
	if err != nil {
		return "", err
	}
	return mcpJSON(tools), nil
}

func (m *MCPClient) CallTool(name, argsJSON string) (string, error) {
	return m.CallToolSession(defaultMCPSessionID, name, argsJSON)
}

func (m *MCPClient) CallToolSession(sessionID, name, argsJSON string) (string, error) {
	c, err := m.sessions.Client(sessionID)
	if err != nil {
		return "", err
	}
	args, err := mcpArgs(argsJSON)
	if err != nil {
		return "", err
	}
	result, err := c.CallTool(context.Background(), name, args)
	if err != nil {
		return "", err
	}
	return mcpJSON(result), nil
}

func (m *MCPClient) ListResources() (string, error) {
	return m.ListResourcesSession(defaultMCPSessionID)
}

func (m *MCPClient) ListResourcesSession(sessionID string) (string, error) {
	c, err := m.sessions.Client(sessionID)
	if err != nil {
		return "", err
	}
	resources, err := c.ListResources(context.Background())
	if err != nil {
		return "", err
	}
	return mcpJSON(resources), nil
}

func (m *MCPClient) ListPrompts() (string, error) {
	return m.ListPromptsSession(defaultMCPSessionID)
}

func (m *MCPClient) ListPromptsSession(sessionID string) (string, error) {
	c, err := m.sessions.Client(sessionID)
	if err != nil {
		return "", err
	}
	prompts, err := c.ListPrompts(context.Background())
	if err != nil {
		return "", err
	}
	return mcpJSON(prompts), nil
}

func (m *MCPClient) GetPrompt(name, argsJSON string) (string, error) {
	return m.GetPromptSession(defaultMCPSessionID, name, argsJSON)
}

func (m *MCPClient) GetPromptSession(sessionID, name, argsJSON string) (string, error) {
	c, err := m.sessions.Client(sessionID)
	if err != nil {
		return "", err
	}
	args, err := mcpArgs(argsJSON)
	if err != nil {
		return "", err
	}
	result, err := c.GetPrompt(context.Background(), name, args)
	if err != nil {
		return "", err
	}
	return mcpJSON(result), nil
}
