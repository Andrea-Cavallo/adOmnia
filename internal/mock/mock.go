package mock

import (
	"adomnia/internal/devlog"
	"adomnia/internal/httputil"
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"math/rand"
	"net"
	"net/http"
	"os"
	"path/filepath"
	"regexp"
	"strings"
	"sync"
	"sync/atomic"
	"time"
)

var mockHitFileMu sync.Mutex

// appendHitToFile persists a single mock hit as a JSON line under the user config
// dir. Best-effort: any failure is silently ignored so it never breaks the mock.
func appendHitToFile(entry mockHitEntry) {
	dir, err := os.UserConfigDir()
	if err != nil {
		return
	}
	logDir := filepath.Join(dir, "adomnia")
	if err := os.MkdirAll(logDir, 0o755); err != nil {
		return
	}
	line, err := json.Marshal(entry)
	if err != nil {
		return
	}
	mockHitFileMu.Lock()
	defer mockHitFileMu.Unlock()
	f, err := os.OpenFile(filepath.Join(logDir, "mock-hits.jsonl"), os.O_APPEND|os.O_CREATE|os.O_WRONLY, 0o644)
	if err != nil {
		return
	}
	defer f.Close()
	_, _ = f.Write(append(line, '\n'))
}

type mockResponse struct {
	ID             string            `json:"id"`
	Name           string            `json:"name"`
	Status         int               `json:"status"`
	Headers        map[string]string `json:"headers"`
	Body           string            `json:"body"`
	GenerationMode string            `json:"generationMode"`
	BodySchema     string            `json:"bodySchema"`
	Conditions     []mockCondition   `json:"conditions"`
	DelayMs        int               `json:"delayMs"`
	IsActive       bool              `json:"isActive"`
}

type mockCondition struct {
	Source   string `json:"source"`
	Field    string `json:"field"`
	Operator string `json:"operator"`
	Value    string `json:"value"`
}

type mockEndpoint struct {
	ID        string         `json:"id"`
	Path      string         `json:"path"`
	Method    string         `json:"method"`
	Responses []mockResponse `json:"responses"`
	Mode      string         `json:"mode"` // "first_active", "random", "round_robin"
	rrIndex   uint64
}

type mockServerConfig struct {
	Port                   int            `json:"port"`
	Password               string         `json:"password"`
	Endpoints              []mockEndpoint `json:"endpoints"`
	DefaultResponseDelayMs int            `json:"defaultResponseDelayMs,omitempty"`
	CorsHeadersAuto        bool           `json:"corsHeadersAuto,omitempty"`
	LogHitsToFile          bool           `json:"logHitsToFile,omitempty"`
}

var (
	mockSrv       *http.Server
	mockSrvMu     sync.Mutex
	mockSrvPort   int
	mockSrvLn     net.Listener // track listener so we can close it explicitly
	mockCfg       mockServerConfig
	mockCfgMu     sync.RWMutex
	mockHits      []mockHitEntry
	mockHitsMu    sync.Mutex
	mockHitSeq    int64
	persistConfig func([]byte) error
)

// SetPersistConfig supplies optional local persistence for recorded mock endpoints.
func SetPersistConfig(persist func([]byte) error) {
	persistConfig = persist
}

type mockHitEntry struct {
	ID         string `json:"id"`
	Timestamp  string `json:"timestamp"`
	Method     string `json:"method"`
	Path       string `json:"path"`
	Matched    bool   `json:"matched"`
	ResponseID string `json:"responseId"`
	Status     int    `json:"status"`
}

