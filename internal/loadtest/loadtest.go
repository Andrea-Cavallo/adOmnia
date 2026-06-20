package loadtest

import (
	"adomnia/internal/devlog"
	"bytes"
	"encoding/json"
	"fmt"
	"io"
	"math"
	"net/http"
	"strings"
	"sync"
	"time"

	hdr "github.com/HdrHistogram/hdrhistogram-go"
)

type loadTestRequest struct {
	URL         string            `json:"url"`
	Method      string            `json:"method"`
	Headers     map[string]string `json:"headers"`
	Body        string            `json:"body"`
	Concurrency int               `json:"concurrency"`
	TotalReqs   int               `json:"totalReqs"`
	RampUpMs    int               `json:"rampUpMs"`
	TimeoutMs   int               `json:"timeoutMs"`
	WarmupReqs  int               `json:"warmupReqs"`
	CooldownMs  int               `json:"cooldownMs"`
	QpsTarget   float64           `json:"qpsTarget"`
	DurationS   int               `json:"durationS"` // if > 0, run for duration instead of TotalReqs
}

type loadTestResult struct {
	TotalRequests      int                `json:"totalRequests"`
	Successful         int                `json:"successful"`
	Failed             int                `json:"failed"`
	TotalTimeMs        float64            `json:"totalTimeMs"`
	AvgMs              float64            `json:"avgMs"`
	MinMs              float64            `json:"minMs"`
	MaxMs              float64            `json:"maxMs"`
	P50Ms              float64            `json:"p50Ms"`
	P75Ms              float64            `json:"p75Ms"`
	P90Ms              float64            `json:"p90Ms"`
	P95Ms              float64            `json:"p95Ms"`
	P99Ms              float64            `json:"p99Ms"`
	P999Ms             float64            `json:"p999Ms"`
	Throughput         float64            `json:"throughput"`
	ErrorRate          float64            `json:"errorRate"`
	StatusCodes        map[int]int        `json:"statusCodes"`
	Timeline           []timelinePoint    `json:"timeline"`
	WarmupSkipped      int                `json:"warmupSkipped,omitempty"`
	CooldownMs         int                `json:"cooldownMs,omitempty"`
	ThroughputTimeline []throughputBucket `json:"throughputTimeline,omitempty"`
}

type throughputBucket struct {
	Second int     `json:"second"`
	Reqs   int     `json:"reqs"`
	AvgMs  float64 `json:"avgMs"`
}

type timelinePoint struct {
	TimeMs    float64 `json:"timeMs"`
	LatencyMs float64 `json:"latencyMs"`
	Status    int     `json:"status"`
	Ok        bool    `json:"ok"`
}

var loadTestRunning bool
var loadTestMu sync.Mutex

var (
	putValue     func(string, string, []byte) error
	getValue     func(string, string) ([]byte, error)
	listValues   func(string, string) ([]string, error)
	deleteValue  func(string, string) error
	sidecarPort  int
	sidecarToken string
)

// Configure supplies persistence functions and the local gRPC gateway port.
func Configure(
	put func(string, string, []byte) error,
	get func(string, string) ([]byte, error),
	list func(string, string) ([]string, error),
	deleteFn func(string, string) error,
	port int,
	token string,
) {
	putValue = put
	getValue = get
	listValues = list
	deleteValue = deleteFn
	sidecarPort = port
	sidecarToken = token
}

