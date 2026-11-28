package loadtest

import (
	"context"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync"
	"sync/atomic"
	"testing"
	"time"

	"github.com/Andrea-Cavallo/adOmnia/internal/requestcontract"
)

// authServer issues one token per login (POST /login with {"user"}) and accepts GET /me only
// with the token issued to that same user, so a token shared between VUs is caught.
func authServer(t *testing.T) (*httptest.Server, *atomic.Int64) {
	t.Helper()
	var (
		mu     sync.Mutex
		tokens = map[string]string{}
		seq    atomic.Int64
		bad    atomic.Int64
	)
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		switch r.URL.Path {
		case "/login":
			user := r.URL.Query().Get("user")
			token := "tok-" + user + "-" + time.Now().Format("150405.000000") + "-" + string(rune('a'+seq.Add(1)%26))
			mu.Lock()
			tokens[token] = user
			mu.Unlock()
			w.Header().Set("Content-Type", "application/json")
			_, _ = w.Write([]byte(`{"data":{"token":"` + token + `"}}`))
		case "/me":
			token := strings.TrimPrefix(r.Header.Get("Authorization"), "Bearer ")
			mu.Lock()
			user, ok := tokens[token]
			mu.Unlock()
			if !ok || user != r.URL.Query().Get("user") {
				bad.Add(1)
				w.WriteHeader(http.StatusUnauthorized)
				return
			}
			_, _ = w.Write([]byte(`{"ok":true}`))
		case "/flaky":
			if seq.Add(1)%2 == 0 {
				w.WriteHeader(http.StatusServiceUnavailable)
				return
			}
			_, _ = w.Write([]byte(`ok`))
		default:
			w.WriteHeader(http.StatusNotFound)
		}
	}))
	t.Cleanup(srv.Close)
	return srv, &bad
}

func req(method, url string, headers ...requestcontract.KVRow) *requestcontract.Request {
	return &requestcontract.Request{Method: method, URL: url, Headers: headers}
}

func loginFlow(base string) *Flow {
	return &Flow{
		Name: "login",
		Vars: map[string]string{"base": base},
		Graph: Graph{
			Nodes: []Node{
				{ID: "s", Type: "start"},
				{ID: "login", Type: "request", Label: "Login", Config: NodeConfig{
					Request:     req("POST", "{{base}}/login?user=u{{__vu}}"),
					Extractions: []Mapping{{Name: "token", Source: "body", Path: "$.data.token"}},
				}},
				{ID: "me", Type: "request", Label: "Me", Config: NodeConfig{
					Request: req("GET", "{{base}}/me?user=u{{__vu}}", requestcontract.KVRow{Key: "Authorization", Value: "Bearer {{token}}", Enabled: true}),
				}},
				{ID: "e", Type: "end"},
			},
			Edges: []Edge{{Source: "s", Target: "login", Branch: "next"}, {Source: "login", Target: "me", Branch: "success"}, {Source: "me", Target: "e", Branch: "success"}},
		},
	}
}

func TestFlowExtractsATokenPerVUAndReportsEachStep(t *testing.T) {
	srv, bad := authServer(t)
	res, err := Run(context.Background(), Scenario{Flow: loginFlow(srv.URL), Workload: Workload{Executor: ExecutorVUs, VUs: 20, Iterations: 400}}, nil)
	if err != nil {
		t.Fatal(err)
	}
	if bad.Load() != 0 || res.Failed != 0 {
		t.Fatalf("%d requests used a token of another VU, %d failed (errors %+v), want none", bad.Load(), res.Failed, res.ErrorGroups)
	}
	if res.Iterations != 400 || res.TotalRequests != 800 || res.Successful != 800 {
		t.Fatalf("iterations/requests/ok = %d/%d/%d, want 400/800/800", res.Iterations, res.TotalRequests, res.Successful)
	}
	if len(res.Steps) != 2 || res.Steps[0].Step != "Login" || res.Steps[0].Count != 400 || res.Steps[1].Step != "Me" || res.Steps[1].Count != 400 {
		t.Fatalf("steps = %+v, want Login and Me with 400 requests each", res.Steps)
	}
	if res.Apdex == nil || res.Apdex.Score < 0.9 || len(res.Distribution) == 0 {
		t.Fatalf("apdex=%+v distribution=%d bins, want a good score on a local server and a distribution", res.Apdex, len(res.Distribution))
	}
}

