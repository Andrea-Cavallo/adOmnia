package main

import (
	"context"
	"encoding/json"
	"fmt"
	"math/rand"
	"net"
	"net/http"
	"strings"
	"sync"
	"sync/atomic"
	"time"
)

type mockResponse struct {
	ID       string            `json:"id"`
	Name     string            `json:"name"`
	Status   int               `json:"status"`
	Headers  map[string]string `json:"headers"`
	Body     string            `json:"body"`
	DelayMs  int               `json:"delayMs"`
	IsActive bool              `json:"isActive"`
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
	Port      int            `json:"port"`
	Password  string         `json:"password"`
	Endpoints []mockEndpoint `json:"endpoints"`
}

var (
	mockSrv     *http.Server
	mockSrvMu   sync.Mutex
	mockSrvPort int
	mockCfg     mockServerConfig
	mockCfgMu   sync.RWMutex
	mockHits    []mockHitEntry
	mockHitsMu  sync.Mutex
	mockHitSeq  int64
)

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
	dlog("mockStartHandler", "richiesta avvio mock server ricevuta", map[string]any{"remote": r.RemoteAddr})
	if r.Method != http.MethodPost {
		http.Error(w, "POST only", http.StatusMethodNotAllowed)
		return
	}

	var cfg mockServerConfig
	if err := json.NewDecoder(r.Body).Decode(&cfg); err != nil {
		dlogErr("mockStartHandler", "decode configurazione mock fallito", err, nil)
		jsonError(w, "invalid JSON: "+err.Error(), 400)
		return
	}

	if cfg.Port < 1024 || cfg.Port > 65535 {
		cfg.Port = 9090
	}
	dlog("mockStartHandler", "configurazione mock decodificata", map[string]any{"port": cfg.Port, "endpoints": len(cfg.Endpoints)})

	mockCfgMu.Lock()
	mockCfg = cfg
	mockCfgMu.Unlock()

	mockSrvMu.Lock()
	defer mockSrvMu.Unlock()

	if mockSrv != nil {
		ctx, cancel := context.WithTimeout(context.Background(), 3*time.Second)
		mockSrv.Shutdown(ctx)
		cancel()
		mockSrv = nil
	}

	ln, err := net.Listen("tcp", fmt.Sprintf("127.0.0.1:%d", cfg.Port))
	if err != nil {
		jsonError(w, fmt.Sprintf("cannot listen on port %d: %v", cfg.Port, err), 500)
		return
	}

	mux := http.NewServeMux()
	mux.HandleFunc("/", mockRequestHandler)

	mockSrv = &http.Server{Handler: mux, ReadTimeout: 10 * time.Second, WriteTimeout: 30 * time.Second}
	mockSrvPort = cfg.Port

	go mockSrv.Serve(ln)
	dlogInfo("mockStartHandler", "mock server avviato", map[string]any{"port": cfg.Port, "endpoints": len(cfg.Endpoints)})

	mockHitsMu.Lock()
	mockHits = nil
	mockHitsMu.Unlock()

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
	for i := range cfg.Endpoints {
		ep := &cfg.Endpoints[i]
		if strings.ToUpper(ep.Method) != reqMethod && ep.Method != "*" {
			continue
		}
		if matchPath(ep.Path, reqPath) {
			matched = ep
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

	resp := pickResponse(matched)
	if resp == nil {
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusNotFound)
		w.Write([]byte(`{"error":"no active response for endpoint"}`))
		recordHit(reqMethod, reqPath, true, "", 404)
		return
	}

	if resp.DelayMs > 0 {
		time.Sleep(time.Duration(resp.DelayMs) * time.Millisecond)
	}

	for k, v := range resp.Headers {
		w.Header().Set(k, v)
	}
	if w.Header().Get("Content-Type") == "" {
		if len(resp.Body) > 0 && (resp.Body[0] == '{' || resp.Body[0] == '[') {
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
	w.Write([]byte(resp.Body))

	recordHit(reqMethod, reqPath, true, resp.ID, status)
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

func matchPath(pattern, reqPath string) bool {
	pattern = normalizePath(pattern)
	if pattern == reqPath {
		return true
	}
	patParts := strings.Split(pattern, "/")
	reqParts := strings.Split(reqPath, "/")
	if len(patParts) != len(reqParts) {
		if len(patParts) > 0 && patParts[len(patParts)-1] == "**" {
			return len(reqParts) >= len(patParts)-1 && matchPrefix(patParts[:len(patParts)-1], reqParts)
		}
		return false
	}
	for i, p := range patParts {
		if p == "*" || (len(p) > 1 && p[0] == ':') {
			continue
		}
		if !strings.EqualFold(p, reqParts[i]) {
			return false
		}
	}
	return true
}

func matchPrefix(patParts, reqParts []string) bool {
	for i, p := range patParts {
		if p == "*" || (len(p) > 1 && p[0] == ':') {
			continue
		}
		if i >= len(reqParts) || !strings.EqualFold(p, reqParts[i]) {
			return false
		}
	}
	return true
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
}