func loadTestHandler(w http.ResponseWriter, r *http.Request) {
	devlog.Log("loadTestHandler", "richiesta load test ricevuta", map[string]any{"method": r.Method, "remote": r.RemoteAddr})
	loadTestMu.Lock()
	if loadTestRunning {
		loadTestMu.Unlock()
		devlog.Log("loadTestHandler", "load test già in esecuzione, richiesta rifiutata", nil)
		http.Error(w, "a load test is already running", http.StatusTooManyRequests)
		return
	}
	loadTestRunning = true
	loadTestMu.Unlock()
	defer func() { loadTestMu.Lock(); loadTestRunning = false; loadTestMu.Unlock() }()
	if r.Method != http.MethodPost {
		http.Error(w, "POST required", http.StatusMethodNotAllowed)
		return
	}

	var req loadTestRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		devlog.Err("loadTestHandler", "decode JSON payload fallito", err, nil)
		http.Error(w, "invalid json: "+err.Error(), http.StatusBadRequest)
		return
	}
	devlog.Log("loadTestHandler", "parametri load test decodificati", map[string]any{
		"url":         req.URL,
		"method":      req.Method,
		"concurrency": req.Concurrency,
		"totalReqs":   req.TotalReqs,
		"durationS":   req.DurationS,
		"timeoutMs":   req.TimeoutMs,
		"warmupReqs":  req.WarmupReqs,
	})

	if req.URL == "" {
		http.Error(w, "url required", http.StatusBadRequest)
		return
	}
	if req.Concurrency < 1 {
		req.Concurrency = 1
	}
	if req.Concurrency > 200 {
		req.Concurrency = 200
	}
	if req.DurationS > 0 {
		req.TotalReqs = req.DurationS * req.Concurrency * 2 // approximate: max 2x concurrency per second
	}
	if req.TotalReqs < 1 {
		req.TotalReqs = 10
	}
	if req.TotalReqs > 50000 {
		req.TotalReqs = 50000
	}
	if req.TimeoutMs < 100 {
		req.TimeoutMs = 10000
	}
	if req.Method == "" {
		req.Method = "GET"
	}
	if req.WarmupReqs < 0 {
		req.WarmupReqs = 0
	}

	timeout := time.Duration(req.TimeoutMs) * time.Millisecond
	client := &http.Client{Timeout: timeout}

	// HDR Histogram: tracks latency from 1ms to 60s with 3 significant digits
	hist := hdr.New(1, 60000, 3)

	var mu sync.Mutex
	timeline := make([]timelinePoint, 0, req.TotalReqs)
	statusCodes := make(map[int]int)
	successful := 0
	failed := 0
	warmupSkipped := 0

	start := time.Now()
	sem := make(chan struct{}, req.Concurrency)

	// QPS rate limiter
	var qpsLimiter *time.Ticker
	if req.QpsTarget > 0 {
		interval := time.Duration(float64(time.Second) / req.QpsTarget)
		qpsLimiter = time.NewTicker(interval)
		defer qpsLimiter.Stop()
	}

	var wg sync.WaitGroup

	rampDelay := time.Duration(0)
	if req.RampUpMs > 0 && req.TotalReqs > 1 {
		rampDelay = time.Duration(req.RampUpMs) * time.Millisecond / time.Duration(req.TotalReqs-1)
	}

	// Duration-based mode: stop after DurationS
	done := make(chan struct{})
	if req.DurationS > 0 {
		go func() {
			time.Sleep(time.Duration(req.DurationS) * time.Second)
			close(done)
		}()
	} else {
		close(done)
	}

	for i := 0; i < req.TotalReqs; i++ {
		select {
		case <-done:
			break // duration elapsed
		default:
		}

		if rampDelay > 0 && i > 0 {
			time.Sleep(rampDelay)
		}

		// QPS rate limiting
		if qpsLimiter != nil {
			<-qpsLimiter.C
		}

		wg.Add(1)
		sem <- struct{}{}
		go func(idx int) {
			defer wg.Done()
			defer func() { <-sem }()

			var bodyReader io.Reader
			if req.Body != "" {
				bodyReader = strings.NewReader(req.Body)
			}

			httpReq, err := http.NewRequest(strings.ToUpper(req.Method), req.URL, bodyReader)
			if err != nil {
				mu.Lock()
				failed++
				timeline = append(timeline, timelinePoint{
					TimeMs: float64(time.Since(start).Milliseconds()),
					Ok:     false,
				})
				mu.Unlock()
				return
			}

			for k, v := range req.Headers {
				httpReq.Header.Set(k, v)
			}

			reqStart := time.Now()
			resp, err := client.Do(httpReq)
			latencyMs := float64(time.Since(reqStart).Microseconds()) / 1000.0
			elapsed := float64(time.Since(start).Microseconds()) / 1000.0

			mu.Lock()
			// Warmup: skip recording latency
			if idx < req.WarmupReqs {
				warmupSkipped++
				if err == nil {
					io.Copy(io.Discard, resp.Body)
					resp.Body.Close()
				}
				mu.Unlock()
				return
			}

			hist.RecordValue(int64(latencyMs))

			if err != nil {
				failed++
				timeline = append(timeline, timelinePoint{
					TimeMs:    elapsed,
					LatencyMs: latencyMs,
					Ok:        false,
				})
			} else {
				io.Copy(io.Discard, resp.Body)
				resp.Body.Close()
				status := resp.StatusCode
				statusCodes[status]++
				if status >= 200 && status < 400 {
					successful++
				} else {
					failed++
				}
				timeline = append(timeline, timelinePoint{
					TimeMs:    elapsed,
					LatencyMs: latencyMs,
					Status:    status,
					Ok:        status >= 200 && status < 400,
				})
			}
			mu.Unlock()
		}(i)
	}

	wg.Wait()

	// Cooldown phase
	if req.CooldownMs > 0 {
		time.Sleep(time.Duration(req.CooldownMs) * time.Millisecond)
	}

	totalTime := float64(time.Since(start).Microseconds()) / 1000.0
	measured := successful + failed

	// Throughput timeline: requests per second bucket
	throughputMap := make(map[int]struct {
		count   int
		totalMs float64
	})
	for _, t := range timeline {
		sec := int(t.TimeMs / 1000)
		b := throughputMap[sec]
		b.count++
		b.totalMs += t.LatencyMs
		throughputMap[sec] = b
	}
	throughputTimeline := make([]throughputBucket, 0)
	for sec := 0; sec <= int(totalTime/1000); sec++ {
		if b, ok := throughputMap[sec]; ok {
			throughputTimeline = append(throughputTimeline, throughputBucket{
				Second: sec,
				Reqs:   b.count,
				AvgMs:  math.Round(b.totalMs/float64(b.count)*100) / 100,
			})
		}
	}

	result := loadTestResult{
		TotalRequests:      req.TotalReqs,
		Successful:         successful,
		Failed:             failed,
		TotalTimeMs:        math.Round(totalTime*100) / 100,
		StatusCodes:        statusCodes,
		Timeline:           timeline,
		WarmupSkipped:      warmupSkipped,
		CooldownMs:         req.CooldownMs,
		ThroughputTimeline: throughputTimeline,
	}

	if measured > 0 {
		result.AvgMs = math.Round(hist.Mean()*100) / 100
		result.MinMs = float64(hist.Min())
		result.MaxMs = float64(hist.Max())
		result.P50Ms = float64(hist.ValueAtQuantile(50))
		result.P75Ms = float64(hist.ValueAtQuantile(75))
		result.P90Ms = float64(hist.ValueAtQuantile(90))
		result.P95Ms = float64(hist.ValueAtQuantile(95))
		result.P99Ms = float64(hist.ValueAtQuantile(99))
		result.P999Ms = float64(hist.ValueAtQuantile(99.9))
	}

	if totalTime > 0 {
		result.Throughput = math.Round(float64(measured)/(totalTime/1000)*100) / 100
	}
	if measured > 0 {
		result.ErrorRate = math.Round(float64(failed)/float64(measured)*10000) / 100
	}

	devlog.Info("loadTestHandler", "load test completato", map[string]any{
		"totalRequests": result.TotalRequests,
		"successful":    result.Successful,
		"failed":        result.Failed,
		"avgMs":         result.AvgMs,
		"p99Ms":         result.P99Ms,
		"throughput":    result.Throughput,
		"errorRate":     result.ErrorRate,
	})
	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(result)
}

