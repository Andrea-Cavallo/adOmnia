package main

import (
	"adomnia/internal/mcp"
	"context"
	"encoding/json"
	"fmt"
	"sync"
)

const defaultMCPSessionID = "default"

type mcpSession struct {
	client *mcp.Client
	cfg    mcp.ConnectionConfig
}

type MCPClient struct {
	mu       sync.RWMutex
	sessions map[string]*mcpSession
}

func NewMCPClient() *MCPClient {
	return &MCPClient{sessions: make(map[string]*mcpSession)}
}

func (m *MCPClient) ConnectSession(sessionID, cfgJSON string) (string, error) {
	if sessionID == "" {
		return "", fmt.Errorf("session ID is required")
	}
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
	if existing, ok := m.sessions[sessionID]; ok {
		_ = existing.client.Close()
	}
	m.sessions[sessionID] = &mcpSession{client: c, cfg: cfg}
	m.mu.Unlock()

	raw, _ := json.Marshal(result)
	return string(raw), nil
}

func (m *MCPClient) DisconnectSession(sessionID string) error {
	m.mu.Lock()
	defer m.mu.Unlock()
	session, ok := m.sessions[sessionID]
	if !ok {
		return nil
	}
	err := session.client.Close()
	delete(m.sessions, sessionID)
	return err
}

func (m *MCPClient) GetSessionStatus(sessionID string) string {
	m.mu.RLock()
	session, ok := m.sessions[sessionID]
	m.mu.RUnlock()
	if !ok {
		return "disconnected"
	}
	return sessionStatus(session)
}

func (m *MCPClient) RestartSession(sessionID string) (string, error) {
	m.mu.RLock()
	session, ok := m.sessions[sessionID]
	if !ok {
		m.mu.RUnlock()
		return "", fmt.Errorf("session %s not found", sessionID)
	}
	cfg := session.cfg
	m.mu.RUnlock()

	_ = m.DisconnectSession(sessionID)
	cfgRaw, _ := json.Marshal(cfg)
	return m.ConnectSession(sessionID, string(cfgRaw))
}

func (m *MCPClient) ListSessions() string {
	type sessionInfo struct {
		ID        string `json:"id"`
		Transport string `json:"transport"`
		Status    string `json:"status"`
	}

	m.mu.RLock()
	items := make([]sessionInfo, 0, len(m.sessions))
	for id, session := range m.sessions {
		items = append(items, sessionInfo{
			ID:        id,
			Transport: session.client.Transport(),
			Status:    sessionStatus(session),
		})
	}
	m.mu.RUnlock()

	raw, _ := json.Marshal(items)
	return string(raw)
}

func (m *MCPClient) Connect(cfgJSON string) (string, error) {
	return m.ConnectSession(defaultMCPSessionID, cfgJSON)
}

func (m *MCPClient) Disconnect() error {
	return m.DisconnectSession(defaultMCPSessionID)
}

func (m *MCPClient) getDefault() *mcp.Client {
	m.mu.RLock()
	defer m.mu.RUnlock()
	if session, ok := m.sessions[defaultMCPSessionID]; ok {
		return session.client
	}
	return nil
}

func (m *MCPClient) ListTools() (string, error) {
	c := m.getDefault()
	if c == nil {
		return "", fmt.Errorf("not connected")
	}
	tools, err := c.ListTools(context.Background())
	if err != nil {
		return "", err
	}
	raw, _ := json.Marshal(tools)
	return string(raw), nil
}

func (m *MCPClient) CallTool(name, argsJSON string) (string, error) {
	c := m.getDefault()
	if c == nil {
		return "", fmt.Errorf("not connected")
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
	c := m.getDefault()
	if c == nil {
		return "", fmt.Errorf("not connected")
	}
	resources, err := c.ListResources(context.Background())
	if err != nil {
		return "", err
	}
	raw, _ := json.Marshal(resources)
	return string(raw), nil
}

func (m *MCPClient) ListPrompts() (string, error) {
	c := m.getDefault()
	if c == nil {
		return "", fmt.Errorf("not connected")
	}
	prompts, err := c.ListPrompts(context.Background())
	if err != nil {
		return "", err
	}
	raw, _ := json.Marshal(prompts)
	return string(raw), nil
}

func sessionStatus(session *mcpSession) string {
	if session == nil || session.client == nil {
		return "disconnected"
	}
	switch state := session.client.ProcessState(); state {
	case "running":
		return "connected"
	case "stopped", "crashed":
		return state
	default:
		if session.client.Transport() == string(mcp.TransportHTTP) {
			return "connected"
		}
		return "unknown"
	}
}
