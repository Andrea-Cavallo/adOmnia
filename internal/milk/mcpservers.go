package milk

import (
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"sort"
	"strings"
	"sync"
)

const mcpServersFileName = "acp-mcp-servers.json"

// MCPServer è un "context server" configurato una volta sola e passato a ogni
// sessione ACP di ogni agente (session/new.mcpServers). Stdio se Command è
// valorizzato, altrimenti HTTP su URL.
type MCPServer struct {
	Name    string            `json:"name"`
	Command string            `json:"command,omitempty"`
	Args    []string          `json:"args,omitempty"`
	Env     map[string]string `json:"env,omitempty"`
	URL     string            `json:"url,omitempty"`
	Headers map[string]string `json:"headers,omitempty"`
}

// MCPServerStore legge e scrive l'elenco condiviso tra tutti gli agenti.
type MCPServerStore struct {
	mu   sync.Mutex
	path string
}

func NewMCPServerStore(directory string) *MCPServerStore {
	return &MCPServerStore{path: filepath.Join(directory, mcpServersFileName)}
}

// Load restituisce l'elenco salvato; file mancante o corrotto = nessun server.
func (s *MCPServerStore) Load() []MCPServer {
	s.mu.Lock()
	defer s.mu.Unlock()
	data, err := os.ReadFile(s.path)
	if err != nil {
		return nil
	}
	var servers []MCPServer
	if json.Unmarshal(data, &servers) != nil {
		return nil
	}
	if valid, err := ValidateMCPServers(servers); err == nil {
		return valid
	}
	return nil
}

// Save valida e scrive in modo atomico.
func (s *MCPServerStore) Save(servers []MCPServer) ([]MCPServer, error) {
	valid, err := ValidateMCPServers(servers)
	if err != nil {
		return nil, err
	}
	data, err := json.MarshalIndent(valid, "", "  ")
	if err != nil {
		return nil, err
	}
	s.mu.Lock()
	defer s.mu.Unlock()
	if err := os.MkdirAll(filepath.Dir(s.path), 0o700); err != nil {
		return nil, fmt.Errorf("cannot create settings folder: %w", err)
	}
	temporary := s.path + ".tmp"
	if err := os.WriteFile(temporary, data, 0o600); err != nil {
		return nil, fmt.Errorf("cannot write MCP servers: %w", err)
	}
	if err := os.Rename(temporary, s.path); err != nil {
		_ = os.Remove(temporary)
		return nil, fmt.Errorf("cannot save MCP servers: %w", err)
	}
	return valid, nil
}

// ValidateMCPServers: nome unico, esattamente un trasporto (command o http(s) url).
func ValidateMCPServers(servers []MCPServer) ([]MCPServer, error) {
	if len(servers) > 32 {
		return nil, fmt.Errorf("too many MCP servers")
	}
	seen := make(map[string]bool, len(servers))
	out := make([]MCPServer, 0, len(servers))
	for _, server := range servers {
		server.Name = strings.TrimSpace(server.Name)
		server.Command = strings.TrimSpace(server.Command)
		server.URL = strings.TrimSpace(server.URL)
		switch {
		case server.Name == "" || strings.ContainsAny(server.Name, "\x00\r\n"):
			return nil, fmt.Errorf("MCP server needs a name")
		case seen[server.Name]:
			return nil, fmt.Errorf("duplicate MCP server %q", server.Name)
		case (server.Command == "") == (server.URL == ""):
			return nil, fmt.Errorf("MCP server %q needs either a command or a URL", server.Name)
		case server.URL != "" && !strings.HasPrefix(server.URL, "http://") && !strings.HasPrefix(server.URL, "https://"):
			return nil, fmt.Errorf("MCP server %q URL must be http(s)", server.Name)
		}
		seen[server.Name] = true
		out = append(out, server)
	}
	return out, nil
}

// acpParams converte nel formato ACP: env/headers sono liste {name,value}.
// L'ordine è stabile (per nome) così il payload non cambia tra una sessione e l'altra.
func (s MCPServer) acpParams() map[string]any {
	pairs := func(values map[string]string) []map[string]string {
		names := make([]string, 0, len(values))
		for name := range values {
			names = append(names, name)
		}
		sort.Strings(names)
		list := make([]map[string]string, 0, len(names))
		for _, name := range names {
			list = append(list, map[string]string{"name": name, "value": values[name]})
		}
		return list
	}
	if s.URL != "" {
		return map[string]any{"type": "http", "name": s.Name, "url": s.URL, "headers": pairs(s.Headers)}
	}
	args := s.Args
	if args == nil {
		args = []string{}
	}
	return map[string]any{"name": s.Name, "command": s.Command, "args": args, "env": pairs(s.Env)}
}

func acpMCPServers(servers []MCPServer) []any {
	out := make([]any, 0, len(servers))
	for _, server := range servers {
		out = append(out, server.acpParams())
	}
	return out
}

// withBuiltinMCPServer prepends adOmnia's own MCP server (`adomnia mcp <root>`: collections
// and mock) unless the user already defined a server named "adomnia" (their entry wins).
func withBuiltinMCPServer(servers []MCPServer, root string, disabled bool) []MCPServer {
	if disabled {
		return servers
	}
	executable, err := os.Executable()
	if err != nil {
		return servers
	}
	for _, server := range servers {
		if server.Name == "adomnia" {
			return servers
		}
	}
	return append([]MCPServer{{Name: "adomnia", Command: executable, Args: []string{"mcp", root}}}, servers...)
}
