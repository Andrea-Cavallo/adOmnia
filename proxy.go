package main

import (
	"bufio"
	"bytes"
	"context"
	"crypto/tls"
	"encoding/json"
	"fmt"
	"io"
	"net"
	"net/http"
	"net/http/httptrace"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"time"
)

// --- Path Traversal Protection ---

func safeReadFile(filePath string) ([]byte, error) {
	cleaned := filepath.Clean(filePath)
	if strings.Contains(cleaned, "..") {
		return nil, fmt.Errorf("path traversal not allowed")
	}
	return os.ReadFile(cleaned)
}

// --- Types ---

type mapLocalRule struct {
	Pattern     string `json:"pattern"`
	FilePath    string `json:"filePath"`
	ContentType string `json:"contentType"`
}

type mapRemoteRule struct {
	Pattern     string `json:"pattern"`
	Replacement string `json:"replacement"`
}

type throttleConfig struct {
	LatencyMs     int `json:"latencyMs"`
	BandwidthKbps int `json:"bandwidthKbps"`
}

type proxyConfig struct {
	Port        int                 `json:"port"`
	Breakpoints []string            `json:"breakpoints"`
	Settings    *proxySettingsState `json:"settings,omitempty"`
	EnableHTTPS bool                `json:"enableHttps,omitempty"`
}

type proxySettingsState struct {
	MaxTrafficEntries int  `json:"maxTrafficEntries"`
	ReqBodyLimitKB    int  `json:"reqBodyLimitKB"`
	RespBodyLimitKB   int  `json:"respBodyLimitKB"`
	MapLocalEnabled   bool `json:"mapLocalEnabled"`
	MapRemoteEnabled  bool `json:"mapRemoteEnabled"`
}

type trafficEntry struct {
	ID          string            `json:"id"`
	Timestamp   string            `json:"timestamp"`
	Method      string            `json:"method"`
	URL         string            `json:"url"`
	ReqHeaders  map[string]string `json:"reqHeaders"`
	ReqBody     string            `json:"reqBody"`
	Status      int               `json:"status"`
	RespHeaders map[string]string `json:"respHeaders"`
	RespBody    string            `json:"respBody"`
	DurationMs  float64           `json:"durationMs"`
	Error       string            `json:"error,omitempty"`
	Matched     bool              `json:"matched"`
	Timing      *requestTiming    `json:"timing,omitempty"`
}

type requestTiming struct {
	DNSLookup     float64 `json:"dns"`
	TCPConnection float64 `json:"tcp"`
	TLSHandshake  float64 `json:"tls"`
	RequestSent   float64 `json:"request"`
	Waiting       float64 `json:"waiting"`
	ResponseRecv  float64 `json:"response"`
}

type cachedHostCert struct {
	cert      *tls.Certificate
	timestamp time.Time
}

// --- Global State ---

var (
	mapLocalRules   []mapLocalRule
	mapLocalRulesMu sync.RWMutex

	mapRemoteRules   []mapRemoteRule
	mapRemoteRulesMu sync.RWMutex

	proxyThrottle   throttleConfig
	proxyThrottleMu sync.RWMutex

	interceptProxy       *http.Server
	interceptProxyMu     sync.Mutex
	interceptProxyPort   int
	trafficLog           []trafficEntry
	trafficMu            sync.RWMutex
	trafficSeq           int64
	breakpoints          []string
	breakpointsMu        sync.RWMutex
	pendingBreakpoints   = make(map[string]*pendingBreakpoint)
	pendingBreakpointsMu sync.Mutex
	breakpointSeq        int64
	proxySettings        = proxySettingsState{MaxTrafficEntries: 500, ReqBodyLimitKB: 32, RespBodyLimitKB: 64, MapLocalEnabled: true, MapRemoteEnabled: true}
	proxySettingsMu      sync.RWMutex

	caCertPEM       []byte
	caKeyPEM        []byte
	caMu            sync.RWMutex
	hostCertCache   = make(map[string]*cachedHostCert)
	hostCertCacheMu sync.RWMutex
	httpsEnabled    bool
	httpsEnableMu   sync.RWMutex
)

