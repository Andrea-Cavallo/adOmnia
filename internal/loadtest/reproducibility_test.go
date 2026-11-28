package loadtest

import (
	"context"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"sync/atomic"
	"testing"
	"time"

	"github.com/Andrea-Cavallo/adOmnia/internal/grpc"
	"github.com/Andrea-Cavallo/adOmnia/internal/httpexec"
	"github.com/Andrea-Cavallo/adOmnia/internal/requestcontract"
	"github.com/Andrea-Cavallo/adOmnia/internal/storage"
)

func TestSameSeedGivesTheSameDataAndThinkTime(t *testing.T) {
	w := Workload{ThinkTimeMs: 100, ThinkTimeMaxMs: 900, Seed: 42}
	flow := &Flow{Dataset: []map[string]string{{"u": "a"}, {"u": "b"}, {"u": "c"}, {"u": "d"}}, DatasetMode: "random"}
	run := func(seed uint64) (string, []string) {
		w.Seed = seed
		ft := newFlowTarget(flow, nil, seed)
		var trace []string
		for vu := range 3 {
			for it := range 5 {
				v := ft.vars(vu, it)
				trace = append(trace, v["u"]+v["__uuid"]+thinkTime(w, vu, it).String())
			}
		}
		return strings.Join(trace, "|"), trace
	}
	a, trace := run(42)
	b, _ := run(42)
	if a != b {
		t.Fatal("the same seed gave different values")
	}
	if c, _ := run(43); c == a {
		t.Fatal("another seed gave the same values")
	}
	if trace[0] == trace[1] {
		t.Fatal("two iterations of one VU got the same values")
	}
	for vu := range 3 {
		if d := thinkTime(w, vu, 1); d < 100*time.Millisecond || d > 900*time.Millisecond {
			t.Fatalf("think time %v outside [100ms, 900ms]", d)
		}
	}
}

func TestAbortOnFailStopsABrokenTargetEarly(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) { w.WriteHeader(http.StatusInternalServerError) }))
	defer srv.Close()
	s := Scenario{
		Request:  getRequest(srv.URL),
		Workload: Workload{Executor: ExecutorVUs, VUs: 4, DurationS: 30},
		Gates:    &Gates{MaxErrorPct: new(1.0), AbortOnFail: true},
	}
	start := time.Now()
	res, err := Run(context.Background(), s, nil)
	if err != nil {
		t.Fatal(err)
	}
	if elapsed := time.Since(start); elapsed > 8*time.Second {
		t.Fatalf("the run went on for %v with every request failing", elapsed)
	}
	if !res.Aborted || !strings.Contains(res.AbortReason, "error rate") {
		t.Fatalf("aborted=%v reason=%q", res.Aborted, res.AbortReason)
	}
	if len(Failures(res)) == 0 {
		t.Fatal("a live abort must count as a failure")
	}
	if res.Manifest == nil || res.Manifest.Seed == 0 || res.Manifest.ScenarioHash == "" || res.Manifest.Target != "request" {
		t.Fatalf("manifest = %+v", res.Manifest)
	}
}

type httpRequest = httpexec.HTTPExecRequest

func getRequest(url string) *httpRequest {
	return &httpRequest{Method: http.MethodGet, URL: url, TimeoutMs: 5000}
}

func TestManifestMasksSecretsAndHashesTheScenarioOnly(t *testing.T) {
	m := maskVars(map[string]string{"baseUrl": "http://x", "apiToken": "abc", "user": "vault:prod/user", "PASSWORD": "p"})
	if m["baseUrl"] != "http://x" || m["apiToken"] != "***" || m["user"] != "***" || m["PASSWORD"] != "***" {
		t.Fatalf("masked = %v", m)
	}
	a := Scenario{Request: &httpRequest{Method: "GET", URL: "http://x", Headers: map[string]string{"Authorization": "Bearer 1"}}, Workload: Workload{Executor: ExecutorProbe, Count: 1, Seed: 1}}
	b := a
	b.Request = &httpRequest{Method: "GET", URL: "http://x", Headers: map[string]string{"Authorization": "Bearer 2"}}
	b.Workload.Seed = 2
	if scenarioHash(a) != scenarioHash(b) {
		t.Fatal("a new token or seed must not change the scenario hash")
	}
	b.Workload.Count = 2
	if scenarioHash(a) == scenarioHash(b) {
		t.Fatal("a different workload must change the scenario hash")
	}
}

func openTempStore(t *testing.T) *History {
	t.Helper()
	storage.Close()
	if err := storage.Open(t.TempDir()); err != nil {
		t.Fatal(err)
	}
	t.Cleanup(storage.Close)
	return &History{Put: storage.Put, Get: storage.Get, List: storage.List, Delete: storage.Delete}
}

