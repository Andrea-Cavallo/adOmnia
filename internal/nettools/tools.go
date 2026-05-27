package nettools

import (
	"adomnia/internal/httputil"
	"encoding/json"
	"fmt"
	"net"
	"net/http"
	"strconv"
	"strings"
	"sync"
	"time"

	"github.com/miekg/dns"
)

func parseDNSAnswer(ans dns.RR) dnsRecord {
	rec := dnsRecord{TTL: int(ans.Header().Ttl)}
	switch rr := ans.(type) {
	case *dns.A:
		rec.Type = "A"
		rec.Value = rr.A.String()
	case *dns.AAAA:
		rec.Type = "AAAA"
		rec.Value = rr.AAAA.String()
	case *dns.CNAME:
		rec.Type = "CNAME"
		rec.Value = rr.Target
	case *dns.MX:
		rec.Type = "MX"
		rec.Value = rr.Mx
		rec.Priority = int(rr.Preference)
	case *dns.TXT:
		rec.Type = "TXT"
		rec.Value = strings.Join(rr.Txt, " ")
	case *dns.NS:
		rec.Type = "NS"
		rec.Value = rr.Ns
	case *dns.SOA:
		rec.Type = "SOA"
		rec.Value = rr.Ns
		rec.MName = rr.Ns
		rec.RName = rr.Mbox
		rec.Serial = rr.Serial
		rec.Refresh = int(rr.Refresh)
		rec.Retry = int(rr.Retry)
		rec.Expire = int(rr.Expire)
		rec.MinTTL = rr.Minttl
	case *dns.SRV:
		rec.Type = "SRV"
		rec.Value = fmt.Sprintf("%s:%d", rr.Target, rr.Port)
		rec.Priority = int(rr.Priority)
	case *dns.CAA:
		rec.Type = "CAA"
		rec.Value = fmt.Sprintf("%d %s %s", rr.Flag, rr.Tag, rr.Value)
	case *dns.PTR:
		rec.Type = "PTR"
		rec.Value = rr.Ptr
	case *dns.HINFO:
		rec.Type = "HINFO"
		rec.Value = fmt.Sprintf("%s %s", rr.Cpu, rr.Os)
	default:
		rec.Type = dns.TypeToString[rr.Header().Rrtype]
		rec.Value = rr.String()
	}
	return rec
}

// --- DNS Lookup ---

type dnsLookupRequest struct {
	Host   string `json:"host"`
	Type   string `json:"type"`
	Server string `json:"server"`
}

type dnsRecord struct {
	Type     string `json:"type"`
	Value    string `json:"value"`
	TTL      int    `json:"ttl"`
	Priority int    `json:"priority,omitempty"`
	MName    string `json:"mname,omitempty"`
	RName    string `json:"rname,omitempty"`
	Serial   uint32 `json:"serial,omitempty"`
	Refresh  int    `json:"refresh,omitempty"`
	Retry    int    `json:"retry,omitempty"`
	Expire   int    `json:"expire,omitempty"`
	MinTTL   uint32 `json:"minttl,omitempty"`
}

type dnsLookupResponse struct {
	Records []dnsRecord `json:"records"`
	TimeMs  int64       `json:"time_ms"`
}