type pendingBreakpoint struct {
	ID        string            `json:"id"`
	Timestamp string            `json:"timestamp"`
	Method    string            `json:"method"`
	URL       string            `json:"url"`
	Headers   map[string]string `json:"headers"`
	Body      string            `json:"body"`
	resumeCh  chan breakpointResume
}

type breakpointResume struct {
	Action  string            `json:"action"`
	Method  string            `json:"method"`
	URL     string            `json:"url"`
	Headers map[string]string `json:"headers"`
	Body    *string           `json:"body"`
}

// --- Server Lifecycle ---

func proxyStartHandler(w http.ResponseWriter, r *http.Request) {
	dlog("proxyStartHandler", "richiesta avvio proxy intercettore ricevuta", map[string]any{"remote": r.RemoteAddr})
	if r.Method != http.MethodPost {
		http.Error(w, "POST only", http.StatusMethodNotAllowed)
		return
	}

	var cfg proxyConfig
	if err := json.NewDecoder(r.Body).Decode(&cfg); err != nil {
		dlogErr("proxyStartHandler", "decode configurazione proxy fallito", err, nil)
		jsonError(w, "invalid JSON: "+err.Error(), 400)
		return
	}

	if cfg.Port < 1024 || cfg.Port > 65535 {
		cfg.Port = 8888
	}
	dlog("proxyStartHandler", "configurazione proxy decodificata", map[string]any{"port": cfg.Port, "enableHTTPS": cfg.EnableHTTPS})

	if len(cfg.Breakpoints) > 0 {
		breakpointsMu.Lock()
		breakpoints = cfg.Breakpoints
		breakpointsMu.Unlock()
	} else {
		proxyRulesMu.RLock()
		rules := make([]ProxyRule, len(proxyRules))
		copy(rules, proxyRules)
		proxyRulesMu.RUnlock()
		syncBreakpointsFromInterceptRules(rules)
	}

	if cfg.Settings != nil {
		proxySettingsMu.Lock()
		proxySettings = *cfg.Settings
		proxySettingsMu.Unlock()
	}

	httpsEnableMu.Lock()
	httpsEnabled = cfg.EnableHTTPS
	httpsEnableMu.Unlock()

	interceptProxyMu.Lock()
	defer interceptProxyMu.Unlock()

	if interceptProxy != nil {
		ctx, cancel := context.WithTimeout(context.Background(), 3*time.Second)
		interceptProxy.Shutdown(ctx)
		cancel()
		interceptProxy = nil
	}
	clearPendingBreakpoints()

	ln, err := net.Listen("tcp", fmt.Sprintf("127.0.0.1:%d", cfg.Port))
	if err != nil {
		jsonError(w, fmt.Sprintf("cannot listen on port %d: %v", cfg.Port, err), 500)
		return
	}

	mux := http.NewServeMux()
	mux.HandleFunc("/", interceptHandler)

	interceptProxy = &http.Server{
		Handler:      mux,
		ReadTimeout:  30 * time.Second,
		WriteTimeout: 60 * time.Second,
	}
	interceptProxyPort = cfg.Port

	go interceptProxy.Serve(ln)
	dlogInfo("proxyStartHandler", "proxy intercettore avviato", map[string]any{"port": cfg.Port, "https": cfg.EnableHTTPS})

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]interface{}{"ok": true, "port": cfg.Port})
}

