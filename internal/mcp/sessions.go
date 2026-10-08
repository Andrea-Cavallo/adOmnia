package mcp

import (
	"context"
	"fmt"
	"sync"
)

// SessionInfo is the public view of one connected MCP session.
type SessionInfo struct {
	ID        string `json:"id"`
	Transport string `json:"transport"`
	Status    string `json:"status"`
}

type session struct {
	client *Client
	cfg    ConnectionConfig
}

// Sessions keeps the MCP clients connected by id; connecting an existing id
// replaces (and closes) the previous client.
type Sessions struct {
	mu       sync.RWMutex
	sessions map[string]*session
}

func NewSessions() *Sessions {
	return &Sessions{sessions: make(map[string]*session)}
}

// Connect starts a client, runs the MCP handshake and registers it under id.
func (s *Sessions) Connect(ctx context.Context, id string, cfg ConnectionConfig) (InitializeResult, error) {
	if id == "" {
		return InitializeResult{}, fmt.Errorf("session ID is required")
	}
	c, err := NewClient(cfg)
	if err != nil {
		return InitializeResult{}, err
	}
	result, err := c.Initialize(ctx)
	if err != nil {
		_ = c.Close()
		return InitializeResult{}, err
	}
	s.mu.Lock()
	if existing, ok := s.sessions[id]; ok {
		_ = existing.client.Close()
	}
	s.sessions[id] = &session{client: c, cfg: cfg}
	s.mu.Unlock()
	return result, nil
}

// Disconnect closes and forgets a session; unknown ids are a no-op.
func (s *Sessions) Disconnect(id string) error {
	s.mu.Lock()
	defer s.mu.Unlock()
	existing, ok := s.sessions[id]
	if !ok {
		return nil
	}
	delete(s.sessions, id)
	return existing.client.Close()
}

// Restart reconnects a session with its last configuration.
func (s *Sessions) Restart(ctx context.Context, id string) (InitializeResult, error) {
	s.mu.RLock()
	existing, ok := s.sessions[id]
	s.mu.RUnlock()
	if !ok {
		return InitializeResult{}, fmt.Errorf("session %s not found", id)
	}
	_ = s.Disconnect(id)
	return s.Connect(ctx, id, existing.cfg)
}

// Status returns connected / stopped / crashed / unknown / disconnected.
func (s *Sessions) Status(id string) string {
	s.mu.RLock()
	defer s.mu.RUnlock()
	return statusOf(s.sessions[id])
}

// List returns every registered session.
func (s *Sessions) List() []SessionInfo {
	s.mu.RLock()
	defer s.mu.RUnlock()
	items := make([]SessionInfo, 0, len(s.sessions))
	for id, existing := range s.sessions {
		items = append(items, SessionInfo{ID: id, Transport: existing.client.Transport(), Status: statusOf(existing)})
	}
	return items
}

// Client returns the client of a session, or an error when not connected.
func (s *Sessions) Client(id string) (*Client, error) {
	s.mu.RLock()
	defer s.mu.RUnlock()
	if existing, ok := s.sessions[id]; ok {
		return existing.client, nil
	}
	return nil, fmt.Errorf("not connected")
}

func statusOf(existing *session) string {
	if existing == nil || existing.client == nil {
		return "disconnected"
	}
	switch state := existing.client.ProcessState(); state {
	case "running":
		return "connected"
	case "stopped", "crashed":
		return state
	default:
		if existing.client.Transport() == string(TransportHTTP) {
			return "connected"
		}
		return "unknown"
	}
}