func mockStartHandler(w http.ResponseWriter, r *http.Request) {
	devlog.Log("mockStartHandler", "richiesta avvio mock server ricevuta", map[string]any{"remote": r.RemoteAddr})
	if r.Method != http.MethodPost {
		http.Error(w, "POST only", http.StatusMethodNotAllowed)
		return
	}

	var cfg mockServerConfig
	if err := json.NewDecoder(r.Body).Decode(&cfg); err != nil {
		devlog.Err("mockStartHandler", "decode configurazione mock fallito", err, nil)
		httputil.JSONError(w, "invalid JSON: "+err.Error(), 400)
		return
	}

	if cfg.Port < 1024 || cfg.Port > 65535 {
		cfg.Port = 9090
	}
	devlog.Log("mockStartHandler", "configurazione mock decodificata", map[string]any{"port": cfg.Port, "endpoints": len(cfg.Endpoints)})

	mockCfgMu.Lock()
	mockCfg = cfg
	mockCfgMu.Unlock()

	mockSrvMu.Lock()
	defer mockSrvMu.Unlock()

	// Gracefully shut down any existing mock server
	if mockSrv != nil {
		devlog.Log("mockStartHandler", "arresto mock server esistente", map[string]any{"port": mockSrvPort})
		// Close the listener first so Shutdown returns quickly
		if mockSrvLn != nil {
			mockSrvLn.Close()
			mockSrvLn = nil
		}
		ctx, cancel := context.WithTimeout(context.Background(), 3*time.Second)
		mockSrv.Shutdown(ctx)
		cancel()
		mockSrv = nil
		mockSrvPort = 0
	}

	ln, err := net.Listen("tcp", fmt.Sprintf("127.0.0.1:%d", cfg.Port))
	if err != nil {
		devlog.Err("mockStartHandler", "bind porta mock fallito", err, map[string]any{"port": cfg.Port})
		httputil.JSONError(w, fmt.Sprintf("cannot listen on port %d: %v", cfg.Port, err), 500)
		return
	}

	mux := http.NewServeMux()
	mux.HandleFunc("/", mockRequestHandler)

	mockSrvLn = ln
	mockSrv = &http.Server{Handler: mux, ReadTimeout: 10 * time.Second, WriteTimeout: 30 * time.Second}
	mockSrvPort = cfg.Port

	go func() {
		devlog.Info("mockStartHandler", "mock server in ascolto", map[string]any{"port": cfg.Port, "endpoints": len(cfg.Endpoints)})
		if err := mockSrv.Serve(ln); err != nil && err != http.ErrServerClosed {
			devlog.Err("mockStartHandler", "mock server terminato con errore", err, map[string]any{"port": cfg.Port})
		}
	}()

	mockHitsMu.Lock()
	mockHits = nil
	mockHitsMu.Unlock()

	devlog.Info("mockStartHandler", "mock server avviato con successo", map[string]any{"port": cfg.Port, "endpoints": len(cfg.Endpoints)})

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]interface{}{"ok": true, "port": cfg.Port})
}

func mockStopHandler(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		http.Error(w, "POST only", http.StatusMethodNotAllowed)
		return
	}

	mockSrvMu.Lock()
	defer mockSrvMu.Unlock()

	if mockSrv != nil {
		devlog.Info("mockStopHandler", "arresto mock server", map[string]any{"port": mockSrvPort})
		if mockSrvLn != nil {
			mockSrvLn.Close()
			mockSrvLn = nil
		}
		mockSrv.Close()
		mockSrv = nil
		mockSrvPort = 0
	}

	w.Header().Set("Content-Type", "application/json")
	w.Write([]byte(`{"ok":true}`))
}

func mockStatusHandler(w http.ResponseWriter, r *http.Request) {
	mockSrvMu.Lock()
	running := mockSrv != nil
	port := mockSrvPort
	mockSrvMu.Unlock()

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]interface{}{"running": running, "port": port})
}

func mockHitsHandler(w http.ResponseWriter, r *http.Request) {
	mockHitsMu.Lock()
	hits := make([]mockHitEntry, len(mockHits))
	copy(hits, mockHits)
	mockHitsMu.Unlock()

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(hits)
}

