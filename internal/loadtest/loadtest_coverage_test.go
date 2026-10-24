package loadtest

import (
	"encoding/json/v2"
	"fmt"
	"io"
	"math"
	"net"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync"
	"testing"
	"time"

	"adomnia/internal/storage"
)

// tempStore points the package persistence hooks at a throwaway bbolt database, so handlers that
// save, list, load and delete exercise real storage instead of a stub.
func tempStore(t *testing.T) {
	t.Helper()
	storage.Close()
	if err := storage.Open(t.TempDir()); err != nil {
		t.Fatalf("storage.Open() error = %v", err)
	}
	t.Cleanup(storage.Close)
	Configure(storage.Put, storage.Get, storage.List, storage.Delete, 0, "")
}

type resultSummaryView struct {
	Name      string  `json:"name"`
	URL       string  `json:"url"`
	Method    string  `json:"method"`
	AvgMs     float64 `json:"avgMs"`
	P95Ms     float64 `json:"p95Ms"`
	ErrorRate float64 `json:"errorRate"`
	Total     int     `json:"total"`
}

func callHandler(handler http.HandlerFunc, method, target, body string) *httptest.ResponseRecorder {
	var reader io.Reader
	if body != "" {
		reader = strings.NewReader(body)
	}
	recorder := httptest.NewRecorder()
	handler(recorder, httptest.NewRequest(method, target, reader))
	return recorder
}

func TestConfigureWiresPersistenceAndSidecar(t *testing.T) {
	oldPut, oldGet, oldList, oldDelete := putValue, getValue, listValues, deleteValue
	oldPort, oldToken := sidecarPort, sidecarToken
	t.Cleanup(func() {
		putValue, getValue, listValues, deleteValue = oldPut, oldGet, oldList, oldDelete
		sidecarPort, sidecarToken = oldPort, oldToken
	})

	var gotBucket, gotKey string
	var gotValue []byte
	Configure(
		func(bucket, key string, value []byte) error {
			gotBucket, gotKey, gotValue = bucket, key, value
			return nil
		},
		func(string, string) ([]byte, error) { return nil, nil },
		func(string, string) ([]string, error) { return nil, nil },
		func(string, string) error { return nil },
		4321,
		"sidecar-token",
	)
	if sidecarPort != 4321 || sidecarToken != "sidecar-token" {
		t.Fatalf("sidecar = %d/%q", sidecarPort, sidecarToken)
	}

	recorder := callHandler(loadTestScenarioSaveHandler, http.MethodPost, "/loadtest/scenario/save", `{"name":"smoke","config":{"url":"https://api.test","totalReqs":5}}`)
	if recorder.Code != http.StatusOK {
		t.Fatalf("status %d: %s", recorder.Code, recorder.Body.String())
	}
	if gotBucket != "workspace" || gotKey != "scenario/smoke" {
		t.Fatalf("put called with %q/%q", gotBucket, gotKey)
	}
	var stored loadTestRequest
	if err := json.Unmarshal(gotValue, &stored); err != nil {
		t.Fatalf("stored config is not a loadTestRequest: %v (%s)", err, gotValue)
	}
	if stored.URL != "https://api.test" || stored.TotalReqs != 5 {
		t.Fatalf("stored config = %+v", stored)
	}
}