func TestHistorySavesPrunesAndImports(t *testing.T) {
	h := openTempStore(t)
	h.Retention = 2
	base := time.Date(2026, 11, 28, 10, 0, 0, 0, time.UTC)
	for i := range 3 {
		r := Result{Name: "run", StartedAt: base.Add(time.Duration(i) * time.Minute).Format(time.RFC3339Nano), P95Ms: float64(10 * (i + 1)), Timeline: make([]TimelinePoint, storedTimeline+5)}
		if _, err := h.Save(newRunID(), r); err != nil {
			t.Fatal(err)
		}
	}
	runs, err := h.Runs()
	if err != nil || len(runs) != 2 {
		t.Fatalf("runs = %d, %v (retention 2)", len(runs), err)
	}
	if runs[0].P95Ms != 30 || runs[1].P95Ms != 20 {
		t.Fatalf("not newest first / oldest not pruned: %+v", runs)
	}
	full, err := h.Run(runs[0].ID)
	if err != nil || len(full.Timeline) != storedTimeline || !full.TimelineTruncated {
		t.Fatalf("stored timeline = %d truncated=%v err=%v", len(full.Timeline), full.TimelineTruncated, err)
	}
	if err := h.DeleteRun(runs[1].ID); err != nil {
		t.Fatal(err)
	}
	if _, err := h.Run(runs[1].ID); err == nil {
		t.Fatal("a deleted run can still be read")
	}
	imported := Result{Name: "old", StartedAt: base.Add(-time.Hour).Format(time.RFC3339Nano)}
	first, err := h.Import(imported)
	if err != nil || !first.Imported {
		t.Fatalf("import = %+v, %v", first, err)
	}
	again, _ := h.Import(imported)
	if again.ID != first.ID {
		t.Fatal("importing the same run twice made two entries")
	}
}

func TestLegacyResultsMoveIntoTheHistoryOnce(t *testing.T) {
	h := openTempStore(t)
	legacy := `{"name":"before","timestamp":"2026-01-02T03:04:05Z","url":"http://x","method":"GET","result":{"executor":"vus","p95Ms":12,"totalRequests":3}}`
	if err := storage.Put("workspace", "ltresult/before", []byte(legacy)); err != nil {
		t.Fatal(err)
	}
	h.MigrateLegacyResults()
	h.MigrateLegacyResults()
	runs, _ := h.Runs()
	if len(runs) != 1 || runs[0].Name != "before" || runs[0].TargetLabel != "GET http://x" || runs[0].P95Ms != 12 {
		t.Fatalf("runs = %+v", runs)
	}
	if old, _ := storage.Get("workspace", "ltresult/before"); old == nil {
		t.Fatal("the old key must stay")
	}
}

func TestCompareFlagsRegressionsAndDifferentScenarios(t *testing.T) {
	base := Result{P95Ms: 100, ErrorRate: 1, Throughput: 50, Manifest: &Manifest{ScenarioHash: "a"},
		Steps: []StepResult{{ID: "login", Step: "Login", P95Ms: 80}, {ID: "gone", Step: "Gone"}}}
	head := Result{P95Ms: 130, ErrorRate: 1, Throughput: 49, Manifest: &Manifest{ScenarioHash: "a"},
		Steps: []StepResult{{ID: "login", Step: "Login", P95Ms: 120}, {ID: "new", Step: "New"}}}
	c := Compare(base, head, 0)
	if !c.Regression || len(c.Reasons) != 1 || !strings.Contains(c.Reasons[0], "p95") {
		t.Fatalf("comparison = %+v", c)
	}
	if !c.SameScenario || len(c.Warnings) != 0 {
		t.Fatalf("same scenario expected: %+v", c)
	}
	if len(c.Steps) != 1 || c.Steps[0].Deltas[0].Pct != 50 || c.OnlyInBase[0] != "Gone" || c.OnlyInHead[0] != "New" {
		t.Fatalf("steps = %+v", c)
	}
	head.P95Ms, head.Manifest.ScenarioHash = 105, "b"
	if c := Compare(base, head, 0); c.Regression || c.SameScenario || len(c.Warnings) == 0 {
		t.Fatalf("within tolerance, other scenario: %+v", c)
	}
}