// loadTestReportHandler generates an exportable report in JSON, HTML, or Markdown.
// GET /loadtest/report?format=html|md|json
func loadTestReportHandler(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		http.Error(w, "POST required", http.StatusMethodNotAllowed)
		return
	}

	var result loadTestResult
	if err := json.NewDecoder(r.Body).Decode(&result); err != nil {
		http.Error(w, "invalid result json: "+err.Error(), http.StatusBadRequest)
		return
	}

	format := r.URL.Query().Get("format")
	if format == "" {
		format = "json"
	}

	switch format {
	case "html":
		w.Header().Set("Content-Type", "text/html; charset=utf-8")
		w.Write([]byte(loadTestReportHTML(&result)))
	case "md", "markdown":
		w.Header().Set("Content-Type", "text/markdown; charset=utf-8")
		w.Write([]byte(loadTestReportMarkdown(&result)))
	default:
		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(result)
	}
}

func loadTestReportMarkdown(r *loadTestResult) string {
	var b strings.Builder
	b.WriteString("# Load Test Report\n\n")
	b.WriteString(fmt.Sprintf("**URL:** %s\n\n", ""))
	b.WriteString(fmt.Sprintf("| Metric | Value |\n|---|---|\n"))
	b.WriteString(fmt.Sprintf("| Total Requests | %d |\n", r.TotalRequests))
	b.WriteString(fmt.Sprintf("| Successful | %d |\n", r.Successful))
	b.WriteString(fmt.Sprintf("| Failed | %d |\n", r.Failed))
	b.WriteString(fmt.Sprintf("| Error Rate | %.1f%% |\n", r.ErrorRate))
	b.WriteString(fmt.Sprintf("| Total Time | %.0fms |\n", r.TotalTimeMs))
	b.WriteString(fmt.Sprintf("| Throughput | %.1f req/s |\n", r.Throughput))
	b.WriteString(fmt.Sprintf("| Avg Latency | %.1fms |\n", r.AvgMs))
	b.WriteString(fmt.Sprintf("| Min | %.1fms |\n", r.MinMs))
	b.WriteString(fmt.Sprintf("| Max | %.1fms |\n", r.MaxMs))
	b.WriteString(fmt.Sprintf("| P50 | %.1fms |\n", r.P50Ms))
	b.WriteString(fmt.Sprintf("| P95 | %.1fms |\n", r.P95Ms))
	b.WriteString(fmt.Sprintf("| P99 | %.1fms |\n", r.P99Ms))
	if r.WarmupSkipped > 0 {
		b.WriteString(fmt.Sprintf("| Warmup Skipped | %d |\n", r.WarmupSkipped))
	}
	if len(r.StatusCodes) > 0 {
		b.WriteString("\n## Status Codes\n\n")
		b.WriteString("| Code | Count |\n|---|---|\n")
		for code, count := range r.StatusCodes {
			b.WriteString(fmt.Sprintf("| %d | %d |\n", code, count))
		}
	}
	b.WriteString("\n---\n*Generated by adOmnia*\n")
	return b.String()
}