//nolint:gocyclo // linear end-to-end scenario: one sequential walk through save/list/load/delete plus edge cases
func TestLoadTestResultSaveListLoadDelete(t *testing.T) {
	tempStore(t)

	if recorder := callHandler(loadTestResultSaveHandler, http.MethodGet, "/loadtest/result/save", ""); recorder.Code != http.StatusMethodNotAllowed {
		t.Fatalf("GET status = %d", recorder.Code)
	}
	if recorder := callHandler(loadTestResultSaveHandler, http.MethodPost, "/loadtest/result/save", "{"); recorder.Code != http.StatusBadRequest {
		t.Fatalf("invalid json status = %d", recorder.Code)
	}
	if recorder := callHandler(loadTestResultSaveHandler, http.MethodPost, "/loadtest/result/save", `{"url":"https://api.test"}`); recorder.Code != http.StatusBadRequest {
		t.Fatalf("missing name status = %d", recorder.Code)
	}

	save := func(name, url, method string, total int, avg, p95, errRate float64) string {
		payload := fmt.Sprintf(`{"name":%q,"url":%q,"method":%q,"result":{"totalRequests":%d,"avgMs":%v,"p95Ms":%v,"errorRate":%v}}`, name, url, method, total, avg, p95, errRate)
		recorder := callHandler(loadTestResultSaveHandler, http.MethodPost, "/loadtest/result/save", payload)
		if recorder.Code != http.StatusOK {
			t.Fatalf("save %s status = %d: %s", name, recorder.Code, recorder.Body.String())
		}
		var response struct {
			Ok        bool   `json:"ok"`
			Name      string `json:"name"`
			Timestamp string `json:"timestamp"`
		}
		if err := json.Unmarshal(recorder.Body.Bytes(), &response); err != nil {
			t.Fatal(err)
		}
		if !response.Ok || response.Name != name {
			t.Fatalf("save response = %+v", response)
		}
		if _, err := time.Parse(time.RFC3339, response.Timestamp); err != nil {
			t.Fatalf("timestamp %q: %v", response.Timestamp, err)
		}
		return response.Timestamp
	}

	save("run-a", "https://api.test/a", "POST", 10, 12.5, 30.25, 20)
	save("run-b", "https://api.test/b", "GET", 20, 5, 9, 0)

	storedA, err := storage.Get(ltResultBucket, ltResultPrefix+"run-a")
	if err != nil || storedA == nil {
		t.Fatalf("stored result = %q, %v", storedA, err)
	}
	var savedA savedLoadTestResult
	if err := json.Unmarshal(storedA, &savedA); err != nil {
		t.Fatal(err)
	}
	if savedA.Name != "run-a" || savedA.URL != "https://api.test/a" || savedA.Method != "POST" || savedA.Result.P95Ms != 30.25 {
		t.Fatalf("stored result = %+v", savedA)
	}

	list := func() struct {
		Results []resultSummaryView `json:"results"`
		Count   int                 `json:"count"`
	} {
		recorder := callHandler(loadTestResultListHandler, http.MethodGet, "/loadtest/result/list", "")
		if recorder.Code != http.StatusOK {
			t.Fatalf("list status = %d: %s", recorder.Code, recorder.Body.String())
		}
		var response struct {
			Results []resultSummaryView `json:"results"`
			Count   int                 `json:"count"`
		}
		if err := json.Unmarshal(recorder.Body.Bytes(), &response); err != nil {
			t.Fatal(err)
		}
		return response
	}

	listed := list()
	if listed.Count != 2 || len(listed.Results) != 2 {
		t.Fatalf("list = %+v", listed)
	}
	found := false
	for _, summary := range listed.Results {
		if summary.Name != "run-a" {
			continue
		}
		found = true
		if summary.URL != "https://api.test/a" || summary.Method != "POST" || summary.AvgMs != 12.5 || summary.P95Ms != 30.25 || summary.ErrorRate != 20 || summary.Total != 10 {
			t.Fatalf("summary = %+v", summary)
		}
	}
	if !found {
		t.Fatalf("run-a missing from %+v", listed.Results)
	}

	// A key that does not decode is skipped, not fatal: one bad record must not hide the others.
	if err := storage.Put(ltResultBucket, ltResultPrefix+"broken", []byte("{")); err != nil {
		t.Fatal(err)
	}
	if listed = list(); listed.Count != 2 {
		t.Fatalf("list with a corrupt entry count = %d", listed.Count)
	}

	recorder := callHandler(loadTestResultLoadHandler, http.MethodGet, "/loadtest/result/load?name=run-a", "")
	if recorder.Code != http.StatusOK {
		t.Fatalf("load status = %d: %s", recorder.Code, recorder.Body.String())
	}
	if recorder.Body.String() != string(storedA) {
		t.Fatalf("load body = %s, want %s", recorder.Body.String(), storedA)
	}
	if recorder := callHandler(loadTestResultLoadHandler, http.MethodGet, "/loadtest/result/load", ""); recorder.Code != http.StatusBadRequest {
		t.Fatalf("load without name status = %d", recorder.Code)
	}
	if recorder := callHandler(loadTestResultLoadHandler, http.MethodGet, "/loadtest/result/load?name=missing", ""); recorder.Code != http.StatusNotFound {
		t.Fatalf("load missing status = %d", recorder.Code)
	}

	if recorder := callHandler(loadTestResultDeleteHandler, http.MethodGet, "/loadtest/result/delete", ""); recorder.Code != http.StatusMethodNotAllowed {
		t.Fatalf("delete GET status = %d", recorder.Code)
	}
	if recorder := callHandler(loadTestResultDeleteHandler, http.MethodDelete, "/loadtest/result/delete", ""); recorder.Code != http.StatusBadRequest {
		t.Fatalf("delete without name status = %d", recorder.Code)
	}
	if recorder := callHandler(loadTestResultDeleteHandler, http.MethodDelete, "/loadtest/result/delete?name=run-a", ""); recorder.Code != http.StatusOK {
		t.Fatalf("delete status = %d", recorder.Code)
	}
	if recorder := callHandler(loadTestResultLoadHandler, http.MethodGet, "/loadtest/result/load?name=run-a", ""); recorder.Code != http.StatusNotFound {
		t.Fatalf("load after delete status = %d", recorder.Code)
	}
	if recorder := callHandler(loadTestResultDeleteHandler, http.MethodPost, "/loadtest/result/delete?name=run-b", ""); recorder.Code != http.StatusOK {
		t.Fatalf("POST delete status = %d", recorder.Code)
	}
	if listed = list(); listed.Count != 0 {
		t.Fatalf("list after delete count = %d", listed.Count)
	}
}

