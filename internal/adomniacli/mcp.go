package adomniacli

import (
	"bufio"
	jsonv1 "encoding/json"
	"encoding/json/jsontext"
	"encoding/json/v2"
	"fmt"
	"io"
	"net/http"
	"path/filepath"
	"strings"

	"adomnia/internal/collectionfs"
	"adomnia/internal/jsonutil"
	"adomnia/internal/mock"
)

// Revisions of the protocol this server understands, newest first. The client's requested
// version is echoed when known, otherwise the newest is offered and the client decides.
var mcpProtocolVersions = []string{"2025-06-18", "2025-03-26", "2024-11-05"}

const mcpServerInstructions = "adOmnia exposes the API collections of this machine: list and read requests, run them with their tests against real endpoints, and drive a local mock server to see what the code under development sends. Secrets in requests and environments are masked."

// JSON-RPC error codes.
const (
	rpcParseError     = -32700
	rpcInvalidRequest = -32600
	rpcMethodNotFound = -32601
	rpcInvalidParams  = -32602
)

type mcpRPC struct {
	JSONRPC string            `json:"jsonrpc"`
	ID      jsonv1.RawMessage `json:"id"`
	Method  string            `json:"method"`
	Params  jsonv1.RawMessage `json:"params"`
}

type mcpError struct {
	Code    int
	Message string
}

func (e *mcpError) Error() string { return e.Message }

func invalidParams(format string, args ...any) *mcpError {
	return &mcpError{rpcInvalidParams, fmt.Sprintf(format, args...)}
}

// MCP serves adOmnia's collections and mock server to an AI agent over stdio
// (`adomnia mcp [collection-folder]`). Everything stays on this machine: the mock
// runs inside this process, the collection is read from disk.
func MCP(args []string, stdin io.Reader, stdout, stderr io.Writer) int {
	defaultFolder := ""
	if len(args) > 1 {
		defaultFolder = args[1]
	}
	server := &mcpServer{defaultFolder: defaultFolder, mux: http.NewServeMux()}
	mock.RegisterHandlers(server.mux)
	scanner := bufio.NewScanner(stdin)
	scanner.Buffer(make([]byte, 0, 64*1024), 16*1024*1024)
	for scanner.Scan() {
		line := strings.TrimSpace(scanner.Text())
		if line == "" {
			continue
		}
		reply, ok := server.respond([]byte(line), stderr)
		if !ok {
			continue
		}
		if err := jsonutil.MarshalWrite(stdout, reply); err != nil {
			return 1
		}
		// Il trasporto stdio di MCP è delimitato da newline: encoding/json/v2 non termina il
		// messaggio con \n come faceva l'Encoder v1, senza separatore le risposte si unirebbero.
		if _, err := io.WriteString(stdout, "\n"); err != nil {
			return 1
		}
	}
	return 0
}

// respond handles one message; ok is false for notifications, which get no reply.
func (s *mcpServer) respond(line []byte, stderr io.Writer) (map[string]any, bool) {
	var request mcpRPC
	if err := json.Unmarshal(line, &request); err != nil {
		fmt.Fprintf(stderr, "adomnia mcp: bad message: %v\n", err)
		return mcpErrorReply(jsonv1.RawMessage("null"), rpcParseError, "parse error"), true
	}
	if len(request.ID) == 0 { // notification (initialized, cancelled…)
		return nil, false
	}
	if request.Method == "" {
		return mcpErrorReply(request.ID, rpcInvalidRequest, "invalid request: method is required"), true
	}
	result, err := s.handle(request)
	if err != nil {
		return mcpErrorReply(request.ID, err.Code, err.Message), true
	}
	return map[string]any{"jsonrpc": "2.0", "id": request.ID, "result": result}, true
}

func mcpErrorReply(id jsonv1.RawMessage, code int, message string) map[string]any {
	return map[string]any{"jsonrpc": "2.0", "id": id, "error": map[string]any{"code": code, "message": message}}
}

type mcpServer struct {
	defaultFolder string
	mux           *http.ServeMux
}

func (s *mcpServer) handle(request mcpRPC) (any, *mcpError) {
	switch request.Method {
	case "initialize":
		return s.initialize(request.Params), nil
	case "ping", "logging/setLevel":
		return map[string]any{}, nil
	case "tools/list":
		return map[string]any{"tools": mcpTools()}, nil
	case "tools/call":
		return s.toolsCall(request.Params)
	case "resources/list":
		return s.resourcesList(request.Params)
	case "resources/templates/list":
		return map[string]any{"resourceTemplates": mcpResourceTemplates()}, nil
	case "resources/read":
		return s.resourcesRead(request.Params)
	case "prompts/list":
		return map[string]any{"prompts": mcpPrompts()}, nil
	case "prompts/get":
		return s.promptsGet(request.Params)
	}
	return nil, &mcpError{rpcMethodNotFound, "method not found: " + request.Method}
}

func (s *mcpServer) initialize(raw jsonv1.RawMessage) map[string]any {
	var params struct {
		ProtocolVersion string `json:"protocolVersion"`
	}
	_ = json.Unmarshal(raw, &params)
	version := mcpProtocolVersions[0]
	for _, supported := range mcpProtocolVersions {
		if supported == params.ProtocolVersion {
			version = supported
		}
	}
	return map[string]any{
		"protocolVersion": version,
		"capabilities": map[string]any{
			"tools":     map[string]any{"listChanged": false},
			"resources": map[string]any{"subscribe": false, "listChanged": false},
			"prompts":   map[string]any{"listChanged": false},
			"logging":   map[string]any{},
		},
		"serverInfo":   map[string]any{"name": "adomnia", "title": "adOmnia", "version": "1"},
		"instructions": mcpServerInstructions,
	}
}

func (s *mcpServer) toolsCall(raw jsonv1.RawMessage) (any, *mcpError) {
	var call struct {
		Name      string            `json:"name"`
		Arguments jsonv1.RawMessage `json:"arguments"`
	}
	if err := json.Unmarshal(raw, &call); err != nil || call.Name == "" {
		return nil, invalidParams("tools/call needs a tool name")
	}
	if !mcpKnownTool(call.Name) {
		return nil, invalidParams("unknown tool %q", call.Name)
	}
	text, err := s.callTool(call.Name, call.Arguments)
	if err != nil {
		text = err.Error()
	}
	return map[string]any{"content": []map[string]string{{"type": "text", "text": text}}, "isError": err != nil}, nil
}

// loadCollection reads the collection folder: the requested one, else the server default, else ".".
func (s *mcpServer) loadCollection(requested string) (collectionfs.Collection, string, error) {
	folder := strings.TrimSpace(requested)
	if folder == "" {
		folder = s.defaultFolder
	}
	if folder == "" {
		folder = "."
	}
	folder, err := filepath.Abs(folder)
	if err != nil {
		return collectionfs.Collection{}, "", err
	}
	collection, err := collectionfs.ImportCollection(folder)
	if err != nil {
		return collectionfs.Collection{}, "", fmt.Errorf("no adOmnia collection in %s (export one with Export to folder): %w", folder, err)
	}
	return collection, folder, nil
}

func jsonText(value any) (string, error) {
	data, err := jsonutil.Marshal(value, jsontext.WithIndent("  "))
	return string(data), err
}
