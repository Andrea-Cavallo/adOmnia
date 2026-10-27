package adomniacli

import (
	"bytes"
	jsonv1 "encoding/json"
	"encoding/json/v2"
	"fmt"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"regexp"
	"sort"
	"strings"

	"github.com/Andrea-Cavallo/adOmnia/internal/collectionresolve"
	"github.com/Andrea-Cavallo/adOmnia/internal/jsonutil"
)

type mcpTool struct {
	Name        string         `json:"name"`
	Title       string         `json:"title,omitempty"`
	Description string         `json:"description"`
	InputSchema map[string]any `json:"inputSchema"`
	Annotations map[string]any `json:"annotations,omitempty"`
}

func mcpTools() []mcpTool {
	object := func(props map[string]any, required ...string) map[string]any {
		schema := map[string]any{"type": "object", "properties": props}
		if len(required) > 0 {
			schema["required"] = required
		}
		return schema
	}
	str := func(description string) map[string]any {
		return map[string]any{"type": "string", "description": description}
	}
	collection := str("Collection folder (contains collection.json). Defaults to the server's folder or the working directory.")
	project := str("Absolute or relative path of the Code Studio project to scan. Source is parsed statically and never executed.")
	environment := map[string]any{"type": "object", "description": "Environment with name, optional id and a complete variables array. Each variable has key, value, enabled and optional secret.", "properties": map[string]any{
		"id": str("Optional existing environment id."), "name": str("Environment file name: letters, digits, dot, underscore or hyphen."), "private": map[string]any{"type": "boolean", "description": "Private environments are not supported in shared folder collections."},
		"variables": map[string]any{"type": "array", "items": map[string]any{"type": "object", "properties": map[string]any{"key": str("Variable name."), "value": str("Variable value."), "enabled": map[string]any{"type": "boolean"}, "secret": map[string]any{"type": "boolean", "description": "Mask this value in MCP responses while keeping it available for local runs."}}, "required": []string{"key", "value", "enabled"}}},
	}, "required": []string{"name", "variables"}}
	readOnly := map[string]any{"readOnlyHint": true, "destructiveHint": false, "idempotentHint": true, "openWorldHint": false}
	local := map[string]any{"readOnlyHint": false, "destructiveHint": false, "idempotentHint": true, "openWorldHint": false}
	write := map[string]any{"readOnlyHint": false, "destructiveHint": true, "idempotentHint": true, "openWorldHint": false}
	destructive := map[string]any{"readOnlyHint": false, "destructiveHint": true, "idempotentHint": false, "openWorldHint": false}
	network := map[string]any{"readOnlyHint": false, "destructiveHint": false, "idempotentHint": false, "openWorldHint": true}
	return []mcpTool{
		{"project_list_routes", "List project routes", "Read HTTP routes from a Code Studio project using the same Developer Context detectors as the IDE. Returns method, path, source and warnings without executing code or exposing dotenv values.", object(map[string]any{"project": project}, "project"), readOnly},
		{"collection_create_from_code", "Create or sync a collection from code", "Scan project routes and create or update an adOmnia folder collection. Generated request ids are deterministic; custom requests are preserved.", object(map[string]any{"project": project, "collection": collection, "name": str("Collection name for a new collection."), "baseUrl": str("Base URL prefix, for example {{baseUrl}} or http://localhost:8080.")}, "project"), write},
		{"collection_list_requests", "List requests", "List the requests of an adOmnia collection (id, name, method, url, folder).", object(map[string]any{"collection": collection}), readOnly},
		{"collection_get_request", "Get a request", "Return one request of the collection in full (headers, params, bodies, auth, assertions, scripts) by id. Secrets are masked.", object(map[string]any{"collection": collection, "id": str("Request id from collection_list_requests.")}, "id"), readOnly},
		{"collection_upsert_request", "Create or update a request", "Create or replace a complete request in the collection. The request object uses adOmnia's request format; folder is an optional slash-separated destination.", object(map[string]any{"collection": collection, "folder": str("Optional slash-separated folder path."), "request": map[string]any{"type": "object", "description": "Complete adOmnia request, including id, method and url."}}, "request"), write},
		{"collection_delete_request", "Delete a request", "Delete one request from the collection by id.", object(map[string]any{"collection": collection, "id": str("Request id from collection_list_requests.")}, "id"), destructive},
		{"collection_list_environments", "List environments", "List the environments of the collection with their variable names. Secret values and secret-looking variable names are masked.", object(map[string]any{"collection": collection}), readOnly},
		{"collection_upsert_environment", "Create or update an environment", "Create or replace an environment and its variables. Set merge=true to update only the supplied variables and preserve all others, including secrets. Values remain local and are masked in responses.", object(map[string]any{"collection": collection, "environment": environment, "merge": map[string]any{"type": "boolean", "description": "Merge supplied variables by key instead of replacing the whole environment."}}, "environment"), write},
		{"collection_delete_environment", "Delete an environment", "Delete an environment and all its variables by name.", object(map[string]any{"collection": collection, "name": str("Environment name from collection_list_environments.")}, "name"), destructive},
		{"collection_run", "Run a collection", "Run a collection's requests (with their tests) against real endpoints and return pass/fail per request.", object(map[string]any{
			"collection": collection,
			"folder":     str("Only run requests under this folder name or slash path."),
			"env":        str("Environment name loaded from environments/<name>.json."),
			"vars":       map[string]any{"type": "object", "additionalProperties": map[string]any{"type": "string"}, "description": "Variable overrides."},
		}), network},
		{"mock_start", "Start the mock server", "Start the local mock server. config: {port, endpoints:[...]} in adOmnia's mock format.", object(map[string]any{"config": map[string]any{"type": "object", "description": "Mock server configuration."}}, "config"), local},
		{"mock_status", "Mock server status", "Report whether the mock server is running and on which port.", object(map[string]any{}), readOnly},
		{"mock_hits", "Mock hits", "Return the requests the mock server received (use it to verify what the code under development sent).", object(map[string]any{}), readOnly},
		{"mock_clear_hits", "Clear mock hits", "Forget the recorded mock hits.", object(map[string]any{}), local},
		{"mock_stop", "Stop the mock server", "Stop the mock server.", object(map[string]any{}), local},
		{"stress_run", "Run a stress plan", "Execute a .stress.json flow plan exported from adOmnia and return p50/p95/p99, RPS, APDEX and release gate pass/fail.", object(map[string]any{
			"plan": str("Absolute or relative path to the .stress.json plan file."),
		}, "plan"), network},
		{"collection_benchmark", "Benchmark a collection", "Run the collection N times (1–20) and return latency percentiles p50/p95/p99, min/max/avg and per-request fail rate. Use for regression checks after deployments.", object(map[string]any{
			"collection": collection,
			"runs":       map[string]any{"type": "integer", "description": "Number of runs (1–20, default 5)."},
			"env":        str("Environment name loaded from environments/<name>.json."),
			"vars":       map[string]any{"type": "object", "additionalProperties": map[string]any{"type": "string"}, "description": "Variable overrides."},
		}), network},
		{"app_startup_time", "Measure CLI startup time", "Spawn a fresh adomnia mcp subprocess, send initialize and measure milliseconds until the first response (cold-start latency of the binary).", object(map[string]any{}), readOnly},
		{"performance_report", "Full performance report (Markdown)", "Run startup benchmark, collection benchmark and/or stress test then generate a complete Markdown report. Saves to outputDir if provided. Includes an IDE Code Studio checklist for manual entries. Use this as the main sprint/release performance gate.", object(map[string]any{
			"title":      str("Report title (default: 'adOmnia Performance')."),
			"collection": collection,
			"runs":       map[string]any{"type": "integer", "description": "Collection benchmark runs (1–20, default 5)."},
			"plan":       str("Path to .stress.json for load test (optional)."),
			"env":        str("Environment name (optional)."),
			"vars":       map[string]any{"type": "object", "additionalProperties": map[string]any{"type": "string"}, "description": "Variable overrides."},
			"outputDir":  str("Directory to save the .md report (optional; content always returned even if omitted)."),
		}), network},
	}
}