const reportResultJSON = `{"totalRequests":10,"successful":8,"failed":2,"errorRate":20,"totalTimeMs":1500.6,` +
	`"throughput":6.66,"avgMs":12.34,"minMs":1,"maxMs":40,"p50Ms":10,"p75Ms":20,"p90Ms":25,"p95Ms":30,"p99Ms":38,"p999Ms":39,` +
	`"warmupSkipped":2,"statusCodes":{"200":8,"500":2}}`

func TestLoadTestResultListSkipsEntriesThatFailToLoad(t *testing.T) {
	oldPut, oldGet, oldList, oldDelete := putValue, getValue, listValues, deleteValue
	t.Cleanup(func() {
		putValue, getValue, listValues, deleteValue = oldPut, oldGet, oldList, oldDelete
	})
	Configure(
		func(string, string, []byte) error { return nil },
		func(_, key string) ([]byte, error) {
			if key == "ltresult/gone" {
				return nil, fmt.Errorf("storage unavailable")
			}
			return []byte(`{"name":"kept","url":"https://api.test","result":{"totalRequests":3}}`), nil
		},
		func(string, string) ([]string, error) { return []string{"ltresult/gone", "ltresult/kept"}, nil },
		func(string, string) error { return nil },
		0,
		"",
	)

	recorder := callHandler(loadTestResultListHandler, http.MethodGet, "/loadtest/result/list", "")
	if recorder.Code != http.StatusOK {
		t.Fatalf("status = %d", recorder.Code)
	}
	var listed struct {
		Results []resultSummaryView `json:"results"`
		Count   int                 `json:"count"`
	}
	if err := json.Unmarshal(recorder.Body.Bytes(), &listed); err != nil {
		t.Fatal(err)
	}
	if listed.Count != 1 || len(listed.Results) != 1 || listed.Results[0].Name != "kept" || listed.Results[0].Total != 3 {
		t.Fatalf("list = %+v", listed)
	}
}