func dnsLookupHandler(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		httputil.JSONError(w, "POST required", http.StatusMethodNotAllowed)
		return
	}

	var req dnsLookupRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		httputil.JSONError(w, "invalid json: "+err.Error(), http.StatusBadRequest)
		return
	}

	if req.Host == "" {
		httputil.JSONError(w, "host required", http.StatusBadRequest)
		return
	}
	if req.Type == "" {
		req.Type = "A"
	}

	// Use miekg/dns for proper DNS query with TTLs
	dnsType, ok := dns.StringToType[strings.ToUpper(req.Type)]
	if !ok {
		httputil.JSONError(w, "unsupported DNS type: "+req.Type, http.StatusBadRequest)
		return
	}

	dnsServer := req.Server
	if dnsServer == "" {
		// Use system default (Google DNS as fallback)
		cfg, _ := dns.ClientConfigFromFile("/etc/resolv.conf")
		if cfg != nil && len(cfg.Servers) > 0 {
			dnsServer = cfg.Servers[0] + ":53"
		} else {
			dnsServer = "8.8.8.8:53"
		}
	}
	if !strings.Contains(dnsServer, ":") {
		dnsServer = dnsServer + ":53"
	}

	m := new(dns.Msg)
	m.SetQuestion(dns.Fqdn(req.Host), uint16(dnsType))
	m.RecursionDesired = true

	client := &dns.Client{Timeout: 10 * time.Second}
	start := time.Now()

	resp, _, err := client.Exchange(m, dnsServer)
	if err != nil {
		httputil.JSONError(w, "dns lookup failed: "+err.Error(), http.StatusOK)
		return
	}

	records := make([]dnsRecord, 0, len(resp.Answer))
	for _, ans := range resp.Answer {
		records = append(records, parseDNSAnswer(ans))
	}

	elapsed := time.Since(start).Milliseconds()

	// If no answers, try the Authority section for SOA (NXDOMAIN)
	if len(records) == 0 && resp.Rcode == dns.RcodeNameError {
		for _, auth := range resp.Ns {
			if soa, ok := auth.(*dns.SOA); ok {
				records = append(records, dnsRecord{
					Type:    "SOA",
					Value:   soa.Ns,
					TTL:     int(soa.Header().Ttl),
					MName:   soa.Ns,
					RName:   soa.Mbox,
					Serial:  soa.Serial,
					Refresh: int(soa.Refresh),
					Retry:   int(soa.Retry),
					Expire:  int(soa.Expire),
					MinTTL:  soa.Minttl,
				})
			}
		}
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(dnsLookupResponse{
		Records: records,
		TimeMs:  elapsed,
	})

	// Cache the result for future lookups
	if len(records) > 0 && resp.Rcode == dns.RcodeSuccess {
		minTTL := 300
		for _, r := range records {
			if r.TTL > 0 && r.TTL < minTTL {
				minTTL = r.TTL
			}
		}
		cacheDNSResult(req.Host, records, minTTL)
	}
}

// DNS Timing — traces the full resolution chain with timing.
// POST /dns/trace
func dnsTraceHandler(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		httputil.JSONError(w, "POST required", http.StatusMethodNotAllowed)
		return
	}

	var req dnsLookupRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		httputil.JSONError(w, "invalid json: "+err.Error(), http.StatusBadRequest)
		return
	}
	if req.Host == "" {
		httputil.JSONError(w, "host required", http.StatusBadRequest)
		return
	}
	if req.Type == "" {
		req.Type = "A"
	}

	dnsServer := req.Server
	if dnsServer == "" {
		dnsServer = "8.8.8.8:53"
	}
	if !strings.Contains(dnsServer, ":") {
		dnsServer += ":53"
	}

	type traceStep struct {
		Server  string  `json:"server"`
		QueryMs float64 `json:"queryMs"`
		Result  string  `json:"result"`
		NS      string  `json:"ns,omitempty"`
	}

	trace := make([]traceStep, 0)
	var totalMs float64

	// Step 1: Root hints (use the configured DNS server directly)
	dnsType, ok := dns.StringToType[strings.ToUpper(req.Type)]
	if !ok {
		dnsType = dns.TypeA
	}

	m := new(dns.Msg)
	m.SetQuestion(dns.Fqdn(req.Host), uint16(dnsType))
	m.RecursionDesired = true

	client := &dns.Client{Timeout: 5 * time.Second}
	start := time.Now()
	resp, _, err := client.Exchange(m, dnsServer)
	elapsed := time.Since(start).Seconds() * 1000
	totalMs += elapsed

	if err != nil {
		trace = append(trace, traceStep{Server: dnsServer, QueryMs: elapsed, Result: "ERROR: " + err.Error()})
	} else if resp.Rcode == dns.RcodeSuccess && len(resp.Answer) > 0 {
		ans := resp.Answer[0]
		trace = append(trace, traceStep{Server: dnsServer, QueryMs: elapsed, Result: ans.String()})
	} else if len(resp.Ns) > 0 {
		// Got NS delegation
		for _, ns := range resp.Ns {
			if nsRR, ok := ns.(*dns.NS); ok {
				trace = append(trace, traceStep{Server: dnsServer, QueryMs: elapsed, Result: "DELEGATION", NS: nsRR.Ns})
			}
		}
	} else {
		trace = append(trace, traceStep{Server: dnsServer, QueryMs: elapsed, Result: dns.RcodeToString[resp.Rcode]})
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]interface{}{
		"host":    req.Host,
		"type":    req.Type,
		"trace":   trace,
		"totalMs": mathRound(totalMs, 2),
	})
}

