package adomniacli

import (
	"bytes"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"sync/atomic"
	"testing"
	"time"

	"github.com/Andrea-Cavallo/adOmnia/internal/jsonutil"
	"github.com/Andrea-Cavallo/adOmnia/internal/loadtest"
	"github.com/Andrea-Cavallo/adOmnia/internal/requestcontract"
)

func writeStressPlan(t *testing.T, url string, maxP95 float64) string {
	t.Helper()
	plan := loadtest.Plan{Format: "adomnia-flow-stress-plan", Version: 1, FlowName: "Checkout CI"}
	plan.Config = loadtest.StressConfig{VUs: 2, Mode: "iterations", Iterations: 4, ApdexTMs: 500, MinApdex: .8, MaxP95Ms: maxP95, MaxErrorPct: new(0.0)}
	plan.Graph.Settings.MaxSteps = 10
	plan.Graph.Nodes = []loadtest.Node{
		{ID: "start", Type: "start", Label: "Start"},
		{ID: "request", Type: "request", Label: "Health", Config: loadtest.NodeConfig{ExpectedStatus: "2xx", Request: &requestcontract.Request{ID: "health", Name: "Health", Method: "GET", URL: url}}},
		{ID: "end", Type: "end", Label: "Done", Config: loadtest.NodeConfig{EndState: "success"}},
	}
	plan.Graph.Edges = []loadtest.Edge{{Source: "start", Target: "request", Branch: "next"}, {Source: "request", Target: "end", Branch: "success"}}
	data, err := jsonutil.Marshal(plan)
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
	plan := loadtest.Plan{Format: "adomnia-flow-stress-plan", Version: 1, FlowName: "AI recovery", Config: loadtest.StressConfig{VUs: 1, Mode: "iterations", Iterations: 1, ApdexTMs: 500, MaxErrorPct: new(100.0)}}
	plan.Graph.Settings.MaxSteps = 10
	plan.Graph.Nodes = []loadtest.Node{
		{ID: "a", Type: "request", Label: "A", Config: loadtest.NodeConfig{Request: request("a", "/a"), ExpectedStatus: "2xx", Extractions: []loadtest.Mapping{{Name: "customerId", Source: "body", Path: "customer.id"}}}},
		{ID: "b", Type: "request", Label: "B", Config: loadtest.NodeConfig{Request: request("b", "/b/{{customerId}}"), ExpectedStatus: "2xx"}},
		{ID: "d", Type: "request", Label: "D", Config: loadtest.NodeConfig{Request: request("d", "/recover/{{customerId}}"), ExpectedStatus: "2xx"}},
		{ID: "end", Type: "end", Label: "Done", Config: loadtest.NodeConfig{EndState: "success"}},
	}
	plan.Graph.Edges = []loadtest.Edge{{Source: "a", Target: "b", Branch: "success"}, {Source: "b", Target: "d", Branch: "error"}, {Source: "d", Target: "end", Branch: "success"}}
	data, _ := jsonutil.Marshal(plan)
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

func TestStressRunsAScenarioFileWithItsDatasetAndFailsTheGateInJUnit(t *testing.T) {
	var users sync.Map
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		users.Store(r.URL.Query().Get("u"), true)
		time.Sleep(20 * time.Millisecond)
	}))
	defer srv.Close()
	dir := t.TempDir()
	file := loadtest.ScenarioFile{
		Name:     "users",
		Target:   loadtest.ScenarioTarget{Kind: "request", Request: &requestcontract.Request{ID: "u", Name: "User", Method: "GET", URL: "{{base}}/user?u={{user}}"}},
		Workload: loadtest.Workload{Executor: loadtest.ExecutorVUs, VUs: 2, Iterations: 4},
		Gates:    &loadtest.Gates{MaxP95Ms: 1},
		Data:     &loadtest.DataRef{File: "data/users.csv"},
	}
	path, err := loadtest.SaveScenarioFile(dir, file)
	if err != nil {
		t.Fatal(err)
	}
	dataDir := filepath.Join(filepath.Dir(path), "data")
	if err := os.MkdirAll(dataDir, 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(dataDir, "users.csv"), []byte("user\nann\nbob\n"), 0o644); err != nil {
		t.Fatal(err)
	}
	var stdout, stderr bytes.Buffer
	code := Stress([]string{path, "--env-var", "base=" + srv.URL, "--reporter", "junit", "--seed", "5"}, &stdout, &stderr)
	if code != 1 {
		t.Fatalf("exit = %d, want 1 (p95 gate broken); stderr=%s", code, stderr.String())
	}
	if !strings.Contains(stdout.String(), `failures="1"`) || !strings.Contains(stdout.String(), "p95") {
		t.Fatalf("junit = %s", stdout.String())
	}
	for _, u := range []string{"ann", "bob"} {
		if _, ok := users.Load(u); !ok {
			t.Fatalf("dataset row %q never sent", u)
		}
	}
	stdout.Reset()
	if code := Stress([]string{path, "--env-var", "base=" + srv.URL, "--reporter", "html"}, &stdout, &stderr); code != 1 || !strings.Contains(stdout.String(), "<!doctype html>") {
		t.Fatalf("html reporter: exit %d, %.80s", code, stdout.String())
	}
}