func TestLoadTestReportHandler(t *testing.T) {
	if recorder := callHandler(loadTestReportHandler, http.MethodGet, "/loadtest/report", ""); recorder.Code != http.StatusMethodNotAllowed {
		t.Fatalf("GET status = %d", recorder.Code)
	}
	if recorder := callHandler(loadTestReportHandler, http.MethodPost, "/loadtest/report", "{"); recorder.Code != http.StatusBadRequest {
		t.Fatalf("invalid json status = %d", recorder.Code)
	}

	jsonRecorder := callHandler(loadTestReportHandler, http.MethodPost, "/loadtest/report", reportResultJSON)
	if jsonRecorder.Code != http.StatusOK {
		t.Fatalf("json status = %d: %s", jsonRecorder.Code, jsonRecorder.Body.String())
	}
	if contentType := jsonRecorder.Header().Get("Content-Type"); contentType != "application/json" {
		t.Fatalf("json content type = %q", contentType)
	}
	var decoded loadTestResult
	if err := json.Unmarshal(jsonRecorder.Body.Bytes(), &decoded); err != nil {
		t.Fatal(err)
	}
	if decoded.TotalRequests != 10 || decoded.Successful != 8 || decoded.WarmupSkipped != 2 {
		t.Fatalf("json report = %+v", decoded)
	}

	htmlRecorder := callHandler(loadTestReportHandler, http.MethodPost, "/loadtest/report?format=html", reportResultJSON)
	if htmlRecorder.Code != http.StatusOK {
		t.Fatalf("html status = %d", htmlRecorder.Code)
	}
	if contentType := htmlRecorder.Header().Get("Content-Type"); contentType != "text/html; charset=utf-8" {
		t.Fatalf("html content type = %q", contentType)
	}
	html := htmlRecorder.Body.String()
	for _, want := range []string{"<h1>Load Test Report</h1>", `<span class="m-value">10</span>`, `<span class="m-value">20.0%</span>`, "<td>200</td><td>8</td>", "<td>500</td><td>2</td>", "Generated by adOmnia"} {
		if !strings.Contains(html, want) {
			t.Fatalf("html report missing %q", want)
		}
	}

	mdRecorder := callHandler(loadTestReportHandler, http.MethodPost, "/loadtest/report?format=md", reportResultJSON)
	if contentType := mdRecorder.Header().Get("Content-Type"); contentType != "text/markdown; charset=utf-8" {
		t.Fatalf("md content type = %q", contentType)
	}
	markdown := mdRecorder.Body.String()
	for _, want := range []string{"# Load Test Report", "| Total Requests | 10 |", "| Error Rate | 20.0% |", "| Total Time | 1501ms |", "| Warmup Skipped | 2 |", "## Status Codes", "| 500 | 2 |", "*Generated by adOmnia*"} {
		if !strings.Contains(markdown, want) {
			t.Fatalf("markdown report missing %q", want)
		}
	}

	aliasRecorder := callHandler(loadTestReportHandler, http.MethodPost, "/loadtest/report?format=markdown", reportResultJSON)
	if contentType := aliasRecorder.Header().Get("Content-Type"); contentType != "text/markdown; charset=utf-8" {
		t.Fatalf("markdown alias content type = %q", contentType)
	}
	for _, want := range []string{"| Total Requests | 10 |", "## Status Codes"} {
		if !strings.Contains(aliasRecorder.Body.String(), want) {
			t.Fatalf("markdown alias report missing %q", want)
		}
	}
}

func TestLoadTestReportMarkdownOmitsEmptySections(t *testing.T) {
	result := &loadTestResult{TotalRequests: 1, Successful: 1}
	report := loadTestReportMarkdown(result)
	if strings.Contains(report, "Warmup Skipped") {
		t.Fatalf("warmup row with no skipped requests: %s", report)
	}
	if strings.Contains(report, "## Status Codes") {
		t.Fatalf("status section with no codes: %s", report)
	}
	for _, want := range []string{"| Failed | 0 |", "| Error Rate | 0.0% |", "| Throughput | 0.0 req/s |", "| Avg Latency | 0.0ms |"} {
		if !strings.Contains(report, want) {
			t.Fatalf("report missing %q:\n%s", want, report)
		}
	}
}