func mathRound(v float64, decimals int) float64 {
	pow := 1.0
	for i := 0; i < decimals; i++ {
		pow *= 10
	}
	return float64(int(v*pow+0.5)) / pow
}

// DNS Compare — query multiple resolvers simultaneously
// POST /dns/compare
func dnsCompareHandler(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		httputil.JSONError(w, "POST required", http.StatusMethodNotAllowed)
		return
	}
	var req struct {
		Host    string   `json:"host"`
		Type    string   `json:"type"`
		Servers []string `json:"servers"`
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		httputil.JSONError(w, "invalid json", http.StatusBadRequest)
		return
	}
	if req.Host == "" {
		httputil.JSONError(w, "host required", http.StatusBadRequest)
		return
	}
	if len(req.Servers) == 0 {
		req.Servers = []string{"8.8.8.8:53", "1.1.1.1:53", "9.9.9.9:53"}
	}

	type resolverResult struct {
		Server  string      `json:"server"`
		TimeMs  int64       `json:"timeMs"`
		Records []dnsRecord `json:"records"`
		Error   string      `json:"error,omitempty"`
	}

	results := make([]resolverResult, len(req.Servers))
	var wg sync.WaitGroup

	for i, server := range req.Servers {
		wg.Add(1)
		go func(idx int, srv string) {
			defer wg.Done()
			if !strings.Contains(srv, ":") {
				srv += ":53"
			}
			rr := resolverResult{Server: srv}

			dnsType, ok := dns.StringToType[strings.ToUpper(req.Type)]
			if !ok {
				dnsType = dns.TypeA
			}
			m := new(dns.Msg)
			m.SetQuestion(dns.Fqdn(req.Host), uint16(dnsType))
			m.RecursionDesired = true

			client := &dns.Client{Timeout: 5 * time.Second}
			start := time.Now()
			resp, _, err := client.Exchange(m, srv)
			rr.TimeMs = time.Since(start).Milliseconds()

			if err != nil {
				rr.Error = err.Error()
			} else {
				for _, ans := range resp.Answer {
					rr.Records = append(rr.Records, parseDNSAnswer(ans))
				}
			}
			results[idx] = rr
		}(i, server)
	}
	wg.Wait()

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]interface{}{
		"host":    req.Host,
		"type":    req.Type,
		"results": results,
	})
}

// DNS Cache — store/retrieve cached DNS lookups in bbolt
var dnsCacheMu sync.RWMutex
var dnsCache = make(map[string]cachedDNS)

type cachedDNS struct {
	Records  []dnsRecord `json:"records"`
	CachedAt time.Time   `json:"cachedAt"`
	TTL      int         `json:"ttl"`
}

func dnsCacheGetHandler(w http.ResponseWriter, r *http.Request) {
	host := r.URL.Query().Get("host")
	if host == "" {
		httputil.JSONError(w, "host required", http.StatusBadRequest)
		return
	}
	dnsCacheMu.RLock()
	entry, ok := dnsCache[strings.ToLower(host)]
	dnsCacheMu.RUnlock()

	if !ok || time.Since(entry.CachedAt).Seconds() > float64(entry.TTL) {
		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(map[string]interface{}{"cached": false})
		return
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]interface{}{
		"cached":   true,
		"host":     host,
		"records":  entry.Records,
		"cachedAt": entry.CachedAt.Format(time.RFC3339),
		"age":      time.Since(entry.CachedAt).String(),
	})
}