func TestReportsRenderFromTheCanonicalResult(t *testing.T) {
	r := Result{Name: "Checkout <v2>", Successful: 9, Failed: 1, ErrorRate: 10, P95Ms: 42, GateFailures: []string{"p95 42ms exceeds 30ms"},
		Steps: []StepResult{{ID: "a", Step: "Pay, now", Count: 10, Errors: 1}}, StatusCodes: map[int]int{200: 9, 500: 1},
		Timeline: []TimelinePoint{{LatencyMs: 1, Step: "Pay, now", Ok: true}}, Manifest: &Manifest{ScenarioHash: strings.Repeat("f", 64), Seed: 7}}
	junit, err := Render(r, ReportJUnit)
	if err != nil || !strings.Contains(string(junit), `failures="1"`) {
		t.Fatalf("junit = %s, %v", junit, err)
	}
	page, _ := Render(r, ReportHTML)
	if strings.Contains(string(page), "<v2>") || !strings.Contains(string(page), "Checkout &lt;v2&gt;") || !strings.Contains(string(page), "FAILED") {
		t.Fatal("the HTML report must escape names and show the verdict")
	}
	csvData, _ := Render(r, ReportCSV)
	if lines := strings.Split(strings.TrimSpace(string(csvData)), "\n"); len(lines) != 3 || !strings.HasPrefix(lines[1], `"Pay, now"`) {
		t.Fatalf("csv = %s", csvData)
	}
	samples, _ := Render(r, ReportSamples)
	if !strings.Contains(string(samples), "latency_ms") {
		t.Fatal("samples csv has no header")
	}
	md, _ := Render(r, ReportMarkdown)
	if !strings.Contains(string(md), "Seed | 7") {
		t.Fatalf("markdown has no run conditions: %s", md)
	}
	if _, err := Render(r, "pdf"); err == nil {
		t.Fatal("an unknown format must be refused")
	}
}

func TestScenarioFileRoundTripsAndRunsARequestHeadless(t *testing.T) {
	var auth atomic.Value
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) { auth.Store(r.Header.Get("Authorization")) }))
	defer srv.Close()
	f := ScenarioFile{
		Name:     "health",
		Target:   ScenarioTarget{Kind: "request", Request: &requestcontract.Request{ID: "h", Name: "Health", Method: "GET", URL: "{{base}}/health", Headers: []requestcontract.KVRow{{Key: "Authorization", Value: "Bearer {{token}}", Enabled: true}}}},
		Workload: Workload{Executor: ExecutorVUs, VUs: 2, Iterations: 4, Seed: 9},
		Gates:    &Gates{MaxErrorPct: new(0.0)},
	}
	dir := t.TempDir()
	path, err := SaveScenarioFile(dir, f)
	if err != nil {
		t.Fatal(err)
	}
	if filepath.Base(path) != "health.loadtest.json" || !strings.Contains(filepath.ToSlash(path), ScenarioDir) {
		t.Fatalf("path = %s", path)
	}
	data, _ := os.ReadFile(path)
	if strings.Contains(string(data), "secret-token") || !strings.Contains(string(data), "{{token}}") {
		t.Fatal("the file must keep the {{variables}}, never resolved values")
	}
	list, err := ListScenarioFiles(dir)
	if err != nil || len(list) != 1 || list[0].Target != "request" {
		t.Fatalf("list = %+v, %v", list, err)
	}
	back, err := ReadScenarioFile(path)
	if err != nil {
		t.Fatal(err)
	}
	s, err := back.Scenario(FlowInput{Vars: map[string]string{"base": srv.URL, "token": "secret-token"}})
	if err != nil {
		t.Fatal(err)
	}
	res, err := Run(context.Background(), s, nil)
	if err != nil || res.Successful != 4 || len(res.GateFailures) != 0 {
		t.Fatalf("result = %+v, %v", res, err)
	}
	if auth.Load() != "Bearer secret-token" || res.Manifest.Seed != 9 {
		t.Fatalf("auth=%q seed=%d", auth, res.Manifest.Seed)
	}
	for _, bad := range []string{"..", "", "///", "a..b"} {
		if _, err := ScenarioFileName(bad); err == nil {
			t.Fatalf("name %q accepted", bad)
		}
	}
	if name, _ := ScenarioFileName("../Checkout (v2)/eu"); name != "Checkout -v2-eu.loadtest.json" {
		t.Fatalf("sanitized name = %q", name)
	}
}

func TestGrpcTargetWithoutAServerFailsOutsideThePercentiles(t *testing.T) {
	call := grpc.CallRequest{Address: "127.0.0.1:1", Service: "x.Svc", Method: "Do", TimeoutMs: 500}
	res, err := Run(context.Background(), Scenario{Grpc: &call, Workload: Workload{Executor: ExecutorProbe, Count: 2}}, nil)
	if err != nil {
		t.Fatal(err)
	}
	if res.Failed != 2 || res.P95Ms != 0 || res.Manifest.Target != "grpc" || len(res.ErrorGroups) == 0 || res.ErrorGroups[0].Code != "CONN_ERR" {
		t.Fatalf("result = %+v", res)
	}
	for status, want := range map[string]int{"NotFound": 5, "DEADLINE_EXCEEDED": 4, "nope": -1} {
		if got := grpcStatusCode(status); got != want {
			t.Fatalf("grpcStatusCode(%q) = %d", status, got)
		}
	}
}