func mockRequestHandler(w http.ResponseWriter, r *http.Request) {
	mockCfgMu.RLock()
	cfg := mockCfg
	mockCfgMu.RUnlock()

	// Automatic CORS: answer preflight and tag every response with permissive headers.
	if cfg.CorsHeadersAuto {
		w.Header().Set("Access-Control-Allow-Origin", "*")
		w.Header().Set("Access-Control-Allow-Methods", "GET, QUERY, POST, PUT, PATCH, DELETE, OPTIONS")
		w.Header().Set("Access-Control-Allow-Headers", "*")
		w.Header().Set("Access-Control-Max-Age", "86400")
		if strings.ToUpper(r.Method) == http.MethodOptions {
			w.WriteHeader(http.StatusNoContent)
			recordHit(r.Method, r.URL.Path, true, "", http.StatusNoContent)
			return
		}
	}

	if cfg.Password != "" {
		auth := r.Header.Get("X-Mock-Auth")
		if auth != cfg.Password {
			w.Header().Set("Content-Type", "application/json")
			w.WriteHeader(http.StatusUnauthorized)
			w.Write([]byte(`{"error":"unauthorized","message":"invalid or missing mock auth"}`))
			recordHit(r.Method, r.URL.Path, false, "", 401)
			return
		}
	}

	reqPath := normalizePath(r.URL.Path)
	reqMethod := strings.ToUpper(r.Method)

	var matched *mockEndpoint
	pathParams := map[string]string{}
	for i := range cfg.Endpoints {
		ep := &cfg.Endpoints[i]
		if strings.ToUpper(ep.Method) != reqMethod && ep.Method != "*" {
			continue
		}
		params, ok := matchPathParams(ep.Path, reqPath)
		if ok {
			matched = ep
			pathParams = params
			break
		}
	}

	if matched == nil {
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusNotFound)
		w.Write([]byte(`{"error":"no matching mock endpoint"}`))
		recordHit(reqMethod, reqPath, false, "", 404)
		return
	}

	bodyBytes, err := readAndRestoreBody(r)
	if err != nil {
		httputil.JSONError(w, "cannot read request body: "+err.Error(), http.StatusBadRequest)
		recordHit(reqMethod, reqPath, true, "", 400)
		return
	}

	resp, conditionMode := pickResponseForRequest(matched, r, pathParams, bodyBytes)
	if resp == nil {
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusNotFound)
		if conditionMode {
			w.Write([]byte(`{"error":"no matching condition"}`))
		} else {
			w.Write([]byte(`{"error":"no active response for endpoint"}`))
		}
		recordHit(reqMethod, reqPath, true, "", 404)
		return
	}

	delayMs := resp.DelayMs
	if delayMs <= 0 {
		delayMs = cfg.DefaultResponseDelayMs
	}
	if delayMs > 0 {
		time.Sleep(time.Duration(delayMs) * time.Millisecond)
	}

	for k, v := range resp.Headers {
		w.Header().Set(k, v)
	}

	responseBody := renderMockResponseBody(resp)
	if w.Header().Get("Content-Type") == "" {
		if len(responseBody) > 0 && (responseBody[0] == '{' || responseBody[0] == '[') {
			w.Header().Set("Content-Type", "application/json")
		} else {
			w.Header().Set("Content-Type", "text/plain")
		}
	}

	status := resp.Status
	if status == 0 {
		status = 200
	}
	w.WriteHeader(status)
	w.Write([]byte(responseBody))

	recordHit(reqMethod, reqPath, true, resp.ID, status)
}

func readAndRestoreBody(r *http.Request) ([]byte, error) {
	if r.Body == nil {
		return nil, nil
	}
	bodyBytes, err := io.ReadAll(r.Body)
	if err != nil {
		return nil, err
	}
	r.Body = io.NopCloser(bytes.NewReader(bodyBytes))
	return bodyBytes, nil
}

func renderMockResponseBody(resp *mockResponse) string {
	if resp.GenerationMode != "schema" || strings.TrimSpace(resp.BodySchema) == "" {
		return resp.Body
	}

	var schema map[string]interface{}
	if err := json.Unmarshal([]byte(resp.BodySchema), &schema); err != nil {
		return resp.Body
	}

	body, err := GenerateFromSchema(schema)
	if err != nil {
		return resp.Body
	}
	return body
}

func mockPreviewSchemaHandler(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		http.Error(w, "POST only", http.StatusMethodNotAllowed)
		return
	}

	var req struct {
		Schema string `json:"schema"`
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		httputil.JSONError(w, "invalid JSON: "+err.Error(), http.StatusBadRequest)
		return
	}

	var schema map[string]interface{}
	if err := json.Unmarshal([]byte(req.Schema), &schema); err != nil {
		httputil.JSONError(w, "invalid schema JSON: "+err.Error(), http.StatusBadRequest)
		return
	}

	body, err := GenerateFromSchema(schema)
	if err != nil {
		httputil.JSONError(w, err.Error(), http.StatusBadRequest)
		return
	}

	w.Header().Set("Content-Type", "application/json")
	w.Write([]byte(body))
}