func loadTestReportHTML(r *loadTestResult) string {
	rows := ""
	for code, count := range r.StatusCodes {
		rows += fmt.Sprintf("<tr><td>%d</td><td>%d</td></tr>", code, count)
	}
	return fmt.Sprintf(`<!doctype html><html><head><meta charset="utf-8"><title>Load Test Report</title>
<style>body{font-family:system-ui,sans-serif;background:#05070D;color:#F5F7FA;padding:32px;max-width:800px;margin:auto}
h1{color:#7C3AED}.metric{display:flex;justify-content:space-between;padding:8px 0;border-bottom:1px solid #131722}
.m-label{color:#8B949E}.m-value{font-weight:700;font-family:monospace}table{width:100%%;border-collapse:collapse;margin-top:16px}
th,td{border:1px solid #1F2333;padding:8px;text-align:left}th{background:#0E101A}</style></head><body>
<h1>Load Test Report</h1>
<div class="metric"><span class="m-label">Total Requests</span><span class="m-value">%d</span></div>
<div class="metric"><span class="m-label">Successful</span><span class="m-value">%d</span></div>
<div class="metric"><span class="m-label">Failed</span><span class="m-value">%d</span></div>
<div class="metric"><span class="m-label">Error Rate</span><span class="m-value">%.1f%%</span></div>
<div class="metric"><span class="m-label">Throughput</span><span class="m-value">%.1f req/s</span></div>
<div class="metric"><span class="m-label">Avg/P50/P95/P99</span><span class="m-value">%.1f / %.1f / %.1f / %.1f ms</span></div>
<h2>Status Codes</h2><table><tr><th>Code</th><th>Count</th></tr>%s</table>
<p style="color:#4B5563;margin-top:32px">Generated by adOmnia</p></body></html>`,
		r.TotalRequests, r.Successful, r.Failed, r.ErrorRate, r.Throughput,
		r.AvgMs, r.P50Ms, r.P95Ms, r.P99Ms, rows)
}