func proxyStopHandler(w http.ResponseWriter, r *http.Request) {
	dlog("proxyStopHandler", "richiesta arresto proxy intercettore", map[string]any{"remote": r.RemoteAddr})
	if r.Method != http.MethodPost {
		http.Error(w, "POST only", http.StatusMethodNotAllowed)
		return
	}

	interceptProxyMu.Lock()
	defer interceptProxyMu.Unlock()

	if interceptProxy != nil {
		clearPendingBreakpoints()
		interceptProxy.Close()
		interceptProxy = nil
		dlogInfo("proxyStopHandler", "proxy intercettore fermato", nil)
	} else {
		dlog("proxyStopHandler", "nessun proxy attivo da fermare", nil)
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]interface{}{"ok": true})
}

func proxyTrafficHandler(w http.ResponseWriter, r *http.Request) {
	if r.Method == http.MethodDelete {
		trafficMu.Lock()
		trafficLog = nil
		trafficMu.Unlock()
		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(map[string]interface{}{"ok": true})
		return
	}

	trafficMu.RLock()
	entries := trafficLog
	trafficMu.RUnlock()

	if entries == nil {
		entries = []trafficEntry{}
	}

	caMu.RLock()
	caExists := caCertPEM != nil
	caMu.RUnlock()

	httpsEnableMu.RLock()
	httpsOn := httpsEnabled
	httpsEnableMu.RUnlock()

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]interface{}{
		"ok":           true,
		"entries":      entries,
		"count":        len(entries),
		"running":      interceptProxy != nil,
		"port":         interceptProxyPort,
		"caExists":     caExists,
		"httpsEnabled": httpsOn,
	})
}

func proxyBreakpointsHandler(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		http.Error(w, "POST only", http.StatusMethodNotAllowed)
		return
	}

	var body struct {
		Breakpoints []string `json:"breakpoints"`
	}
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
		jsonError(w, "invalid JSON: "+err.Error(), 400)
		return
	}

	breakpointsMu.Lock()
	breakpoints = body.Breakpoints
	breakpointsMu.Unlock()

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]interface{}{"ok": true})
}

func proxyBreakpointPendingHandler(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		http.Error(w, "GET only", http.StatusMethodNotAllowed)
		return
	}

	pendingBreakpointsMu.Lock()
	pending := make([]pendingBreakpoint, 0, len(pendingBreakpoints))
	for _, p := range pendingBreakpoints {
		pending = append(pending, pendingBreakpoint{
			ID:        p.ID,
			Timestamp: p.Timestamp,
			Method:    p.Method,
			URL:       p.URL,
			Headers:   p.Headers,
			Body:      p.Body,
		})
	}
	pendingBreakpointsMu.Unlock()

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]interface{}{"ok": true, "pending": pending, "count": len(pending)})
}

func proxyBreakpointResumeHandler(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		http.Error(w, "POST only", http.StatusMethodNotAllowed)
		return
	}

	var body struct {
		ID      string            `json:"id"`
		Action  string            `json:"action"`
		Method  string            `json:"method"`
		URL     string            `json:"url"`
		Headers map[string]string `json:"headers"`
		Body    *string           `json:"body"`
	}
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
		jsonError(w, "invalid JSON: "+err.Error(), 400)
		return
	}
	if body.ID == "" {
		jsonError(w, "id is required", 400)
		return
	}
	if body.Action == "" {
		body.Action = "resume"
	}

	pendingBreakpointsMu.Lock()
	pending := pendingBreakpoints[body.ID]
	pendingBreakpointsMu.Unlock()
	if pending == nil {
		jsonError(w, "pending breakpoint not found", 404)
		return
	}

	resume := breakpointResume{
		Action:  body.Action,
		Method:  body.Method,
		URL:     body.URL,
		Headers: body.Headers,
		Body:    body.Body,
	}
	select {
	case pending.resumeCh <- resume:
		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(map[string]interface{}{"ok": true})
	case <-time.After(2 * time.Second):
		jsonError(w, "request is no longer waiting", 409)
	}
}

func clearPendingBreakpoints() {
	pendingBreakpointsMu.Lock()
	defer pendingBreakpointsMu.Unlock()
	for id, pending := range pendingBreakpoints {
		delete(pendingBreakpoints, id)
		select {
		case pending.resumeCh <- breakpointResume{Action: "abort"}:
		default:
		}
	}
}

