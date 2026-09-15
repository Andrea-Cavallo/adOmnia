package adomniacli

import (
	"bytes"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"sync/atomic"
	"testing"
	"time"

	"adomnia/internal/requestcontract"
)

func writeStressPlan(t *testing.T, url string, maxP95 float64) string {
	t.Helper()
	plan := stressPlan{Format: "adomnia-flow-stress-plan", Version: 1, FlowName: "Checkout CI"}
	plan.Config = stressConfig{VUs: 2, Mode: "iterations", Iterations: 4, ApdexTMs: 500, MinApdex: .8, MaxP95Ms: maxP95, MaxErrorPct: 0}
	plan.Graph.Settings.MaxSteps = 10
	plan.Graph.Nodes = []stressNode{
		{ID: "start", Type: "start", Label: "Start"},
		{ID: "request", Type: "request", Label: "Health", Config: stressNodeConfig{ExpectedStatus: "2xx", Request: &requestcontract.Request{ID: "health", Name: "Health", Method: "GET", URL: url}}},
		{ID: "end", Type: "end", Label: "Done", Config: stressNodeConfig{EndState: "success"}},
	}
	plan.Graph.Edges = []stressEdge{{Source: "start", Target: "request", Branch: "next"}, {Source: "request", Target: "end", Branch: "success"}}
	data, err := json.Marshal(plan)
	if err != nil {
		t.Fatal(err)
	}
	path := filepath.Join(t.TempDir(), "checkout.stress.json")
	if err := os.WriteFile(path, data, 0600); err != nil {
		t.Fatal(err)
	}
	return path
}

func TestStressRunsPortablePlanAndWritesJUnit(t *testing.T) {
	var calls atomic.Int64
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) { calls.Add(1); w.WriteHeader(http.StatusNoContent) }))
	defer server.Close()
	path := writeStressPlan(t, server.URL, 1000)
	var stdout, stderr bytes.Buffer
	code := Run([]string{"stress", path, "--reporter", "junit"}, &stdout, &stderr)
	if code != 0 {
		t.Fatalf("code=%d stderr=%s", code, stderr.String())
	}
	if calls.Load() != 4 {
		t.Fatalf("calls=%d", calls.Load())
	}
	if !strings.Contains(stdout.String(), "Checkout CI stress SLOs") || !strings.Contains(stdout.String(), "tests=\"1\"") {
		t.Fatalf("unexpected junit: %s", stdout.String())
	}
}

func TestStressReturnsOneWhenReleaseGateFails(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		time.Sleep(2 * time.Millisecond)
		w.WriteHeader(http.StatusOK)
	}))
	defer server.Close()
	path := writeStressPlan(t, server.URL, .0001)
	var stdout, stderr bytes.Buffer
	code := Run([]string{"stress", path, "--reporter", "json"}, &stdout, &stderr)
	if code != 1 {
		t.Fatalf("code=%d stderr=%s output=%s", code, stderr.String(), stdout.String())
	}
	if !strings.Contains(stdout.String(), "gateFailures") {
		t.Fatalf("missing gate evidence: %s", stdout.String())
	}
}

func TestStressPreservesDataHandoffsAndFailureBranches(t *testing.T) {
	seen := []string{}
	var mutex sync.Mutex
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, request *http.Request) {
		mutex.Lock()
		seen = append(seen, request.URL.Path)
		mutex.Unlock()
		switch request.URL.Path {
		case "/a":
			_, _ = w.Write([]byte(`{"customer":{"id":"42"}}`))
		case "/b/42":
			w.WriteHeader(http.StatusInternalServerError)
		case "/recover/42":
			w.WriteHeader(http.StatusNoContent)
		default:
			w.WriteHeader(http.StatusNotFound)
		}
	}))
	defer server.Close()
	request := func(id, path string) *requestcontract.Request {
		return &requestcontract.Request{ID: id, Name: id, Method: "GET", URL: server.URL + path}
	}
	plan := stressPlan{Format: "adomnia-flow-stress-plan", Version: 1, FlowName: "AI recovery", Config: stressConfig{VUs: 1, Mode: "iterations", Iterations: 1, ApdexTMs: 500, MaxErrorPct: 100}}
	plan.Graph.Settings.MaxSteps = 10
	plan.Graph.Nodes = []stressNode{
		{ID: "a", Type: "request", Label: "A", Config: stressNodeConfig{Request: request("a", "/a"), ExpectedStatus: "2xx", Extractions: []stressMapping{{Name: "customerId", Source: "body", Path: "customer.id"}}}},
		{ID: "b", Type: "request", Label: "B", Config: stressNodeConfig{Request: request("b", "/b/{{customerId}}"), ExpectedStatus: "2xx"}},
		{ID: "d", Type: "request", Label: "D", Config: stressNodeConfig{Request: request("d", "/recover/{{customerId}}"), ExpectedStatus: "2xx"}},
		{ID: "end", Type: "end", Label: "Done", Config: stressNodeConfig{EndState: "success"}},
	}
	plan.Graph.Edges = []stressEdge{{Source: "a", Target: "b", Branch: "success"}, {Source: "b", Target: "d", Branch: "error"}, {Source: "d", Target: "end", Branch: "success"}}
	data, _ := json.Marshal(plan)
	path := filepath.Join(t.TempDir(), "recovery.stress.json")
	_ = os.WriteFile(path, data, 0600)
	var stdout, stderr bytes.Buffer
	code := Run([]string{"stress", path}, &stdout, &stderr)
	if code != 1 {
		t.Fatalf("expected request error exit code, got %d: %s", code, stderr.String())
	}
	if strings.Join(seen, ",") != "/a,/b/42,/recover/42" {
		t.Fatalf("unexpected calls: %v", seen)
	}
}
