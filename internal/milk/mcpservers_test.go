package milk

import (
	"reflect"
	"testing"
)

func TestMCPServersRoundTripAndACPShape(t *testing.T) {
	store := NewMCPServerStore(t.TempDir())
	if got := store.Load(); got != nil {
		t.Fatalf("empty store = %v", got)
	}
	saved, err := store.Save([]MCPServer{
		{Name: "collections", Command: "adomnia", Args: []string{"mcp"}, Env: map[string]string{"B": "2", "A": "1"}},
		{Name: "mock", URL: "http://127.0.0.1:9000/mcp", Headers: map[string]string{"X": "y"}},
	})
	if err != nil || len(saved) != 2 || len(store.Load()) != 2 {
		t.Fatalf("save/load: %v %v", saved, err)
	}
	got := acpMCPServers(store.Load())
	stdio := got[0].(map[string]any)
	wantEnv := []map[string]string{{"name": "A", "value": "1"}, {"name": "B", "value": "2"}}
	if !reflect.DeepEqual(stdio["env"], wantEnv) || stdio["command"] != "adomnia" {
		t.Fatalf("stdio = %v", stdio)
	}
	if http := got[1].(map[string]any); http["type"] != "http" || http["url"] == "" {
		t.Fatalf("http = %v", http)
	}
}

func TestMCPServersValidation(t *testing.T) {
	for name, servers := range map[string][]MCPServer{
		"no name":   {{Command: "x"}},
		"both":      {{Name: "a", Command: "x", URL: "http://h"}},
		"neither":   {{Name: "a"}},
		"bad url":   {{Name: "a", URL: "ftp://h"}},
		"duplicate": {{Name: "a", Command: "x"}, {Name: "a", Command: "y"}},
	} {
		if _, err := ValidateMCPServers(servers); err == nil {
			t.Errorf("%s: expected error", name)
		}
	}
}