func waitForBreakpoint(ctx context.Context, method, targetURL string, headers map[string]string, body []byte) (string, string, map[string]string, []byte, bool, error) {
	pendingBreakpointsMu.Lock()
	breakpointSeq++
	pending := &pendingBreakpoint{
		ID:        fmt.Sprintf("bp-%d", breakpointSeq),
		Timestamp: time.Now().UTC().Format(time.RFC3339Nano),
		Method:    method,
		URL:       targetURL,
		Headers:   headers,
		Body:      string(body),
		resumeCh:  make(chan breakpointResume, 1),
	}
	pendingBreakpoints[pending.ID] = pending
	pendingBreakpointsMu.Unlock()

	defer func() {
		pendingBreakpointsMu.Lock()
		delete(pendingBreakpoints, pending.ID)
		pendingBreakpointsMu.Unlock()
	}()

	select {
	case resume := <-pending.resumeCh:
		if resume.Action == "abort" || resume.Action == "drop" {
			return method, targetURL, headers, body, true, nil
		}
		if resume.Method != "" {
			method = resume.Method
		}
		if resume.URL != "" {
			targetURL = resume.URL
		}
		if resume.Headers != nil {
			headers = resume.Headers
		}
		if resume.Body != nil {
			body = []byte(*resume.Body)
		}
		return method, targetURL, headers, body, false, nil
	case <-ctx.Done():
		return method, targetURL, headers, body, true, ctx.Err()
	case <-time.After(5 * time.Minute):
		return method, targetURL, headers, body, true, fmt.Errorf("breakpoint timed out")
	}
}

// --- HTTP Intercept Handler ---

