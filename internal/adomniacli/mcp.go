package adomniacli

import (
	"bufio"
	"bytes"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"net/http/httptest"
	"path/filepath"
	"strings"

	"adomnia/internal/collectionfs"
	"adomnia/internal/collectionresolve"
	"adomnia/internal/mock"
)

const mcpProtocolVersion = "2024-11-05"

type mcpRPC struct {
	ID     json.RawMessage `json:"id"`
	Method string          `json:"method"`
	Params json.RawMessage `json:"params"`
}

type mcpTool struct {
	Name        string         `json:"name"`
	Description string         `json:"description"`
	InputSchema map[string]any `json:"inputSchema"`
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
	scanner.Buffer(make([]byte, 0, 64*1024), 8*1024*1024)
	encoder := json.NewEncoder(stdout)
	for scanner.Scan() {
		var request mcpRPC
		if err := json.Unmarshal(scanner.Bytes(), &request); err != nil {
			fmt.Fprintf(stderr, "adomnia mcp: bad message: %v\n", err)
			continue
		}
		if len(request.ID) == 0 { // notification
			continue
		}
		result, rpcErr := server.handle(request)
		reply := map[string]any{"jsonrpc": "2.0", "id": request.ID}
		if rpcErr != "" {
			reply["error"] = map[string]any{"code": -32601, "message": rpcErr}
		} else {
			reply["result"] = result
		}
		if err := encoder.Encode(reply); err != nil {
			return 1
		}
	}
	return 0
}

type mcpServer struct {
	defaultFolder string
	mux           *http.ServeMux
}

func (s *mcpServer) handle(request mcpRPC) (any, string) {
	switch request.Method {
	case "initialize":
		return map[string]any{
			"protocolVersion": mcpProtocolVersion,
			"capabilities":    map[string]any{"tools": map[string]any{}},
			"serverInfo":      map[string]any{"name": "adomnia", "version": "1"},
		}, ""
	case "ping":
		return map[string]any{}, ""
	case "tools/list":
		return map[string]any{"tools": mcpTools()}, ""
	case "tools/call":
		var call struct {
			Name      string          `json:"name"`
			Arguments json.RawMessage `json:"arguments"`
		}
		if err := json.Unmarshal(request.Params, &call); err != nil {
			return nil, "invalid params"
		}
		text, err := s.callTool(call.Name, call.Arguments)
		if err != nil {
			text = err.Error()
		}
		return map[string]any{"content": []map[string]string{{"type": "text", "text": text}}, "isError": err != nil}, ""
	}
	return nil, "method not found: " + request.Method
}

func mcpTools() []mcpTool {
	object := func(props map[string]any) map[string]any {
		return map[string]any{"type": "object", "properties": props}
	}
	str := func(description string) map[string]any {
		return map[string]any{"type": "string", "description": description}
	}
	collection := str("Collection folder (contains collection.json). Defaults to the server's folder or the working directory.")
	return []mcpTool{
		{"collection_list_requests", "List the requests of an adOmnia collection (id, name, method, url, folder).", object(map[string]any{"collection": collection})},
		{"collection_run", "Run a collection's requests (with their tests) against real endpoints and return pass/fail per request.", object(map[string]any{
			"collection": collection,
			"folder":     str("Only run requests under this folder name or slash path."),
			"env":        str("Environment name loaded from environments/<name>.json."),
			"vars":       map[string]any{"type": "object", "additionalProperties": map[string]any{"type": "string"}, "description": "Variable overrides."},
		})},
		{"mock_start", "Start the local mock server. config: {port, endpoints:[...]} in adOmnia's mock format.", object(map[string]any{"config": map[string]any{"type": "object", "description": "Mock server configuration."}})},
		{"mock_status", "Report whether the mock server is running and on which port.", object(map[string]any{})},
		{"mock_hits", "Return the requests the mock server received (use it to verify what the code under development sent).", object(map[string]any{})},
		{"mock_clear_hits", "Forget the recorded mock hits.", object(map[string]any{})},
		{"mock_stop", "Stop the mock server.", object(map[string]any{})},
	}
}

func (s *mcpServer) callTool(name string, raw json.RawMessage) (string, error) {
	var args struct {
		Collection string            `json:"collection"`
		Folder     string            `json:"folder"`
		Env        string            `json:"env"`
		Vars       map[string]string `json:"vars"`
		Config     json.RawMessage   `json:"config"`
	}
	if len(raw) > 0 {
		if err := json.Unmarshal(raw, &args); err != nil {
			return "", fmt.Errorf("invalid arguments: %w", err)
		}
	}
	switch name {
	case "collection_list_requests":
		collection, _, err := s.loadCollection(args.Collection)
		if err != nil {
			return "", err
		}
		resolved, err := collectionresolve.ResolveRequests(collection)
		if err != nil {
			return "", err
		}
		type row struct {
			ID, Name, Method, URL, Folder string
		}
		rows := make([]row, 0, len(resolved))
		for _, req := range resolved {
			var folders []string
			for index, part := range req.FolderPath {
				if index%2 == 0 {
					folders = append(folders, part)
				}
			}
			rows = append(rows, row{req.Request.ID, req.Request.Name, strings.ToUpper(req.Request.Method), req.Request.URL, strings.Join(folders, "/")})
		}
		return jsonText(rows)
	case "collection_run":
		collection, folder, err := s.loadCollection(args.Collection)
		if err != nil {
			return "", err
		}
		vars, sources, err := loadRunVars(folder, args.Env, args.Vars)
		if err != nil {
			return "", err
		}
		return jsonText(executeCollection(collection, false, vars, sources, args.Folder))
	case "mock_start":
		if len(args.Config) == 0 {
			return "", fmt.Errorf("config is required")
		}
		return s.mock(http.MethodPost, "/mock/start", args.Config)
	case "mock_status":
		return s.mock(http.MethodGet, "/mock/status", nil)
	case "mock_hits":
		return s.mock(http.MethodGet, "/mock/hits", nil)
	case "mock_clear_hits":
		return s.mock(http.MethodPost, "/mock/hits/clear", nil)
	case "mock_stop":
		return s.mock(http.MethodPost, "/mock/stop", nil)
	}
	return "", fmt.Errorf("unknown tool %q", name)
}

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

// mock calls the in-process mock handlers, so no port or token is involved.
func (s *mcpServer) mock(method, path string, body []byte) (string, error) {
	request := httptest.NewRequest(method, path, bytes.NewReader(body))
	recorder := httptest.NewRecorder()
	s.mux.ServeHTTP(recorder, request)
	if recorder.Code >= 400 {
		return "", fmt.Errorf("%s: %s", path, strings.TrimSpace(recorder.Body.String()))
	}
	return recorder.Body.String(), nil
}

func jsonText(value any) (string, error) {
	data, err := json.MarshalIndent(value, "", "  ")
	return string(data), err
}