func pickResponse(ep *mockEndpoint) *mockResponse {
	active := []int{}
	for i, r := range ep.Responses {
		if r.IsActive {
			active = append(active, i)
		}
	}
	if len(active) == 0 {
		return nil
	}

	switch ep.Mode {
	case "random":
		idx := active[rand.Intn(len(active))]
		return &ep.Responses[idx]
	case "round_robin":
		n := atomic.AddUint64(&ep.rrIndex, 1)
		idx := active[(int(n)-1)%len(active)]
		return &ep.Responses[idx]
	default:
		return &ep.Responses[active[0]]
	}
}

func pickResponseForRequest(ep *mockEndpoint, r *http.Request, pathParams map[string]string, bodyBytes []byte) (*mockResponse, bool) {
	hasConditions := false
	for _, resp := range ep.Responses {
		if len(resp.Conditions) > 0 {
			hasConditions = true
			break
		}
	}
	if !hasConditions {
		return pickResponse(ep), false
	}

	for i := range ep.Responses {
		resp := &ep.Responses[i]
		if !resp.IsActive {
			continue
		}
		if matchesAllConditions(r, *resp, pathParams, bodyBytes) {
			return resp, true
		}
	}
	return nil, true
}

func extractField(r *http.Request, cond mockCondition, pathParams map[string]string, bodyBytes []byte) (string, bool) {
	switch cond.Source {
	case "query":
		values := r.URL.Query()
		if !values.Has(cond.Field) {
			return "", false
		}
		return values.Get(cond.Field), true
	case "header":
		v := r.Header.Get(cond.Field)
		return v, v != ""
	case "path_param":
		v, ok := pathParams[cond.Field]
		return v, ok
	case "body_jsonpath":
		return extractJSONPath(bodyBytes, cond.Field)
	default:
		return "", false
	}
}

func extractJSONPath(body []byte, path string) (string, bool) {
	if len(body) == 0 || strings.TrimSpace(path) == "" {
		return "", false
	}

	var obj interface{}
	if err := json.Unmarshal(body, &obj); err != nil {
		return "", false
	}

	parts := strings.Split(strings.TrimPrefix(path, "."), ".")
	current := obj
	for _, part := range parts {
		if part == "" {
			continue
		}
		m, ok := current.(map[string]interface{})
		if !ok {
			return "", false
		}
		current, ok = m[part]
		if !ok {
			return "", false
		}
	}

	switch v := current.(type) {
	case string:
		return v, true
	case float64:
		return fmt.Sprintf("%g", v), true
	case bool:
		return fmt.Sprintf("%t", v), true
	case nil:
		return "", false
	default:
		raw, err := json.Marshal(v)
		if err != nil {
			return "", false
		}
		return string(raw), true
	}
}

func evaluateCondition(r *http.Request, cond mockCondition, pathParams map[string]string, bodyBytes []byte) bool {
	actual, exists := extractField(r, cond, pathParams, bodyBytes)

	switch cond.Operator {
	case "exists":
		return exists
	case "not_exists":
		return !exists
	case "eq":
		return exists && actual == cond.Value
	case "neq":
		return !exists || actual != cond.Value
	case "contains":
		return exists && strings.Contains(actual, cond.Value)
	case "not_contains":
		return !exists || !strings.Contains(actual, cond.Value)
	case "regex":
		if !exists {
			return false
		}
		re, err := regexp.Compile(cond.Value)
		if err != nil {
			return false
		}
		return re.MatchString(actual)
	default:
		return false
	}
}

func matchesAllConditions(r *http.Request, resp mockResponse, pathParams map[string]string, bodyBytes []byte) bool {
	if len(resp.Conditions) == 0 {
		return true
	}
	for _, cond := range resp.Conditions {
		if !evaluateCondition(r, cond, pathParams, bodyBytes) {
			return false
		}
	}
	return true
}

func matchPath(pattern, reqPath string) bool {
	_, ok := matchPathParams(pattern, reqPath)
	return ok
}