func interceptHandler(w http.ResponseWriter, r *http.Request) {
	if r.Method == http.MethodConnect {
		handleConnect(w, r)
		return
	}

	start := time.Now()

	targetURL := r.URL.String()
	if r.URL.Host == "" {
		targetURL = "http://" + r.Host + r.URL.Path
		if r.URL.RawQuery != "" {
			targetURL += "?" + r.URL.RawQuery
		}
	}

	reqHeaders := make(map[string]string)
	for k, vs := range r.Header {
		reqHeaders[k] = strings.Join(vs, ", ")
	}

	var reqBodyBytes []byte
	if r.Body != nil {
		reqBodyBytes, _ = io.ReadAll(io.LimitReader(r.Body, 512*1024))
		r.Body.Close()
	}

	breakpointsMu.RLock()
	matched := matchesAnyPattern(targetURL, breakpoints)
	breakpointsMu.RUnlock()
	if matched {
		var aborted bool
		var waitErr error
		method := r.Method
		method, targetURL, reqHeaders, reqBodyBytes, aborted, waitErr = waitForBreakpoint(r.Context(), method, targetURL, reqHeaders, reqBodyBytes)
		if aborted {
			errMsg := "breakpoint aborted"
			if waitErr != nil {
				errMsg = waitErr.Error()
			}
			recordEntry(targetURL, method, reqHeaders, string(reqBodyBytes), 0, nil, "", time.Since(start), errMsg, matched)
			http.Error(w, errMsg, http.StatusGatewayTimeout)
			return
		}
		r.Method = method
	}

	// Map Local: serve from file if URL matches
	mapLocalRulesMu.RLock()
	localRules := mapLocalRules
	mapLocalRulesMu.RUnlock()

	for _, rule := range localRules {
		if matchesGlob(targetURL, rule.Pattern) {
			fileData, err := safeReadFile(rule.FilePath)
			if err != nil {
				recordEntry(targetURL, r.Method, reqHeaders, string(reqBodyBytes), 500, nil, "", time.Since(start), "map-local file read error: "+err.Error(), matched)
				http.Error(w, "map-local: cannot read file", http.StatusInternalServerError)
				return
			}
			applyThrottleLatency()
			ct := rule.ContentType
			if ct == "" {
				ct = "application/octet-stream"
			}
			respHeaders := map[string]string{"Content-Type": ct, "X-Map-Local": rule.FilePath}
			w.Header().Set("Content-Type", ct)
			w.Header().Set("X-Map-Local", rule.FilePath)
			w.WriteHeader(200)
			writeWithThrottle(w, fileData)
			recordEntry(targetURL, r.Method, reqHeaders, string(reqBodyBytes), 200, respHeaders, truncateBody(string(fileData), 64*1024), time.Since(start), "", matched)
			return
		}
	}

	// Map Remote: rewrite target URL if matches
	mapRemoteRulesMu.RLock()
	remoteRules := mapRemoteRules
	mapRemoteRulesMu.RUnlock()

	for _, rule := range remoteRules {
		if matchesGlob(targetURL, rule.Pattern) {
			targetURL = globRewrite(targetURL, rule.Pattern, rule.Replacement)
			break
		}
	}

	outReq, err := http.NewRequest(r.Method, targetURL, bytes.NewReader(reqBodyBytes))
	if err != nil {
		recordEntry(targetURL, r.Method, reqHeaders, string(reqBodyBytes), 0, nil, "", time.Since(start), err.Error(), matched)
		http.Error(w, "invalid request", http.StatusBadGateway)
		return
	}

	for k, v := range reqHeaders {
		lk := strings.ToLower(k)
		if lk == "host" || lk == "connection" || lk == "proxy-connection" {
			continue
		}
		outReq.Header.Set(k, v)
	}

	// Capture request timeline phases
	var (
		dnsStart, dnsEnd time.Time
		tcpStart, tcpEnd time.Time
		tlsStart, tlsEnd time.Time
		reqStart         time.Time
		gotFirstByte     time.Time
	)
	trace := &httptrace.ClientTrace{
		DNSStart:          func(_ httptrace.DNSStartInfo) { dnsStart = time.Now() },
		DNSDone:           func(_ httptrace.DNSDoneInfo) { dnsEnd = time.Now() },
		ConnectStart:      func(_, _ string) { tcpStart = time.Now() },
		ConnectDone:       func(_, _ string, _ error) { tcpEnd = time.Now() },
		TLSHandshakeStart: func() { tlsStart = time.Now() },
		TLSHandshakeDone:  func(_ tls.ConnectionState, _ error) { tlsEnd = time.Now() },
		GotFirstResponseByte: func() {
			if reqStart.IsZero() {
				reqStart = time.Now()
			}
			gotFirstByte = time.Now()
		},
	}
	outReq = outReq.WithContext(httptrace.WithClientTrace(r.Context(), trace))
	reqStart = time.Now()

	client := &http.Client{Timeout: 30 * time.Second}
	resp, err := client.Do(outReq)
	respEnd := time.Now()
	if err != nil {
		recordEntry(targetURL, r.Method, reqHeaders, string(reqBodyBytes), 0, nil, "", time.Since(start), err.Error(), matched)
		http.Error(w, "upstream error", http.StatusBadGateway)
		return
	}
	defer resp.Body.Close()

	respBodyBytes, _ := io.ReadAll(io.LimitReader(resp.Body, 1024*1024))
	bodyReadEnd := time.Now()

	timing := &requestTiming{}
	if !dnsStart.IsZero() && !dnsEnd.IsZero() {
		timing.DNSLookup = float64(dnsEnd.Sub(dnsStart).Microseconds()) / 1000.0
	}
	if !tcpStart.IsZero() && !tcpEnd.IsZero() {
		timing.TCPConnection = float64(tcpEnd.Sub(tcpStart).Microseconds()) / 1000.0
		if timing.DNSLookup > 0 {
			timing.TCPConnection -= timing.DNSLookup
		}
	}
	if !tlsStart.IsZero() && !tlsEnd.IsZero() {
		timing.TLSHandshake = float64(tlsEnd.Sub(tlsStart).Microseconds()) / 1000.0
	}
	if !reqStart.IsZero() && !gotFirstByte.IsZero() {
		timing.RequestSent = float64(gotFirstByte.Sub(reqStart).Microseconds()) / 1000.0
	}
	if !gotFirstByte.IsZero() {
		timing.Waiting = float64(respEnd.Sub(gotFirstByte).Microseconds()) / 1000.0
	}
	timing.ResponseRecv = float64(bodyReadEnd.Sub(respEnd).Microseconds()) / 1000.0

	applyThrottleLatency()

	respHeaders := make(map[string]string)
	for k, vs := range resp.Header {
		respHeaders[k] = strings.Join(vs, ", ")
		for _, v := range vs {
			w.Header().Add(k, v)
		}
	}

	w.WriteHeader(resp.StatusCode)
	writeWithThrottle(w, respBodyBytes)

	recordEntry(targetURL, r.Method, reqHeaders, string(reqBodyBytes), resp.StatusCode, respHeaders, string(respBodyBytes), time.Since(start), "", matched, timing)
}