func dnsCacheClearHandler(w http.ResponseWriter, r *http.Request) {
	dnsCacheMu.Lock()
	dnsCache = make(map[string]cachedDNS)
	dnsCacheMu.Unlock()

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]interface{}{"ok": true})
}

// In the dnsLookupHandler, cache results
func cacheDNSResult(host string, records []dnsRecord, ttl int) {
	dnsCacheMu.Lock()
	dnsCache[strings.ToLower(host)] = cachedDNS{
		Records:  records,
		CachedAt: time.Now(),
		TTL:      ttl,
	}
	dnsCacheMu.Unlock()
}

// --- Port Scanner ---

type portScanRequest struct {
	Host      string `json:"host"`
	Ports     string `json:"ports"`
	TimeoutMs int    `json:"timeout_ms"`
}

type portResult struct {
	Port    int    `json:"port"`
	Open    bool   `json:"open"`
	Service string `json:"service"`
}

type portScanResponse struct {
	Results      []portResult `json:"results"`
	TimeMs       int64        `json:"time_ms"`
	WarnInternal bool         `json:"warn_internal,omitempty"`
}

var commonPorts = []int{
	21, 22, 23, 25, 53, 80, 110, 143, 443, 445,
	993, 995, 3306, 3389, 5432, 6379, 8080, 8443, 9090, 27017,
}

var wellKnownServices = map[int]string{
	21:    "FTP",
	22:    "SSH",
	23:    "Telnet",
	25:    "SMTP",
	53:    "DNS",
	80:    "HTTP",
	110:   "POP3",
	143:   "IMAP",
	443:   "HTTPS",
	445:   "SMB",
	993:   "IMAPS",
	995:   "POP3S",
	3306:  "MySQL",
	3389:  "RDP",
	5432:  "PostgreSQL",
	6379:  "Redis",
	8080:  "HTTP-Alt",
	8443:  "HTTPS-Alt",
	9090:  "Prometheus",
	27017: "MongoDB",
	5672:  "AMQP",
	6443:  "Kubernetes",
	8888:  "HTTP-Alt",
	9200:  "Elasticsearch",
	9092:  "Kafka",
	11211: "Memcached",
	2181:  "ZooKeeper",
	4369:  "EPMD",
	5000:  "Docker-Registry",
	8081:  "HTTP-Alt",
}

func parsePorts(spec string) ([]int, error) {
	spec = strings.TrimSpace(spec)
	if spec == "" || strings.ToLower(spec) == "common" {
		return commonPorts, nil
	}

	ports := make([]int, 0)
	parts := strings.Split(spec, ",")
	for _, part := range parts {
		part = strings.TrimSpace(part)
		if part == "" {
			continue
		}
		if strings.Contains(part, "-") {
			bounds := strings.SplitN(part, "-", 2)
			low, err := strconv.Atoi(strings.TrimSpace(bounds[0]))
			if err != nil {
				return nil, fmt.Errorf("invalid port range: %s", part)
			}
			high, err := strconv.Atoi(strings.TrimSpace(bounds[1]))
			if err != nil {
				return nil, fmt.Errorf("invalid port range: %s", part)
			}
			if low < 1 || high > 65535 || low > high {
				return nil, fmt.Errorf("invalid port range: %s", part)
			}
			if high-low > 1000 {
				return nil, fmt.Errorf("port range too large (max 1000): %s", part)
			}
			for p := low; p <= high; p++ {
				ports = append(ports, p)
			}
		} else {
			p, err := strconv.Atoi(part)
			if err != nil {
				return nil, fmt.Errorf("invalid port: %s", part)
			}
			if p < 1 || p > 65535 {
				return nil, fmt.Errorf("port out of range: %d", p)
			}
			ports = append(ports, p)
		}
	}

	if len(ports) == 0 {
		return nil, fmt.Errorf("no valid ports specified")
	}
	return ports, nil
}