func TestFlowFailureTakesTheErrorBranchAndFailsTheIteration(t *testing.T) {
	srv, _ := authServer(t)
	f := &Flow{Vars: map[string]string{"base": srv.URL}, Graph: Graph{
		Nodes: []Node{
			{ID: "s", Type: "start"},
			{ID: "missing", Type: "request", Label: "Missing", Config: NodeConfig{Request: req("GET", "{{base}}/nope")}},
			{ID: "recover", Type: "request", Label: "Recover", Config: NodeConfig{Request: req("GET", "{{base}}/me?user=x")}},
			{ID: "never", Type: "request", Label: "Never", Config: NodeConfig{Request: req("GET", "{{base}}/me")}},
		},
		Edges: []Edge{{Source: "s", Target: "missing", Branch: "next"}, {Source: "missing", Target: "never", Branch: "success"}, {Source: "missing", Target: "recover", Branch: "error"}},
	}}
	res, err := Run(context.Background(), Scenario{Flow: f, Workload: Workload{Executor: ExecutorVUs, VUs: 2, Iterations: 10}}, nil)
	if err != nil {
		t.Fatal(err)
	}
	if res.FailedIterations != 10 || len(res.Steps) != 2 || res.Steps[0].Step != "Missing" || res.Steps[1].Step != "Recover" {
		t.Fatalf("failed iterations=%d steps=%+v, want 10 failed and Missing→Recover (error branch)", res.FailedIterations, res.Steps)
	}
	if len(res.ErrorGroups) == 0 || res.ErrorGroups[0].Code != "HTTP_4xx" || res.ErrorGroups[0].Steps[0] != "Missing" {
		t.Fatalf("error groups = %+v, want HTTP_4xx on Missing first", res.ErrorGroups)
	}
}

func TestFlowRetriesAndConditionBranches(t *testing.T) {
	srv, _ := authServer(t)
	f := &Flow{Vars: map[string]string{"base": srv.URL}, Graph: Graph{
		Nodes: []Node{
			{ID: "s", Type: "start"},
			{ID: "flaky", Type: "request", Label: "Flaky", Config: NodeConfig{Request: req("GET", "{{base}}/flaky"), RetryCount: 3}},
			{ID: "c", Type: "condition", Config: NodeConfig{Condition: &Condition{Source: "status", Operator: "eq", Value: "200"}}},
			{ID: "yes", Type: "request", Label: "Yes", Config: NodeConfig{Request: req("GET", "{{base}}/me?user=x"), ExpectedStatus: "401"}},
		},
		Edges: []Edge{{Source: "s", Target: "flaky", Branch: "next"}, {Source: "flaky", Target: "c", Branch: "success"}, {Source: "c", Target: "yes", Branch: "true"}},
	}}
	res, err := Run(context.Background(), Scenario{Flow: f, Workload: Workload{Executor: ExecutorVUs, VUs: 1, Iterations: 20}}, nil)
	if err != nil {
		t.Fatal(err)
	}
	if res.Failed != 0 || len(res.Steps) != 2 || res.Steps[1].Count != 20 {
		t.Fatalf("failed=%d steps=%+v, want the retry to absorb every 503 and the true branch taken 20 times", res.Failed, res.Steps)
	}
}

func TestDatasetRowsReachTheRequests(t *testing.T) {
	var mu sync.Mutex
	seen := map[string]int{}
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		mu.Lock()
		seen[r.URL.Query().Get("sku")]++
		mu.Unlock()
	}))
	defer srv.Close()
	f := &Flow{
		Vars:    map[string]string{"base": srv.URL},
		Dataset: []map[string]string{{"sku": "A"}, {"sku": "B"}, {"sku": "C"}},
		Graph:   Graph{Nodes: []Node{{ID: "r", Type: "request", Label: "Buy", Config: NodeConfig{Request: req("GET", "{{base}}/buy?sku={{sku}}")}}}},
	}
	if _, err := Run(context.Background(), Scenario{Flow: f, Workload: Workload{Executor: ExecutorVUs, VUs: 3, Iterations: 30}}, nil); err != nil {
		t.Fatal(err)
	}
	if seen["A"] != 10 || seen["B"] != 10 || seen["C"] != 10 {
		t.Fatalf("rows used = %v, want each of A, B, C 10 times (shared mode cycles by iteration)", seen)
	}
}

func TestGatesReportWhatTheRunBroke(t *testing.T) {
	zero := 0.0
	target := &fakeSender{status: 500, latency: 300 * time.Millisecond}
	s := scenario(Workload{Executor: ExecutorVUs, VUs: 2, Iterations: 20})
	s.Gates = &Gates{MaxP95Ms: 100, MaxErrorPct: &zero, MinApdex: 0.5}
	res := run(context.Background(), s, requestTarget{send: target}, nil)
	if len(res.GateFailures) != 3 {
		t.Fatalf("gate failures = %v, want p95, error rate and APDEX", res.GateFailures)
	}
	s.Gates = nil
	if res := run(context.Background(), s, requestTarget{send: target}, nil); res.GateFailures != nil {
		t.Fatalf("without gates got failures %v", res.GateFailures)
	}
}