// --- HTTPS CONNECT Handler ---

func handleConnect(w http.ResponseWriter, r *http.Request) {
	httpsEnableMu.RLock()
	enabled := httpsEnabled
	httpsEnableMu.RUnlock()

	if !enabled {
		http.Error(w, "HTTPS interception not enabled", http.StatusForbidden)
		return
	}

	host := r.Host
	if host == "" {
		host = r.URL.Host
	}

	hijacker, ok := w.(http.Hijacker)
	if !ok {
		http.Error(w, "hijacking not supported", http.StatusInternalServerError)
		return
	}

	clientConn, _, err := hijacker.Hijack()
	if err != nil {
		http.Error(w, "hijack failed", http.StatusServiceUnavailable)
		return
	}
	defer clientConn.Close()

	if _, err := clientConn.Write([]byte("HTTP/1.1 200 Connection Established\r\n\r\n")); err != nil {
		return
	}

	hostCert, err := getOrCreateHostCert(host)
	if err != nil {
		return
	}

	tlsConfig := &tls.Config{
		Certificates: []tls.Certificate{*hostCert},
		MinVersion:   tls.VersionTLS12,
	}
	tlsConn := tls.Server(clientConn, tlsConfig)
	defer tlsConn.Close()

	if err := tlsConn.Handshake(); err != nil {
		return
	}

	buf := make([]byte, 64*1024)
	n, err := tlsConn.Read(buf)
	if err != nil {
		return
	}

	req, err := http.ReadRequest(bufio.NewReader(bytes.NewReader(buf[:n])))
	if err != nil {
		return
	}
	req.URL.Scheme = "https"
	if req.URL.Host == "" {
		req.URL.Host = host
	}

	startTime := time.Now()
	reqHeaders := make(map[string]string)
	for k, vs := range req.Header {
		reqHeaders[k] = strings.Join(vs, ", ")
	}

	var reqBodyBytes []byte
	if req.Body != nil {
		reqBodyBytes, _ = io.ReadAll(io.LimitReader(req.Body, 512*1024))
	}
	req.Body = io.NopCloser(bytes.NewReader(reqBodyBytes))

	targetURL := req.URL.String()

	breakpointsMu.RLock()
	matched := matchesAnyPattern(targetURL, breakpoints)
	breakpointsMu.RUnlock()
	if matched {
		var aborted bool
		var waitErr error
		method := req.Method
		method, targetURL, reqHeaders, reqBodyBytes, aborted, waitErr = waitForBreakpoint(r.Context(), method, targetURL, reqHeaders, reqBodyBytes)
		if aborted {
			errMsg := "breakpoint aborted"
			if waitErr != nil {
				errMsg = waitErr.Error()
			}
			recordEntry(targetURL, method, reqHeaders, string(reqBodyBytes), 0, nil, "", time.Since(startTime), errMsg, matched)
			response := buildHTTPResponse(http.StatusGatewayTimeout, map[string]string{"Content-Type": "text/plain"}, []byte(errMsg))
			tlsConn.Write(response)
			return
		}
		req.Method = method
	}

	// Check Map Local
	mapLocalRulesMu.RLock()
	localRules := mapLocalRules
	mapLocalRulesMu.RUnlock()
	for _, rule := range localRules {
		if matchesGlob(targetURL, rule.Pattern) {
			fileData, ferr := safeReadFile(rule.FilePath)
			if ferr != nil {
				recordEntry(targetURL, req.Method, reqHeaders, string(reqBodyBytes), 500, nil, "", time.Since(startTime), "map-local: "+ferr.Error(), matched)
				return
			}
			applyThrottleLatency()
			ct := rule.ContentType
			if ct == "" {
				ct = "application/octet-stream"
			}
			respHeaders := map[string]string{"Content-Type": ct, "X-Map-Local": rule.FilePath}
			response := buildHTTPResponse(200, respHeaders, fileData)
			tlsConn.Write(response)
			recordEntry(targetURL, req.Method, reqHeaders, string(reqBodyBytes), 200, respHeaders, truncateBody(string(fileData), 64*1024), time.Since(startTime), "", matched)
			return
		}
	}

	// Check Map Remote
	mapRemoteRulesMu.RLock()
	remoteRules := mapRemoteRules
	mapRemoteRulesMu.RUnlock()
	for _, rule := range remoteRules {
		if matchesGlob(targetURL, rule.Pattern) {
			targetURL = globRewrite(targetURL, rule.Pattern, rule.Replacement)
			break
		}
	}

	// Forward to upstream
	upstreamReq, uerr := http.NewRequest(req.Method, targetURL, bytes.NewReader(reqBodyBytes))
	if uerr != nil {
		recordEntry(targetURL, req.Method, reqHeaders, string(reqBodyBytes), 0, nil, "", time.Since(startTime), uerr.Error(), matched)
		return
	}
	for k, v := range reqHeaders {
		lk := strings.ToLower(k)
		if lk == "host" || lk == "connection" || lk == "proxy-connection" {
			continue
		}
		upstreamReq.Header.Set(k, v)
	}

	upClient := &http.Client{Timeout: 30 * time.Second}
	upstreamResp, uerr := upClient.Do(upstreamReq)
	if uerr != nil {
		recordEntry(targetURL, req.Method, reqHeaders, string(reqBodyBytes), 0, nil, "", time.Since(startTime), uerr.Error(), matched)
		return
	}
	defer upstreamResp.Body.Close()

	respBodyBytes, _ := io.ReadAll(io.LimitReader(upstreamResp.Body, 1024*1024))

	respHeaders := make(map[string]string)
	for k, vs := range upstreamResp.Header {
		respHeaders[k] = strings.Join(vs, ", ")
	}

	applyThrottleLatency()

	response := buildHTTPResponse(upstreamResp.StatusCode, respHeaders, respBodyBytes)
	tlsConn.Write(response)

	recordEntry(targetURL, req.Method, reqHeaders, string(reqBodyBytes), upstreamResp.StatusCode, respHeaders, string(respBodyBytes), time.Since(startTime), "", matched)
}

func buildHTTPResponse(status int, headers map[string]string, body []byte) []byte {
	var buf bytes.Buffer
	statusText := http.StatusText(status)
	if statusText == "" {
		statusText = "Unknown"
	}
	fmt.Fprintf(&buf, "HTTP/1.1 %d %s\r\n", status, statusText)
	for k, v := range headers {
		fmt.Fprintf(&buf, "%s: %s\r\n", k, v)
	}
	fmt.Fprintf(&buf, "Content-Length: %d\r\n", len(body))
	fmt.Fprintf(&buf, "\r\n")
	buf.Write(body)
	return buf.Bytes()
}