func TestLoadTestReportHTMLRendersEveryMetric(t *testing.T) {
	result := &loadTestResult{TotalRequests: 10, Successful: 8, Failed: 2, ErrorRate: 20, Throughput: 6.66, AvgMs: 12.5, P50Ms: 10, P95Ms: 30, P99Ms: 38}
	page := loadTestReportHTML(result)
	for _, want := range []string{"12.5 / 10.0 / 30.0 / 38.0 ms", "6.7 req/s", "</table>"} {
		if !strings.Contains(page, want) {
			t.Fatalf("html report missing %q", want)
		}
	}
	if strings.Contains(page, "<td>200</td>") {
		t.Fatal("html report invented a status code")
	}
}

func TestLoadTestScenarioSaveListLoad(t *testing.T) {
	tempStore(t)

	if recorder := callHandler(loadTestScenarioSaveHandler, http.MethodGet, "/loadtest/scenario/save", ""); recorder.Code != http.StatusMethodNotAllowed {
		t.Fatalf("GET status = %d", recorder.Code)
	}
	if recorder := callHandler(loadTestScenarioSaveHandler, http.MethodPost, "/loadtest/scenario/save", "{"); recorder.Code != http.StatusBadRequest {
		t.Fatalf("invalid json status = %d", recorder.Code)
	}
	if recorder := callHandler(loadTestScenarioSaveHandler, http.MethodPost, "/loadtest/scenario/save", `{"name":""}`); recorder.Code != http.StatusBadRequest {
		t.Fatalf("missing name status = %d", recorder.Code)
	}
	recorder := callHandler(loadTestScenarioSaveHandler, http.MethodPost, "/loadtest/scenario/save", `{"name":"smoke","config":{"url":"https://api.test","method":"POST","totalReqs":7}}`)
	if recorder.Code != http.StatusOK {
		t.Fatalf("save status = %d: %s", recorder.Code, recorder.Body.String())
	}
	var saved struct {
		Ok   bool   `json:"ok"`
		Name string `json:"name"`
	}
	if err := json.Unmarshal(recorder.Body.Bytes(), &saved); err != nil {
		t.Fatal(err)
	}
	if !saved.Ok || saved.Name != "smoke" {
		t.Fatalf("save response = %+v", saved)
	}

	listRecorder := callHandler(loadTestScenarioListHandler, http.MethodGet, "/loadtest/scenario/list", "")
	if listRecorder.Code != http.StatusOK {
		t.Fatalf("list status = %d", listRecorder.Code)
	}
	var listed struct {
		Scenarios []string `json:"scenarios"`
		Count     int      `json:"count"`
	}
	if err := json.Unmarshal(listRecorder.Body.Bytes(), &listed); err != nil {
		t.Fatal(err)
	}
	if listed.Count != 1 || len(listed.Scenarios) != 1 || listed.Scenarios[0] != "smoke" {
		t.Fatalf("list = %+v", listed)
	}

	if recorder := callHandler(loadTestScenarioLoadHandler, http.MethodGet, "/loadtest/scenario/load", ""); recorder.Code != http.StatusBadRequest {
		t.Fatalf("load without name status = %d", recorder.Code)
	}
	if recorder := callHandler(loadTestScenarioLoadHandler, http.MethodGet, "/loadtest/scenario/load?name=missing", ""); recorder.Code != http.StatusNotFound {
		t.Fatalf("load missing status = %d", recorder.Code)
	}
	loadRecorder := callHandler(loadTestScenarioLoadHandler, http.MethodGet, "/loadtest/scenario/load?name=smoke", "")
	if loadRecorder.Code != http.StatusOK {
		t.Fatalf("load status = %d", loadRecorder.Code)
	}
	var config loadTestRequest
	if err := json.Unmarshal(loadRecorder.Body.Bytes(), &config); err != nil {
		t.Fatal(err)
	}
	if config.URL != "https://api.test" || config.Method != "POST" || config.TotalReqs != 7 {
		t.Fatalf("loaded config = %+v", config)
	}
}