func portScanHandler(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		httputil.JSONError(w, "POST required", http.StatusMethodNotAllowed)
		return
	}

	var req portScanRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		httputil.JSONError(w, "invalid json: "+err.Error(), http.StatusBadRequest)
		return
	}

	if req.Host == "" {
		httputil.JSONError(w, "host required", http.StatusBadRequest)
		return
	}
	warnInternal := false
	if parsedIP := net.ParseIP(req.Host); parsedIP != nil && (parsedIP.IsLoopback() || parsedIP.IsLinkLocalUnicast() || parsedIP.IsPrivate()) {
		warnInternal = true
	}
	if req.TimeoutMs < 100 {
		req.TimeoutMs = 2000
	}
	if req.TimeoutMs > 30000 {
		req.TimeoutMs = 30000
	}

	ports, err := parsePorts(req.Ports)
	if err != nil {
		httputil.JSONError(w, err.Error(), http.StatusBadRequest)
		return
	}

	timeout := time.Duration(req.TimeoutMs) * time.Millisecond
	maxConcurrent := 50
	sem := make(chan struct{}, maxConcurrent)

	results := make([]portResult, len(ports))
	var wg sync.WaitGroup

	start := time.Now()

	for i, port := range ports {
		wg.Add(1)
		sem <- struct{}{}
		go func(idx, p int) {
			defer wg.Done()
			defer func() { <-sem }()

			address := net.JoinHostPort(req.Host, strconv.Itoa(p))
			conn, err := net.DialTimeout("tcp", address, timeout)

			open := false
			if err == nil {
				open = true
				conn.Close()
			}

			service := wellKnownServices[p]

			results[idx] = portResult{
				Port:    p,
				Open:    open,
				Service: service,
			}
		}(i, port)
	}

	wg.Wait()
	elapsed := time.Since(start).Milliseconds()

	resp := portScanResponse{
		Results:      results,
		TimeMs:       elapsed,
		WarnInternal: warnInternal,
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(resp)
}

// --- CORS Tester ---

type corsTestRequest struct {
	URL    string `json:"url"`
	Origin string `json:"origin"`
	Method string `json:"method"`
}

type corsHeaders struct {
	Status  int               `json:"status"`
	Headers map[string]string `json:"headers"`
}

type corsTestResponse struct {
	Preflight *corsHeaders `json:"preflight"`
	Actual    *corsHeaders `json:"actual"`
	Allowed   bool         `json:"allowed"`
	Issues    []string     `json:"issues"`
}