func matchPathParams(pattern, reqPath string) (map[string]string, bool) {
	params := map[string]string{}
	pattern = normalizePath(pattern)
	reqPath = normalizePath(reqPath)
	if pattern == reqPath {
		return params, true
	}
	patParts := strings.Split(pattern, "/")
	reqParts := strings.Split(reqPath, "/")
	if len(patParts) != len(reqParts) {
		if len(patParts) > 0 && patParts[len(patParts)-1] == "**" {
			if len(reqParts) >= len(patParts)-1 && matchPrefix(patParts[:len(patParts)-1], reqParts) {
				collectPathParams(params, patParts[:len(patParts)-1], reqParts)
				return params, true
			}
		}
		return nil, false
	}
	for i, p := range patParts {
		if p == "*" || (len(p) > 1 && p[0] == ':') {
			if len(p) > 1 && p[0] == ':' {
				params[p[1:]] = reqParts[i]
			}
			continue
		}
		if isBracePathParam(p) {
			params[p[1:len(p)-1]] = reqParts[i]
			continue
		}
		if !strings.EqualFold(p, reqParts[i]) {
			return nil, false
		}
	}
	return params, true
}

func matchPrefix(patParts, reqParts []string) bool {
	for i, p := range patParts {
		if p == "*" || (len(p) > 1 && p[0] == ':') {
			continue
		}
		if isBracePathParam(p) {
			continue
		}
		if i >= len(reqParts) || !strings.EqualFold(p, reqParts[i]) {
			return false
		}
	}
	return true
}

func collectPathParams(params map[string]string, patParts, reqParts []string) {
	for i, p := range patParts {
		if i >= len(reqParts) {
			return
		}
		if len(p) > 1 && p[0] == ':' {
			params[p[1:]] = reqParts[i]
			continue
		}
		if isBracePathParam(p) {
			params[p[1:len(p)-1]] = reqParts[i]
		}
	}
}

func isBracePathParam(part string) bool {
	return len(part) > 2 && part[0] == '{' && part[len(part)-1] == '}'
}

func normalizePath(p string) string {
	if !strings.HasPrefix(p, "/") {
		p = "/" + p
	}
	p = strings.TrimSuffix(p, "/")
	if p == "" {
		p = "/"
	}
	return p
}

func recordHit(method, path string, matched bool, responseID string, status int) {
	seq := atomic.AddInt64(&mockHitSeq, 1)
	entry := mockHitEntry{
		ID:         fmt.Sprintf("mh_%d", seq),
		Timestamp:  time.Now().Format("15:04:05.000"),
		Method:     method,
		Path:       path,
		Matched:    matched,
		ResponseID: responseID,
		Status:     status,
	}
	mockHitsMu.Lock()
	if len(mockHits) >= 500 {
		mockHits = mockHits[1:]
	}
	mockHits = append(mockHits, entry)
	mockHitsMu.Unlock()

	mockCfgMu.RLock()
	logToFile := mockCfg.LogHitsToFile
	mockCfgMu.RUnlock()
	if logToFile {
		appendHitToFile(entry)
	}
}

// RegisterHandlers registers HTTP and WebSocket mock server endpoints.
func RegisterHandlers(mux *http.ServeMux) {
	mux.HandleFunc("/mock/start", mockStartHandler)
	mux.HandleFunc("/mock/stop", mockStopHandler)
	mux.HandleFunc("/mock/status", mockStatusHandler)
	mux.HandleFunc("/mock/hits", mockHitsHandler)
	mux.HandleFunc("/mock/record", recordReplayHandler)
	mux.HandleFunc("/mock/preview-schema", mockPreviewSchemaHandler)
	mux.HandleFunc("/ws/mock/start", wsMockStartHandler)
	mux.HandleFunc("/ws/mock/stop", wsMockStopHandler)
	mux.HandleFunc("/ws/mock/status", wsMockStatusHandler)
	mux.HandleFunc("/ws/mock/rules", func(w http.ResponseWriter, r *http.Request) {
		if r.Method == http.MethodPost {
			wsMockRulesSaveHandler(w, r)
			return
		}
		wsMockRulesGetHandler(w, r)
	})
	mux.HandleFunc("/ws/mock/hits/clear", wsMockHitsClearHandler)
}