func TestLoadTestCompareHandler(t *testing.T) {
	if recorder := callHandler(loadTestCompareHandler, http.MethodGet, "/loadtest/compare", ""); recorder.Code != http.StatusMethodNotAllowed {
		t.Fatalf("GET status = %d", recorder.Code)
	}
	if recorder := callHandler(loadTestCompareHandler, http.MethodPost, "/loadtest/compare", "{"); recorder.Code != http.StatusBadRequest {
		t.Fatalf("invalid json status = %d", recorder.Code)
	}

	payload := `{"left":{"throughput":100,"avgMs":0,"p95Ms":200,"errorRate":5,"totalRequests":10},` +
		`"right":{"throughput":150,"avgMs":0,"p95Ms":100,"errorRate":2,"totalRequests":20}}`
	if recorder := callHandler(loadTestCompareHandler, http.MethodPost, "/loadtest/compare", payload); recorder.Code != http.StatusOK {
		t.Fatalf("status = %d: %s", recorder.Code, recorder.Body.String())
	}
	recorder := callHandler(loadTestCompareHandler, http.MethodPost, "/loadtest/compare", payload)
	var compared struct {
		Left  map[string]float64 `json:"left"`
		Right map[string]float64 `json:"right"`
		Delta map[string]float64 `json:"delta"`
	}
	if err := json.Unmarshal(recorder.Body.Bytes(), &compared); err != nil {
		t.Fatal(err)
	}
	if compared.Left["throughput"] != 100 || compared.Left["total"] != 10 {
		t.Fatalf("left = %+v", compared.Left)
	}
	if compared.Right["p95Ms"] != 100 || compared.Right["total"] != 20 {
		t.Fatalf("right = %+v", compared.Right)
	}
	wantDelta := map[string]float64{"throughput": 50, "avgMs": 0, "p95Ms": -50, "errRate": -3}
	for key, want := range wantDelta {
		if math.Abs(compared.Delta[key]-want) > 1e-9 {
			t.Fatalf("delta[%s] = %v, want %v (all: %+v)", key, compared.Delta[key], want, compared.Delta)
		}
	}

	rounding := `{"left":{"avgMs":3},"right":{"avgMs":4}}`
	recorder = callHandler(loadTestCompareHandler, http.MethodPost, "/loadtest/compare", rounding)
	compared = struct {
		Left  map[string]float64 `json:"left"`
		Right map[string]float64 `json:"right"`
		Delta map[string]float64 `json:"delta"`
	}{}
	if err := json.Unmarshal(recorder.Body.Bytes(), &compared); err != nil {
		t.Fatal(err)
	}
	if compared.Delta["avgMs"] != 33.33 {
		t.Fatalf("rounded delta = %v, want 33.33", compared.Delta["avgMs"])
	}
}

func TestDeltaPct(t *testing.T) {
	cases := []struct {
		a, b, want float64
	}{
		{0, 5, 0},
		{0, 0, 0},
		{100, 100, 0},
		{100, 150, 50},
		{100, 50, -50},
		{200, 150, -25},
		{3, 4, 33.33},
		{7, 8, 14.29},
		{1000, 1000.01, 0},
	}
	for _, tc := range cases {
		if got := deltaPct(tc.a, tc.b); math.Abs(got-tc.want) > 1e-9 {
			t.Errorf("deltaPct(%v, %v) = %v, want %v", tc.a, tc.b, got, tc.want)
		}
	}
}

func TestGrpcStatusCode(t *testing.T) {
	codes := map[string]int{"OK": 0, "CANCELLED": 1, "UNKNOWN": 2, "INVALID_ARGUMENT": 3, "DEADLINE_EXCEEDED": 4, "NOT_FOUND": 5, "ALREADY_EXISTS": 6, "PERMISSION_DENIED": 7, "RESOURCE_EXHAUSTED": 8, "FAILED_PRECONDITION": 9, "ABORTED": 10, "OUT_OF_RANGE": 11, "UNIMPLEMENTED": 12, "INTERNAL": 13, "UNAVAILABLE": 14, "DATA_LOSS": 15, "UNAUTHENTICATED": 16}
	for status, want := range codes {
		if got := grpcStatusCode(status); got != want {
			t.Errorf("grpcStatusCode(%q) = %d, want %d", status, got, want)
		}
	}
	for _, unknown := range []string{"TRANSPORT_ERROR", "HTTP_503", "", "ok"} {
		if got := grpcStatusCode(unknown); got != -1 {
			t.Errorf("grpcStatusCode(%q) = %d, want -1", unknown, got)
		}
	}
}