func corsTestHandler(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		httputil.JSONError(w, "POST required", http.StatusMethodNotAllowed)
		return
	}

	var req corsTestRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		httputil.JSONError(w, "invalid json: "+err.Error(), http.StatusBadRequest)
		return
	}

	if req.URL == "" {
		httputil.JSONError(w, "url required", http.StatusBadRequest)
		return
	}
	if req.Origin == "" {
		httputil.JSONError(w, "origin required", http.StatusBadRequest)
		return
	}
	if req.Method == "" {
		req.Method = "GET"
	}

	client := &http.Client{
		Timeout: 10 * time.Second,
		CheckRedirect: func(req *http.Request, via []*http.Request) error {
			return http.ErrUseLastResponse
		},
	}

	issues := make([]string, 0)
	allowed := true

	// Preflight request (OPTIONS)
	var preflight *corsHeaders
	preflightReq, err := http.NewRequest(http.MethodOptions, req.URL, nil)
	if err != nil {
		httputil.JSONError(w, "invalid url: "+err.Error(), http.StatusBadRequest)
		return
	}
	preflightReq.Header.Set("Origin", req.Origin)
	preflightReq.Header.Set("Access-Control-Request-Method", strings.ToUpper(req.Method))
	preflightReq.Header.Set("Access-Control-Request-Headers", "content-type")

	preflightResp, err := client.Do(preflightReq)
	if err != nil {
		issues = append(issues, "Preflight request failed: "+err.Error())
		allowed = false
	} else {
		defer preflightResp.Body.Close()
		corsHdrs := extractCORSHeaders(preflightResp.Header)
		preflight = &corsHeaders{
			Status:  preflightResp.StatusCode,
			Headers: corsHdrs,
		}

		// Check preflight issues
		acao := preflightResp.Header.Get("Access-Control-Allow-Origin")
		if acao == "" {
			issues = append(issues, "No Access-Control-Allow-Origin header in preflight response")
			allowed = false
		} else if acao != "*" && acao != req.Origin {
			issues = append(issues, fmt.Sprintf("Origin not allowed: got '%s', expected '%s' or '*'", acao, req.Origin))
			allowed = false
		}

		acam := preflightResp.Header.Get("Access-Control-Allow-Methods")
		if acam != "" {
			methodAllowed := false
			for _, m := range strings.Split(acam, ",") {
				if strings.TrimSpace(strings.ToUpper(m)) == strings.ToUpper(req.Method) {
					methodAllowed = true
					break
				}
			}
			if !methodAllowed && acam != "*" {
				issues = append(issues, fmt.Sprintf("Method not allowed: '%s' not in '%s'", req.Method, acam))
				allowed = false
			}
		}

		acah := preflightResp.Header.Get("Access-Control-Allow-Headers")
		if acah == "" && preflightResp.StatusCode != http.StatusNoContent {
			// Some servers only respond to actual allowed headers
		} else if acah != "" && acah != "*" {
			headerAllowed := false
			for _, h := range strings.Split(acah, ",") {
				if strings.TrimSpace(strings.ToLower(h)) == "content-type" {
					headerAllowed = true
					break
				}
			}
			if !headerAllowed {
				issues = append(issues, "Header 'content-type' not in Access-Control-Allow-Headers")
				allowed = false
			}
		}
	}

	// Actual request (GET)
	var actual *corsHeaders
	actualReq, err := http.NewRequest(http.MethodGet, req.URL, nil)
	if err == nil {
		actualReq.Header.Set("Origin", req.Origin)
		actualResp, err := client.Do(actualReq)
		if err != nil {
			issues = append(issues, "Actual request failed: "+err.Error())
			allowed = false
		} else {
			defer actualResp.Body.Close()
			corsHdrs := extractCORSHeaders(actualResp.Header)
			actual = &corsHeaders{
				Status:  actualResp.StatusCode,
				Headers: corsHdrs,
			}

			acao := actualResp.Header.Get("Access-Control-Allow-Origin")
			if acao == "" {
				issues = append(issues, "No Access-Control-Allow-Origin header in actual response")
				allowed = false
			} else if acao != "*" && acao != req.Origin {
				issues = append(issues, fmt.Sprintf("Origin not allowed in actual response: got '%s'", acao))
				allowed = false
			}
		}
	}

	resp := corsTestResponse{
		Preflight: preflight,
		Actual:    actual,
		Allowed:   allowed,
		Issues:    issues,
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(resp)
}

// RegisterHandlers registers network, certificate and folder comparison endpoints.
func RegisterHandlers(mux *http.ServeMux) {
	mux.HandleFunc("/dns/lookup", dnsLookupHandler)
	mux.HandleFunc("/dns/trace", dnsTraceHandler)
	mux.HandleFunc("/dns/compare", dnsCompareHandler)
	mux.HandleFunc("/dns/cache", dnsCacheGetHandler)
	mux.HandleFunc("/dns/cache/clear", dnsCacheClearHandler)
	mux.HandleFunc("/portscan", portScanHandler)
	mux.HandleFunc("/cors", corsTestHandler)
	mux.HandleFunc("/cert/jks-split", certJksSplitHandler)
	mux.HandleFunc("/cert/inspect", certInspectHandler)
	mux.HandleFunc("/folderdiff/scan", folderDiffHandler)
	mux.HandleFunc("/folderdiff/file", folderDiffFileHandler)
}

func extractCORSHeaders(h http.Header) map[string]string {
	corsKeys := []string{
		"Access-Control-Allow-Origin",
		"Access-Control-Allow-Methods",
		"Access-Control-Allow-Headers",
		"Access-Control-Allow-Credentials",
		"Access-Control-Expose-Headers",
		"Access-Control-Max-Age",
		"Vary",
	}
	result := make(map[string]string)
	for _, key := range corsKeys {
		val := h.Get(key)
		if val != "" {
			result[key] = val
		}
	}
	return result
}