func mcpKnownTool(name string) bool {
	for _, tool := range mcpTools() {
		if tool.Name == name {
			return true
		}
	}
	return false
}

func (s *mcpServer) callTool(name string, raw jsonv1.RawMessage) (string, error) {
	var args struct {
		Collection  string            `json:"collection"`
		Folder      string            `json:"folder"`
		Env         string            `json:"env"`
		ID          string            `json:"id"`
		Vars        map[string]string `json:"vars"`
		Config      jsonv1.RawMessage `json:"config"`
		Plan        string            `json:"plan"`
		Runs        int               `json:"runs"`
		Title       string            `json:"title"`
		OutputDir   string            `json:"outputDir"`
		Project     string            `json:"project"`
		Name        string            `json:"name"`
		BaseURL     string            `json:"baseUrl"`
		Request     jsonv1.RawMessage `json:"request"`
		Environment jsonv1.RawMessage `json:"environment"`
		Merge       bool              `json:"merge"`
	}
	if len(raw) > 0 && string(raw) != "null" {
		if err := json.Unmarshal(raw, &args); err != nil {
			return "", fmt.Errorf("invalid arguments: %w", err)
		}
	}
	switch name {
	case "project_list_routes":
		return s.projectListRoutes(args.Project)
	case "collection_create_from_code":
		return s.collectionCreateFromCode(args.Project, args.Collection, args.Name, args.BaseURL)
	case "collection_list_requests":
		return s.listRequests(args.Collection)
	case "collection_get_request":
		return s.getRequest(args.Collection, args.ID)
	case "collection_upsert_request":
		return s.collectionUpsertRequest(args.Collection, args.Folder, args.Request)
	case "collection_delete_request":
		return s.collectionDeleteRequest(args.Collection, args.ID)
	case "collection_list_environments":
		return s.listEnvironments(args.Collection)
	case "collection_upsert_environment":
		return s.collectionUpsertEnvironment(args.Collection, args.Environment, args.Merge)
	case "collection_delete_environment":
		return s.collectionDeleteEnvironment(args.Collection, args.Name)
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
	case "stress_run":
		return s.stressRun(args.Plan)
	case "collection_benchmark":
		return s.collectionBenchmark(args.Collection, args.Runs, args.Env, args.Vars)
	case "app_startup_time":
		return s.appStartupTime()
	case "performance_report":
		return s.performanceReport(perfReportParams{
			Title:      args.Title,
			Collection: args.Collection,
			Runs:       args.Runs,
			Plan:       args.Plan,
			Env:        args.Env,
			Vars:       args.Vars,
			OutputDir:  args.OutputDir,
		})
	}
	return "", fmt.Errorf("unknown tool %q", name)
}