func TestLoadTestGrpcHandlerClampsDefaults(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		_, _ = w.Write([]byte(`{"status":"OK"}`))
	}))
	defer server.Close()
	tempStore(t)
	Configure(storage.Put, storage.Get, storage.List, storage.Delete, server.Listener.Addr().(*net.TCPAddr).Port, "token")

	recorder := callHandler(loadTestGrpcHandler, http.MethodPost, "/loadtest/grpc", `{}`)
	if recorder.Code != http.StatusOK {
		t.Fatalf("status = %d: %s", recorder.Code, recorder.Body.String())
	}
	var result loadTestResult
	if err := json.Unmarshal(recorder.Body.Bytes(), &result); err != nil {
		t.Fatal(err)
	}
	if result.TotalRequests != 10 || result.Successful != 10 || result.Failed != 0 {
		t.Fatalf("defaults result = %+v", result)
	}
}

func TestLoadTestGrpcHandler(t *testing.T) {
	if recorder := callHandler(loadTestGrpcHandler, http.MethodGet, "/loadtest/grpc", ""); recorder.Code != http.StatusMethodNotAllowed {
		t.Fatalf("GET status = %d", recorder.Code)
	}
	if recorder := callHandler(loadTestGrpcHandler, http.MethodPost, "/loadtest/grpc", "{"); recorder.Code != http.StatusBadRequest {
		t.Fatalf("invalid json status = %d", recorder.Code)
	}

	type sidecar struct {
		status int
		body   string
	}
	run := func(t *testing.T, response sidecar, request string) (loadTestResult, []byte, string) {
		t.Helper()
		var mu sync.Mutex
		var captured []byte
		var token string
		server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			body, _ := io.ReadAll(r.Body)
			mu.Lock()
			captured, token = body, r.Header.Get("X-Sidecar-Token")
			mu.Unlock()
			w.Header().Set("Content-Type", "application/json")
			w.WriteHeader(response.status)
			_, _ = w.Write([]byte(response.body))
		}))
		defer server.Close()
		tempStore(t)
		Configure(storage.Put, storage.Get, storage.List, storage.Delete, server.Listener.Addr().(*net.TCPAddr).Port, "sidecar-token")

		recorder := callHandler(loadTestGrpcHandler, http.MethodPost, "/loadtest/grpc", request)
		if recorder.Code != http.StatusOK {
			t.Fatalf("status = %d: %s", recorder.Code, recorder.Body.String())
		}
		var result loadTestResult
		if err := json.Unmarshal(recorder.Body.Bytes(), &result); err != nil {
			t.Fatal(err)
		}
		return result, captured, token
	}

	t.Run("success", func(t *testing.T) {
		result, captured, token := run(t, sidecar{http.StatusOK, `{"status":"OK"}`}, `{"address":"127.0.0.1:9000","service":"demo.V1","method":"Ping","totalReqs":3,"concurrency":2,"timeoutMs":1500}`)
		if result.TotalRequests != 3 || result.Successful != 3 || result.Failed != 0 {
			t.Fatalf("result = %+v", result)
		}
		if result.StatusCodes[0] != 3 || len(result.Timeline) != 3 {
			t.Fatalf("status codes = %+v, timeline %d", result.StatusCodes, len(result.Timeline))
		}
		if token != "sidecar-token" {
			t.Fatalf("sidecar token = %q", token)
		}
		for _, want := range []string{`"payload":{}`, `"timeout_ms":1500`, `"service":"demo.V1"`} {
			if !strings.Contains(string(captured), want) {
				t.Fatalf("invoke body missing %q: %s", want, captured)
			}
		}
	})

	t.Run("grpc error status", func(t *testing.T) {
		result, _, _ := run(t, sidecar{http.StatusOK, `{"status":"UNAVAILABLE","error":"down"}`}, `{"totalReqs":2}`)
		if result.Successful != 0 || result.Failed != 2 || result.StatusCodes[14] != 2 {
			t.Fatalf("result = %+v", result)
		}
	})

	t.Run("http error", func(t *testing.T) {
		result, _, _ := run(t, sidecar{http.StatusServiceUnavailable, ""}, `{"totalReqs":2}`)
		if result.Successful != 0 || result.Failed != 2 || result.StatusCodes[-1] != 2 {
			t.Fatalf("result = %+v", result)
		}
	})

	t.Run("invalid payload is a failed request", func(t *testing.T) {
		result, _, _ := run(t, sidecar{http.StatusOK, `{"status":"OK"}`}, `{"totalReqs":2,"payload":"not json"}`)
		if result.Successful != 0 || result.Failed != 2 || result.StatusCodes[0] != 2 {
			t.Fatalf("result = %+v", result)
		}
	})

	t.Run("unreachable sidecar", func(t *testing.T) {
		listener, err := net.Listen("tcp", "127.0.0.1:0")
		if err != nil {
			t.Fatal(err)
		}
		port := listener.Addr().(*net.TCPAddr).Port
		listener.Close()
		tempStore(t)
		Configure(storage.Put, storage.Get, storage.List, storage.Delete, port, "sidecar-token")

		recorder := callHandler(loadTestGrpcHandler, http.MethodPost, "/loadtest/grpc", `{"totalReqs":2,"timeoutMs":500}`)
		if recorder.Code != http.StatusOK {
			t.Fatalf("status = %d", recorder.Code)
		}
		var result loadTestResult
		if err := json.Unmarshal(recorder.Body.Bytes(), &result); err != nil {
			t.Fatal(err)
		}
		if result.Successful != 0 || result.Failed != 2 || result.StatusCodes[-1] != 2 {
			t.Fatalf("result = %+v", result)
		}
	})
}