// Scenario save/load
func loadTestScenarioSaveHandler(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		http.Error(w, "POST required", http.StatusMethodNotAllowed)
		return
	}
	var req struct {
		Name   string          `json:"name"`
		Config loadTestRequest `json:"config"`
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		http.Error(w, "invalid json", http.StatusBadRequest)
		return
	}
	if req.Name == "" {
		http.Error(w, "name required", http.StatusBadRequest)
		return
	}
	data, _ := json.Marshal(req.Config)
	_ = putValue("workspace", "scenario/"+req.Name, data)

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]interface{}{"ok": true, "name": req.Name})
}

func loadTestScenarioListHandler(w http.ResponseWriter, r *http.Request) {
	keys, _ := listValues("workspace", "scenario/")
	scenarios := make([]string, 0, len(keys))
	for _, k := range keys {
		scenarios = append(scenarios, strings.TrimPrefix(k, "scenario/"))
	}
	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]interface{}{"scenarios": scenarios, "count": len(scenarios)})
}

func loadTestScenarioLoadHandler(w http.ResponseWriter, r *http.Request) {
	name := r.URL.Query().Get("name")
	if name == "" {
		http.Error(w, "name required", http.StatusBadRequest)
		return
	}
	data, err := getValue("workspace", "scenario/"+name)
	if err != nil || data == nil {
		http.Error(w, "scenario not found", http.StatusNotFound)
		return
	}
	w.Header().Set("Content-Type", "application/json")
	w.Write(data)
}

// Compare two load test results
func loadTestCompareHandler(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		http.Error(w, "POST required", http.StatusMethodNotAllowed)
		return
	}
	var req struct {
		Left  loadTestResult `json:"left"`
		Right loadTestResult `json:"right"`
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		http.Error(w, "invalid json", http.StatusBadRequest)
		return
	}
	a, b := &req.Left, &req.Right

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]interface{}{
		"left":  map[string]interface{}{"throughput": a.Throughput, "avgMs": a.AvgMs, "p95Ms": a.P95Ms, "errRate": a.ErrorRate, "total": a.TotalRequests},
		"right": map[string]interface{}{"throughput": b.Throughput, "avgMs": b.AvgMs, "p95Ms": b.P95Ms, "errRate": b.ErrorRate, "total": b.TotalRequests},
		"delta": map[string]interface{}{
			"throughput": deltaPct(a.Throughput, b.Throughput),
			"avgMs":      deltaPct(a.AvgMs, b.AvgMs),
			"p95Ms":      deltaPct(a.P95Ms, b.P95Ms),
			"errRate":    b.ErrorRate - a.ErrorRate,
		},
	})
}

func deltaPct(a, b float64) float64 {
	if a == 0 {
		return 0
	}
	return math.Round((b-a)/a*10000) / 100
}

// ─── Persisted Load Test Results ─────────────────────────────────────────────

const ltResultBucket = "workspace"
const ltResultPrefix = "ltresult/"

type savedLoadTestResult struct {
	Name      string         `json:"name"`
	Timestamp string         `json:"timestamp"`
	URL       string         `json:"url"`
	Method    string         `json:"method"`
	Result    loadTestResult `json:"result"`
}

// POST /loadtest/result/save
// Body: { name, url, method, result }
func loadTestResultSaveHandler(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		http.Error(w, "POST required", http.StatusMethodNotAllowed)
		return
	}
	var req struct {
		Name   string         `json:"name"`
		URL    string         `json:"url"`
		Method string         `json:"method"`
		Result loadTestResult `json:"result"`
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		http.Error(w, "invalid json", http.StatusBadRequest)
		return
	}
	if req.Name == "" {
		http.Error(w, "name required", http.StatusBadRequest)
		return
	}
	saved := savedLoadTestResult{
		Name:      req.Name,
		Timestamp: time.Now().UTC().Format(time.RFC3339),
		URL:       req.URL,
		Method:    req.Method,
		Result:    req.Result,
	}
	data, err := json.Marshal(saved)
	if err != nil {
		http.Error(w, "marshal error", http.StatusInternalServerError)
		return
	}
	_ = putValue(ltResultBucket, ltResultPrefix+req.Name, data)
	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]interface{}{"ok": true, "name": req.Name, "timestamp": saved.Timestamp})
}

