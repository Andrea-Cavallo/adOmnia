package adomniacli

import (
	"context"
	jsonv1 "encoding/json"
	"encoding/json/v2"
	"fmt"
	"os"

	"github.com/Andrea-Cavallo/adOmnia/internal/ide/agentcontrol"
)

func mcpIDETools() []mcpTool {
	tools := []mcpTool{}
	for _, definition := range []struct {
		name, description string
		write             bool
	}{
		{"ide_status", "Inspect the open desktop session for this workspace.", false},
		{"ide_open_file", "Open a project file in the desktop editor at path, line and column.", false},
		{"ide_test_start", "Start IDE tests with language, workingDirectory, packages and run (test filter). Requires --write and project tooling authorization.", true},
		{"ide_test_status", "Read a test run (runId); optionally nodeId for its captured output.", false},
		{"ide_debug_start", "Start an installed debugger with language=go, java, python, rust, c, cpp, javascript or typescript and that language request fields (mode, target, mainClass, program, etc.). Requires --write.", true},
		{"ide_debug", "Inspect/control an IDE debug session: action=list, threads, stack, scopes, variables, evaluate, breakpoints, continue, pause, next, stepIn, stepOut or stop. All require --write.", true},
		{"ide_logs", "Read the latest 100 run/debug events retained since the desktop bridge started.", false},
		{"ide_database_connections", "List saved SQL connection IDs and drivers without credentials. Requires --write.", true},
		{"ide_database_query", "Query a saved Database Studio connection by connectionId and query (limit <=200, timeout <=10s). Requires --write; destructive statements remain denied.", true},
		{"ide_review_begin", "Capture the project before an external AI turn. Only one external turn per project; call ide_review_end afterward. Requires --write.", true},
		{"ide_review_end", "Finish the external AI turn and publish its diff in the desktop review. Requires --write.", true},
	} {
		tools = append(tools, mcpTool{Name: definition.name, Title: definition.name, Description: definition.description, InputSchema: map[string]any{"type": "object", "properties": map[string]any{"project": map[string]any{"type": "string", "description": "Open project root; defaults to this MCP workspace."}, "path": map[string]any{"type": "string"}, "line": map[string]any{"type": "integer"}, "column": map[string]any{"type": "integer"}, "runId": map[string]any{"type": "string"}, "nodeId": map[string]any{"type": "string"}, "language": map[string]any{"type": "string"}, "workingDirectory": map[string]any{"type": "string"}, "packages": map[string]any{"type": "array", "items": map[string]any{"type": "string"}}, "run": map[string]any{"type": "string"}, "action": map[string]any{"type": "string"}, "debugId": map[string]any{"type": "string"}, "threadId": map[string]any{"type": "integer"}, "frameId": map[string]any{"type": "integer"}, "reference": map[string]any{"type": "integer"}, "expression": map[string]any{"type": "string"}, "connectionId": map[string]any{"type": "string"}, "query": map[string]any{"type": "string"}, "limit": map[string]any{"type": "integer"}}, "additionalProperties": true}, Annotations: map[string]any{"readOnlyHint": !definition.write, "destructiveHint": definition.write, "openWorldHint": definition.write}})
	}
	return tools
}
func (s *mcpServer) callIDETool(name string, raw jsonv1.RawMessage) (string, error) {
	args := map[string]any{}
	if len(raw) > 0 && string(raw) != "null" {
		if err := json.Unmarshal(raw, &args); err != nil {
			return "", err
		}
	}
	if name != "ide_status" && name != "ide_open_file" && name != "ide_test_status" && name != "ide_logs" && !s.allowWrite {
		return "", fmt.Errorf("%s requires --write", name)
	}
	requested, _ := args["project"].(string)
	root, err := s.workspaceRoot(requested)
	if err != nil {
		return "", err
	}
	// This flag is supplied by the local MCP configuration, never by the model's tool arguments.
	args["localProvider"] = os.Getenv("ADOMNIA_AGENT_LOCAL") == "1"
	directory, err := agentcontrol.Directory()
	if err != nil {
		return "", err
	}
	result, err := agentcontrol.Call(context.Background(), directory, agentcontrol.Request{Project: root, Operation: name, Arguments: args})
	if err != nil {
		return "", err
	}
	return jsonText(result)
}
