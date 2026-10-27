package milk

import (
	"github.com/Andrea-Cavallo/adOmnia/internal/aipolicy"

	"testing"
)

func TestFilterMCPServersByPolicy(t *testing.T) {
	servers := []MCPServer{
		{Name: "local", Command: "node", Args: []string{"server.js"}},
		{Name: "remote", URL: "https://example.test/mcp"},
		{Name: "both", Command: "node", URL: "https://example.test/mcp"},
	}
	t.Run("allowed keeps everything", func(t *testing.T) {
		got := filterMCPServersByPolicy(servers, aipolicy.Allowed)
		if len(got) != 3 {
			t.Fatalf("allowed must keep all servers, got %d", len(got))
		}
	})
	t.Run("local-only keeps stdio and drops http", func(t *testing.T) {
		got := filterMCPServersByPolicy(servers, aipolicy.LocalOnly)
		if len(got) != 1 || got[0].Name != "local" {
			t.Fatalf("local-only must keep only stdio servers, got %+v", got)
		}
	})
	t.Run("off and unknown send nothing", func(t *testing.T) {
		for _, policy := range []string{aipolicy.Off, "", "maybe"} {
			if got := filterMCPServersByPolicy(servers, policy); len(got) != 0 {
				t.Fatalf("policy %q must send no server, got %+v", policy, got)
			}
		}
	})
}

func TestSessionParamsCarryPolicyFilteredServers(t *testing.T) {
	root := t.TempDir()
	manager := &Manager{settings: Settings{DisableBuiltinMCP: true}}
	manager.agent = Agent{Name: "milk", Event: "milk", Protocol: 2}
	manager.SetMCPServers(func() []MCPServer {
		return []MCPServer{{Name: "remote", URL: "https://example.test/mcp"}}
	})

	params := manager.sessionParams(root)
	if params["cwd"] != root {
		t.Fatalf("cwd missing from session/new payload: %+v", params)
	}
	if _, ok := params["_meta"]; !ok {
		t.Fatal("milk sessions need the fresh _meta flag")
	}
	servers, ok := params["mcpServers"].([]any)
	if !ok || len(servers) != 1 {
		t.Fatalf("allowed policy must forward the configured server, got %+v", params["mcpServers"])
	}

	if err := aipolicy.Save(root, aipolicy.Off); err != nil {
		t.Fatal(err)
	}
	if servers := manager.sessionParams(root)["mcpServers"].([]any); len(servers) != 0 {
		t.Fatalf("off policy must forward no server, got %+v", servers)
	}
}

func TestSessionMCPServersRespectsProjectPolicy(t *testing.T) {
	root := t.TempDir()
	// Disable the builtin server so the assertion only covers user servers.
	manager := &Manager{settings: Settings{DisableBuiltinMCP: true}}
	manager.SetMCPServers(func() []MCPServer {
		return []MCPServer{{Name: "remote", URL: "https://example.test/mcp"}}
	})

	if got := manager.sessionMCPServers(root); len(got) != 1 {
		t.Fatalf("allowed must forward the configured server, got %d", len(got))
	}
	if err := aipolicy.Save(root, aipolicy.Off); err != nil {
		t.Fatal(err)
	}
	if got := manager.sessionMCPServers(root); len(got) != 0 {
		t.Fatalf("off must forward no server, got %+v", got)
	}
	if err := aipolicy.Save(root, aipolicy.LocalOnly); err != nil {
		t.Fatal(err)
	}
	if got := manager.sessionMCPServers(root); len(got) != 0 {
		t.Fatalf("local-only must drop http servers, got %+v", got)
	}
}