// GET /loadtest/result/list
func loadTestResultListHandler(w http.ResponseWriter, r *http.Request) {
	keys, _ := listValues(ltResultBucket, ltResultPrefix)
	type resultSummary struct {
		Name      string  `json:"name"`
		Timestamp string  `json:"timestamp"`
		URL       string  `json:"url"`
		Method    string  `json:"method"`
		AvgMs     float64 `json:"avgMs"`
		P95Ms     float64 `json:"p95Ms"`
		ErrorRate float64 `json:"errorRate"`
		Total     int     `json:"total"`
	}
	summaries := make([]resultSummary, 0, len(keys))
	for _, k := range keys {
		data, err := getValue(ltResultBucket, k)
		if err != nil || data == nil {
			continue
		}
		var saved savedLoadTestResult
		if err := json.Unmarshal(data, &saved); err != nil {
			continue
		}
		summaries = append(summaries, resultSummary{
			Name:      saved.Name,
			Timestamp: saved.Timestamp,
			URL:       saved.URL,
			Method:    saved.Method,
			AvgMs:     saved.Result.AvgMs,
			P95Ms:     saved.Result.P95Ms,
			ErrorRate: saved.Result.ErrorRate,
			Total:     saved.Result.TotalRequests,
		})
	}
	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]interface{}{"results": summaries, "count": len(summaries)})
}

// GET /loadtest/result/load?name=xxx
func loadTestResultLoadHandler(w http.ResponseWriter, r *http.Request) {
	name := r.URL.Query().Get("name")
	if name == "" {
		http.Error(w, "name required", http.StatusBadRequest)
		return
	}
	data, err := getValue(ltResultBucket, ltResultPrefix+name)
	if err != nil || data == nil {
		http.Error(w, "result not found", http.StatusNotFound)
		return
	}
	w.Header().Set("Content-Type", "application/json")
	w.Write(data)
}

// DELETE /loadtest/result/delete?name=xxx
func loadTestResultDeleteHandler(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodDelete && r.Method != http.MethodPost {
		http.Error(w, "DELETE or POST required", http.StatusMethodNotAllowed)
		return
	}
	name := r.URL.Query().Get("name")
	if name == "" {
		http.Error(w, "name required", http.StatusBadRequest)
		return
	}
	_ = deleteValue(ltResultBucket, ltResultPrefix+name)
	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]interface{}{"ok": true})
}

