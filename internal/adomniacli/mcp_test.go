package adomniacli

import (
	"bytes"
	"encoding/json"
	"strings"
	"testing"
)

func TestMCPHandshakeAndMockStatus(t *testing.T) {
	empty, _ := json.Marshal(t.TempDir())
	in := strings.NewReader(`{"jsonrpc":"2.0","id":1,"method":"initialize"}
{"jsonrpc":"2.0","method":"notifications/initialized"}
{"jsonrpc":"2.0","id":2,"method":"tools/list"}
{"jsonrpc":"2.0","id":3,"method":"tools/call","params":{"name":"mock_status"}}
{"jsonrpc":"2.0","id":4,"method":"tools/call","params":{"name":"collection_list_requests","arguments":{"collection":` + string(empty) + `}}}
`)
	var out bytes.Buffer
	if code := MCP([]string{"mcp"}, in, &out, &bytes.Buffer{}); code != 0 {
		t.Fatalf("exit %d", code)
	}
	lines := strings.Split(strings.TrimSpace(out.String()), "\n")
	if len(lines) != 4 { // the notification gets no reply
		t.Fatalf("replies = %d: %s", len(lines), out.String())
	}
	var status struct {
		Result struct {
			Content []struct{ Text string }
			IsError bool
		}
	}
	if err := json.Unmarshal([]byte(lines[2]), &status); err != nil || status.Result.IsError || !strings.Contains(status.Result.Content[0].Text, `"running":false`) {
		t.Fatalf("mock_status = %s", lines[2])
	}
	if !strings.Contains(lines[3], `"isError":true`) {
		t.Fatalf("missing collection should be a tool error: %s", lines[3])
	}
}