func TestStageRampThenHold(t *testing.T) {
	ramp := 2.0
	w := Workload{Executor: ExecutorVUs, Stages: []Stage{{Label: "up", DurationS: 10, TargetVUs: 10, RampS: &ramp}}}
	for _, tc := range []struct {
		at   time.Duration
		want int
	}{{time.Second, 5}, {3 * time.Second, 10}, {9 * time.Second, 10}} {
		if got, _, _, _ := targetVUs(w, tc.at); got != tc.want {
			t.Errorf("at %v: %d VUs, want %d", tc.at, got, tc.want)
		}
	}
	jump := 0.0
	w.Stages[0].RampS = &jump
	if got, _, _, _ := targetVUs(w, 0); got != 10 {
		t.Errorf("rampS 0: %d VUs at the start, want an immediate jump to 10", got)
	}
}

func TestFlowValidation(t *testing.T) {
	bad := []*Flow{
		{},
		{Graph: Graph{Nodes: []Node{{ID: "s", Type: "start"}}}},
		{Graph: Graph{Nodes: []Node{{ID: "r", Type: "loop"}}}},
		{Graph: Graph{Nodes: []Node{{ID: "r", Type: "request"}, {ID: "r", Type: "end"}}}},
		{Graph: Graph{Nodes: []Node{{ID: "r", Type: "request"}}, Edges: []Edge{{Source: "r", Target: "x"}}}},
		{Graph: Graph{Nodes: []Node{{ID: "a", Type: "request"}, {ID: "b", Type: "request"}}, Edges: []Edge{{Source: "a", Target: "b"}, {Source: "b", Target: "a"}}}},
	}
	for i, f := range bad {
		if err := (Scenario{Flow: f, Workload: Workload{Executor: ExecutorVUs, VUs: 1, Iterations: 1}}).Validate(); err == nil {
			t.Errorf("flow %d: Validate() = nil, want an error", i)
		}
	}
}

// adomnia stress used to drop AWS4 auth (it set the type to none and never signed).
func TestFlowSignsAWS4AndCachesOAuth2Tokens(t *testing.T) {
	var signed, bearer, tokenCalls atomic.Int64
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		switch {
		case r.URL.Path == "/token":
			tokenCalls.Add(1)
			_, _ = w.Write([]byte(`{"access_token":"T","expires_in":3600}`))
		case strings.HasPrefix(r.Header.Get("Authorization"), "AWS4-HMAC-SHA256 Credential=AKID/"):
			signed.Add(1)
		case r.Header.Get("Authorization") == "Bearer T":
			bearer.Add(1)
		default:
			w.WriteHeader(http.StatusUnauthorized)
		}
	}))
	defer srv.Close()
	aws := req("GET", srv.URL+"/aws")
	aws.Auth = requestcontract.Auth{Type: "aws4", AWSAccessKeyID: "AKID", AWSSecretKey: "S", AWSRegion: "eu-west-1"}
	oauth := req("GET", srv.URL+"/api")
	oauth.Auth = requestcontract.Auth{Type: "oauth2", OAuth2GrantType: "client_credentials", OAuth2TokenURL: srv.URL + "/token", OAuth2ClientID: "lt-cache-test"}
	f := &Flow{Graph: Graph{
		Nodes: []Node{{ID: "a", Type: "request", Label: "AWS", Config: NodeConfig{Request: aws}}, {ID: "o", Type: "request", Label: "OAuth", Config: NodeConfig{Request: oauth}}},
		Edges: []Edge{{Source: "a", Target: "o", Branch: "success"}},
	}}
	res, err := Run(context.Background(), Scenario{Flow: f, Workload: Workload{Executor: ExecutorVUs, VUs: 4, Iterations: 40}}, nil)
	if err != nil {
		t.Fatal(err)
	}
	if res.Failed != 0 || signed.Load() != 40 || bearer.Load() != 40 {
		t.Fatalf("failed=%d signed=%d bearer=%d (errors %+v), want 0/40/40", res.Failed, signed.Load(), bearer.Load(), res.ErrorGroups)
	}
	if tokenCalls.Load() > 4 { // at most one per VU racing the first fetch, then cached
		t.Fatalf("token endpoint called %d times for 40 requests, want the token cached", tokenCalls.Load())
	}
}