// gRPC load test endpoint
// POST /loadtest/grpc
func loadTestGrpcHandler(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		http.Error(w, "POST required", http.StatusMethodNotAllowed)
		return
	}
	var req struct {
		Address     string `json:"address"`
		Service     string `json:"service"`
		Method      string `json:"method"`
		Payload     string `json:"payload"`
		Concurrency int    `json:"concurrency"`
		TotalReqs   int    `json:"totalReqs"`
		TimeoutMs   int    `json:"timeoutMs"`
		Tls         bool   `json:"tls"`
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		http.Error(w, "invalid json", http.StatusBadRequest)
		return
	}
	if req.Concurrency < 1 {
		req.Concurrency = 1
	}
	if req.Concurrency > 50 {
		req.Concurrency = 50
	}
	if req.TotalReqs < 1 {
		req.TotalReqs = 10
	}
	if req.TotalReqs > 5000 {
		req.TotalReqs = 5000
	}
	if req.TimeoutMs < 100 {
		req.TimeoutMs = 5000
	}

	hist := hdr.New(1, 60000, 3)
	var mu sync.Mutex
	successful, failed := 0, 0
	statusCodes := make(map[int]int)
	timeline := make([]timelinePoint, 0)
	start := time.Now()
	sem := make(chan struct{}, req.Concurrency)
	var wg sync.WaitGroup

	for i := 0; i < req.TotalReqs; i++ {
		wg.Add(1)
		sem <- struct{}{}
		go func(idx int) {
			defer wg.Done()
			defer func() { <-sem }()
			reqStart := time.Now()

			// Call gRPC invoke via local server
			payload := req.Payload
			if payload == "" {
				payload = "{}"
			}
			body, marshalErr := json.Marshal(struct {
				Address string          `json:"address"`
				Service string          `json:"service"`
				Method  string          `json:"method"`
				Payload json.RawMessage `json:"payload"`
				TLS     bool            `json:"tls"`
				Timeout int             `json:"timeout"`
			}{req.Address, req.Service, req.Method, json.RawMessage(payload), req.Tls, req.TimeoutMs})
			if marshalErr != nil {
				mu.Lock()
				failed++
				statusCodes[0]++
				mu.Unlock()
				return
			}
			httpReq, _ := http.NewRequest("POST",
				fmt.Sprintf("http://127.0.0.1:%d/grpc/invoke", sidecarPort),
				bytes.NewReader(body))
			httpReq.Header.Set("Content-Type", "application/json")
			httpReq.Header.Set("X-Sidecar-Token", sidecarToken)
			cl := &http.Client{Timeout: time.Duration(req.TimeoutMs) * time.Millisecond}
			resp, err := cl.Do(httpReq)
			ok := false
			if err == nil {
				io.Copy(io.Discard, resp.Body)
				resp.Body.Close()
				ok = resp.StatusCode == 200
			}

			latencyMs := float64(time.Since(reqStart).Microseconds()) / 1000.0
			elapsed := float64(time.Since(start).Microseconds()) / 1000.0

			mu.Lock()
			hist.RecordValue(int64(latencyMs))
			if ok {
				successful++
				statusCodes[200]++
			} else {
				failed++
				statusCodes[0]++
			}
			timeline = append(timeline, timelinePoint{TimeMs: elapsed, LatencyMs: latencyMs, Ok: ok})
			mu.Unlock()
		}(i)
	}
	wg.Wait()
	totalTime := float64(time.Since(start).Microseconds()) / 1000.0

	result := loadTestResult{
		TotalRequests: req.TotalReqs,
		Successful:    successful,
		Failed:        failed,
		TotalTimeMs:   math.Round(totalTime*100) / 100,
		AvgMs:         math.Round(hist.Mean()*100) / 100,
		MinMs:         float64(hist.Min()),
		MaxMs:         float64(hist.Max()),
		P50Ms:         float64(hist.ValueAtQuantile(50)),
		P95Ms:         float64(hist.ValueAtQuantile(95)),
		P99Ms:         float64(hist.ValueAtQuantile(99)),
		StatusCodes:   statusCodes,
		Timeline:      timeline,
	}
	if totalTime > 0 {
		result.Throughput = math.Round(float64(req.TotalReqs)/(totalTime/1000)*100) / 100
	}
	if req.TotalReqs > 0 {
		result.ErrorRate = math.Round(float64(failed)/float64(req.TotalReqs)*10000) / 100
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(result)
}

// RegisterHandlers registers HTTP and gRPC load testing endpoints.
func RegisterHandlers(mux *http.ServeMux) {
	mux.HandleFunc("/loadtest", loadTestHandler)
	mux.HandleFunc("/loadtest/report", loadTestReportHandler)
	mux.HandleFunc("/loadtest/scenario/save", loadTestScenarioSaveHandler)
	mux.HandleFunc("/loadtest/scenario/list", loadTestScenarioListHandler)
	mux.HandleFunc("/loadtest/scenario/load", loadTestScenarioLoadHandler)
	mux.HandleFunc("/loadtest/compare", loadTestCompareHandler)
	mux.HandleFunc("/loadtest/result/save", loadTestResultSaveHandler)
	mux.HandleFunc("/loadtest/result/list", loadTestResultListHandler)
	mux.HandleFunc("/loadtest/result/load", loadTestResultLoadHandler)
	mux.HandleFunc("/loadtest/result/delete", loadTestResultDeleteHandler)
	mux.HandleFunc("/loadtest/grpc", loadTestGrpcHandler)
}