type mcpRequestRow struct {
	ID     string `json:"id"`
	Name   string `json:"name"`
	Method string `json:"method"`
	URL    string `json:"url"`
	Folder string `json:"folder"`
}

// folderOf joins the folder names of a request; FolderPath alternates id and name.
func folderOf(path []string) string {
	var folders []string
	for index, part := range path {
		if index%2 == 0 {
			folders = append(folders, part)
		}
	}
	return strings.Join(folders, "/")
}

func (s *mcpServer) requestRows(requested string) ([]mcpRequestRow, error) {
	collection, _, err := s.loadCollection(requested)
	if err != nil {
		return nil, err
	}
	resolved, err := collectionresolve.ResolveRequests(collection)
	if err != nil {
		return nil, err
	}
	rows := make([]mcpRequestRow, 0, len(resolved))
	for _, req := range resolved {
		rows = append(rows, mcpRequestRow{req.Request.ID, req.Request.Name, strings.ToUpper(req.Request.Method), req.Request.URL, folderOf(req.FolderPath)})
	}
	return rows, nil
}

func (s *mcpServer) listRequests(requested string) (string, error) {
	rows, err := s.requestRows(requested)
	if err != nil {
		return "", err
	}
	return jsonText(rows)
}

func (s *mcpServer) getRequest(requested, id string) (string, error) {
	if strings.TrimSpace(id) == "" {
		return "", fmt.Errorf("id is required (see collection_list_requests)")
	}
	collection, _, err := s.loadCollection(requested)
	if err != nil {
		return "", err
	}
	resolved, err := collectionresolve.ResolveRequests(collection)
	if err != nil {
		return "", err
	}
	for _, req := range resolved {
		if req.Request.ID != id {
			continue
		}
		var generic any
		encoded, err := jsonutil.Marshal(map[string]any{"folder": folderOf(req.FolderPath), "request": req.Request})
		if err != nil {
			return "", err
		}
		if err := json.Unmarshal(encoded, &generic); err != nil {
			return "", err
		}
		return jsonText(maskSecrets(generic))
	}
	return "", fmt.Errorf("no request with id %q in the collection", id)
}