func TestGrpcLoadTestOutcomeRejectsMalformedResponses(t *testing.T) {
	if ok, status := grpcLoadTestOutcome(http.StatusOK, []byte("not json")); ok || status != "INVALID_RESPONSE" {
		t.Fatalf("invalid body: ok=%v status=%s", ok, status)
	}
	if ok, status := grpcLoadTestOutcome(http.StatusOK, []byte(`{}`)); ok || status != "UNKNOWN" {
		t.Fatalf("empty status: ok=%v status=%s", ok, status)
	}
}

func TestRegisterHandlersRoutesEveryEndpoint(t *testing.T) {
	tempStore(t)
	mux := http.NewServeMux()
	RegisterHandlers(mux)

	cases := []struct {
		method string
		target string
		want   int
	}{
		{http.MethodGet, "/loadtest", http.StatusMethodNotAllowed},
		{http.MethodGet, "/loadtest/report", http.StatusMethodNotAllowed},
		{http.MethodGet, "/loadtest/scenario/save", http.StatusMethodNotAllowed},
		{http.MethodGet, "/loadtest/scenario/list", http.StatusOK},
		{http.MethodGet, "/loadtest/scenario/load", http.StatusBadRequest},
		{http.MethodGet, "/loadtest/compare", http.StatusMethodNotAllowed},
		{http.MethodGet, "/loadtest/result/save", http.StatusMethodNotAllowed},
		{http.MethodGet, "/loadtest/result/list", http.StatusOK},
		{http.MethodGet, "/loadtest/result/load", http.StatusBadRequest},
		{http.MethodGet, "/loadtest/result/delete", http.StatusMethodNotAllowed},
		{http.MethodGet, "/loadtest/grpc", http.StatusMethodNotAllowed},
	}
	for _, tc := range cases {
		recorder := httptest.NewRecorder()
		mux.ServeHTTP(recorder, httptest.NewRequest(tc.method, tc.target, nil))
		if recorder.Code != tc.want {
			t.Errorf("%s %s = %d, want %d", tc.method, tc.target, recorder.Code, tc.want)
		}
	}
}