type mcpEnvironment struct {
	Name      string            `json:"name"`
	Variables map[string]string `json:"variables"`
}

func (s *mcpServer) environments(requested string) ([]mcpEnvironment, error) {
	_, folder, err := s.loadCollection(requested)
	if err != nil {
		return nil, err
	}
	entries, err := os.ReadDir(filepath.Join(folder, "environments"))
	if err != nil {
		if os.IsNotExist(err) {
			return []mcpEnvironment{}, nil
		}
		return nil, err
	}
	var result []mcpEnvironment
	for _, entry := range entries {
		if entry.IsDir() || !strings.HasSuffix(entry.Name(), ".json") {
			continue
		}
		name := strings.TrimSuffix(entry.Name(), ".json")
		vars, err := loadEnvironmentVars(folder, name)
		if err != nil {
			return nil, err
		}
		secretKeys, err := mcpSecretVariableKeys(folder, name)
		if err != nil {
			return nil, err
		}
		masked := make(map[string]string, len(vars))
		for key, value := range vars {
			if secretKeys[key] && value != "" {
				masked[key] = maskedValue
			} else {
				masked[key] = maskValue(key, value)
			}
		}
		result = append(result, mcpEnvironment{Name: name, Variables: masked})
	}
	sort.Slice(result, func(i, j int) bool { return result[i].Name < result[j].Name })
	if result == nil {
		result = []mcpEnvironment{}
	}
	return result, nil
}

func (s *mcpServer) listEnvironments(requested string) (string, error) {
	environments, err := s.environments(requested)
	if err != nil {
		return "", err
	}
	return jsonText(environments)
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

var secretKey = regexp.MustCompile(`(?i)(password|passwd|secret|token|api[-_ ]?key|authorization|passphrase|private[-_ ]?key|credential|cookie)`)

const maskedValue = "***"

func maskValue(key, value string) string {
	if value != "" && secretKey.MatchString(key) {
		return maskedValue
	}
	return value
}

// maskSecrets hides secret-looking values in decoded JSON: any field whose name looks secret, and
// {key, value} rows (headers, params, variables) whose key looks secret.
func maskSecrets(value any) any {
	switch typed := value.(type) {
	case map[string]any:
		rowKey, _ := typed["key"].(string)
		out := make(map[string]any, len(typed))
		for key, item := range typed {
			if text, ok := item.(string); ok && text != "" && (secretKey.MatchString(key) || (key == "value" && secretKey.MatchString(rowKey))) {
				out[key] = maskedValue
				continue
			}
			out[key] = maskSecrets(item)
		}
		return out
	case []any:
		out := make([]any, len(typed))
		for index, item := range typed {
			out[index] = maskSecrets(item)
		}
		return out
	}
	return value
}
