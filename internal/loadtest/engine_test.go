package loadtest

import (
	"context"
	"errors"
	"net/http"
	"net/http/httptest"
	"sync"
	"sync/atomic"
	"testing"
	"time"

	"github.com/Andrea-Cavallo/adOmnia/internal/httpexec"
)

// fakeSender answers instantly with a fixed status and a reported latency.
type fakeSender struct {
	calls   atomic.Int64
	status  int
	latency time.Duration
	delay   time.Duration // real wait, to keep VUs busy
}

func (f *fakeSender) Send(ctx context.Context) httpexec.Outcome {
	f.calls.Add(1)
	if f.delay > 0 && !sleepCtx(ctx, f.delay) {
		return httpexec.Outcome{ErrCode: "CANCELED", Canceled: true}
	}
	return httpexec.Outcome{Status: f.status, Latency: f.latency, Bytes: 10}
}

func scenario(w Workload) Scenario {
	return Scenario{Request: httpexec.HTTPExecRequest{Method: "GET", URL: "http://127.0.0.1:1/x"}, Workload: w}
}

func TestIterationsAreExactAndWarmupIsNotMeasured(t *testing.T) {
	target := &fakeSender{status: 200, latency: 5 * time.Millisecond}
	res := run(context.Background(), scenario(Workload{Executor: ExecutorVUs, VUs: 8, Iterations: 500, WarmupIterations: 50}), target, nil)

	if got := target.calls.Load(); got != 500 {
		t.Fatalf("sent %d requests, want exactly 500", got)
	}
	if res.TotalRequests != 500 || res.WarmupSkipped != 50 || res.Successful != 450 || res.Failed != 0 {
		t.Fatalf("sent/warmup/ok/failed = %d/%d/%d/%d, want 500/50/450/0", res.TotalRequests, res.WarmupSkipped, res.Successful, res.Failed)
	}
	if res.P50Ms != 5 || res.P99Ms != 5 {
		t.Fatalf("p50/p99 = %v/%v ms, want 5/5 for a constant 5 ms latency", res.P50Ms, res.P99Ms)
	}
}

func TestPercentilesFollowTheLatencyDistribution(t *testing.T) {
	// 90 answers at 10 ms, 10 at 200 ms: p50 is 10 ms, p95 and p99 are 200 ms.
	var n atomic.Int64
	target := senderFunc(func(context.Context) httpexec.Outcome {
		lat := 10 * time.Millisecond
		if n.Add(1)%10 == 0 {
			lat = 200 * time.Millisecond
		}
		return httpexec.Outcome{Status: 200, Latency: lat}
	})
	res := run(context.Background(), scenario(Workload{Executor: ExecutorVUs, VUs: 1, Iterations: 1000}), target, nil)
	if !near(res.P50Ms, 10) || !near(res.P95Ms, 200) || !near(res.P99Ms, 200) || !near(res.MaxMs, 200) {
		t.Fatalf("p50/p95/p99/max = %v/%v/%v/%v, want 10/200/200/200 (±1%%)", res.P50Ms, res.P95Ms, res.P99Ms, res.MaxMs)
	}
}

func TestFailuresAreGroupedByCause(t *testing.T) {
	var n atomic.Int64
	target := senderFunc(func(context.Context) httpexec.Outcome {
		switch n.Add(1) % 4 {
		case 0:
			return httpexec.Outcome{Status: 503, Latency: time.Millisecond}
		case 1:
			return httpexec.Outcome{ErrCode: "TIMEOUT", ErrMsg: "request timed out", Latency: time.Millisecond}
		default:
			return httpexec.Outcome{Status: 200, Latency: time.Millisecond}
		}
	})
	res := run(context.Background(), scenario(Workload{Executor: ExecutorVUs, VUs: 2, Iterations: 400}), target, nil)
	if res.Failed != 200 || res.ErrorRate != 50 {
		t.Fatalf("failed=%d errorRate=%v, want 200 and 50%%", res.Failed, res.ErrorRate)
	}
	if len(res.ErrorGroups) != 2 || res.ErrorGroups[0].Count != 100 || res.ErrorGroups[1].Count != 100 {
		t.Fatalf("error groups = %+v, want HTTP_5xx and TIMEOUT with 100 each", res.ErrorGroups)
	}
	if res.StatusCodes[503] != 100 || res.StatusCodes[200] != 200 {
		t.Fatalf("status codes = %v, want 503×100 and 200×200 (a timeout has no status)", res.StatusCodes)
	}
}

func TestProbeSendsEachRequestOnceAndHonoursTheGap(t *testing.T) {
	target := &fakeSender{status: 204, latency: time.Millisecond}
	res := run(context.Background(), scenario(Workload{Executor: ExecutorProbe, Count: 4, GapMs: 40}), target, nil)
	if target.calls.Load() != 4 || res.Successful != 4 || res.MaxVUs != 4 {
		t.Fatalf("calls=%d ok=%d maxVUs=%d, want 4/4/4", target.calls.Load(), res.Successful, res.MaxVUs)
	}
	if len(res.Timeline) != 4 {
		t.Fatalf("timeline has %d points, want 4", len(res.Timeline))
	}
	last := 0.0
	for _, p := range res.Timeline {
		last = max(last, p.StartMs)
	}
	if last < 120 { // the 4th starts 3 gaps after the 1st
		t.Fatalf("last request started at %.1f ms, want at least 120 ms (3 × 40 ms gap)", last)
	}
}

func TestStopEndsTheRunAndMarksItAborted(t *testing.T) {
	target := &fakeSender{status: 200, latency: time.Millisecond, delay: 20 * time.Millisecond}
	ctx, cancel := context.WithCancel(context.Background())
	time.AfterFunc(150*time.Millisecond, cancel)
	begun := time.Now()
	res := run(ctx, scenario(Workload{Executor: ExecutorVUs, VUs: 5, DurationS: 30}), target, nil)
	if took := time.Since(begun); took > 2*time.Second {
		t.Fatalf("stop took %v, want the run to end right after cancel", took)
	}
	if !res.Aborted || res.Successful == 0 || res.Failed != 0 {
		t.Fatalf("aborted=%v ok=%d failed=%d, want an aborted run with results and no failure from the stop", res.Aborted, res.Successful, res.Failed)
	}
}

func TestStagesRampLinearlyAndSkipUnmeasuredTime(t *testing.T) {
	w := Workload{Executor: ExecutorVUs, Stages: []Stage{
		{DurationS: 10, TargetVUs: 10, Unmeasured: true},
		{DurationS: 10, TargetVUs: 10},
		{DurationS: 10, TargetVUs: 0},
	}}
	tests := []struct {
		at                time.Duration
		vus, stage        int
		measuring, isDone bool
	}{
		{0, 0, 0, false, false},
		{5 * time.Second, 5, 0, false, false},
		{15 * time.Second, 10, 1, true, false},
		{25 * time.Second, 5, 2, true, false},
		{30 * time.Second, 0, 2, false, true},
	}
	for _, tc := range tests {
		vus, stage, measuring, done := targetVUs(w, tc.at)
		if vus != tc.vus || stage != tc.stage || measuring != tc.measuring || done != tc.isDone {
			t.Errorf("at %v: vus=%d stage=%d measuring=%v done=%v, want %d/%d/%v/%v", tc.at, vus, stage, measuring, done, tc.vus, tc.stage, tc.measuring, tc.isDone)
		}
	}
}

func TestStagedRunReachesTheTargetVUs(t *testing.T) {
	target := &fakeSender{status: 200, latency: time.Millisecond, delay: 5 * time.Millisecond}
	res := run(context.Background(), scenario(Workload{Executor: ExecutorVUs, Stages: []Stage{{DurationS: 0.3, TargetVUs: 6}, {DurationS: 0.3, TargetVUs: 6}}}), target, nil)
	if res.MaxVUs != 6 {
		t.Fatalf("max VUs = %d, want 6", res.MaxVUs)
	}
	if res.Successful == 0 || res.Aborted {
		t.Fatalf("ok=%d aborted=%v, want a completed run with results", res.Successful, res.Aborted)
	}
}

func TestProgressIsReportedEverySecond(t *testing.T) {
	target := &fakeSender{status: 200, latency: time.Millisecond, delay: 2 * time.Millisecond}
	var mu sync.Mutex
	var got []Progress
	res := run(context.Background(), scenario(Workload{Executor: ExecutorVUs, VUs: 2, DurationS: 2.2}), target, func(p Progress) {
		mu.Lock()
		got = append(got, p)
		mu.Unlock()
	})
	mu.Lock()
	defer mu.Unlock()
	if len(got) < 2 || got[0].VUs != 2 || got[0].RPS == 0 {
		t.Fatalf("progress = %+v, want at least 2 ticks with 2 VUs and traffic", got)
	}
	if len(res.ThroughputTimeline) < 2 || res.ThroughputTimeline[1].Second != 1 {
		t.Fatalf("throughput timeline = %+v, want consecutive seconds", res.ThroughputTimeline)
	}
}

func TestRunAgainstARealServer(t *testing.T) {
	var hits atomic.Int64
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		hits.Add(1)
		if r.Header.Get("X-Token") != "abc" {
			w.WriteHeader(http.StatusUnauthorized)
			return
		}
		_, _ = w.Write([]byte("ok"))
	}))
	defer srv.Close()

	s := Scenario{
		Request:  httpexec.HTTPExecRequest{Method: "GET", URL: srv.URL, Headers: map[string]string{"X-Token": "abc"}, TimeoutMs: 2000},
		Workload: Workload{Executor: ExecutorVUs, VUs: 10, Iterations: 300},
	}
	res, err := Run(context.Background(), s, nil)
	if err != nil {
		t.Fatal(err)
	}
	if hits.Load() != 300 || res.Successful != 300 || res.BytesReceived != 600 {
		t.Fatalf("hits=%d ok=%d bytes=%d, want 300/300/600 (headers sent, body read)", hits.Load(), res.Successful, res.BytesReceived)
	}
}

func TestValidateRejectsScenariosThatCannotRun(t *testing.T) {
	ok := getReq("http://localhost:8080/health")
	tests := []struct {
		name string
		s    Scenario
	}{
		{"empty url", Scenario{Workload: Workload{Executor: ExecutorVUs, VUs: 1, Iterations: 1}}},
		{"unresolved variable", Scenario{Request: getReq("{{baseUrl}}/x"), Workload: Workload{Executor: ExecutorVUs, VUs: 1, Iterations: 1}}},
		{"not http", Scenario{Request: getReq("ftp://host/x"), Workload: Workload{Executor: ExecutorVUs, VUs: 1, Iterations: 1}}},
		{"unknown executor", Scenario{Request: ok, Workload: Workload{Executor: "rps"}}},
		{"no end", Scenario{Request: ok, Workload: Workload{Executor: ExecutorVUs, VUs: 5}}},
		{"too many vus", Scenario{Request: ok, Workload: Workload{Executor: ExecutorVUs, VUs: MaxVUs + 1, Iterations: 1}}},
		{"warmup swallows all", Scenario{Request: ok, Workload: Workload{Executor: ExecutorVUs, VUs: 1, Iterations: 5, WarmupIterations: 5}}},
		{"zero stage", Scenario{Request: ok, Workload: Workload{Executor: ExecutorVUs, Stages: []Stage{{DurationS: 0, TargetVUs: 1}}}}},
		{"probe without count", Scenario{Request: ok, Workload: Workload{Executor: ExecutorProbe}}},
	}
	for _, tc := range tests {
		if err := tc.s.Validate(); err == nil {
			t.Errorf("%s: Validate() = nil, want an error", tc.name)
		}
	}
	if err := (Scenario{Request: ok, Workload: Workload{Executor: ExecutorVUs, VUs: 1, DurationS: 1}}).Validate(); err != nil {
		t.Fatalf("a valid scenario was rejected: %v", err)
	}
}

func TestManagerRunsOneAtATimeAndStops(t *testing.T) {
	m := NewManager()
	m.runFn = func(ctx context.Context, s Scenario, p func(Progress)) (Result, error) {
		return run(ctx, s, &fakeSender{status: 200, latency: time.Millisecond, delay: 10 * time.Millisecond}, p), nil
	}
	finished := make(chan Finished, 1)
	m.SetEmitter(func(event string, payload any) {
		if event == EventFinished {
			finished <- payload.(Finished)
		}
	})
	s := Scenario{Request: getReq("http://localhost:1/x"), Workload: Workload{Executor: ExecutorVUs, VUs: 2, DurationS: 60}}
	id, err := m.Start(s)
	if err != nil {
		t.Fatal(err)
	}
	if _, err := m.Start(s); !errors.Is(err, ErrBusy) {
		t.Fatalf("second Start err = %v, want ErrBusy", err)
	}
	time.Sleep(100 * time.Millisecond)
	m.Stop(id)
	select {
	case f := <-finished:
		if f.RunID != id || f.Result == nil || !f.Result.Aborted {
			t.Fatalf("finished = %+v, want the aborted result of %s", f, id)
		}
	case <-time.After(3 * time.Second):
		t.Fatal("no finished event after Stop")
	}
	// The slot is free as soon as "finished" arrives: a new run can start right away.
	if m.Running() != "" {
		t.Fatalf("Running() = %q after the run ended, want empty", m.Running())
	}
	next, err := m.Start(s)
	if err != nil {
		t.Fatalf("Start right after finished: %v", err)
	}
	m.Stop(next)
	<-finished
}

type senderFunc func(context.Context) httpexec.Outcome

func (f senderFunc) Send(ctx context.Context) httpexec.Outcome { return f(ctx) }

func getReq(u string) httpexec.HTTPExecRequest {
	return httpexec.HTTPExecRequest{Method: "GET", URL: u}
}

func near(got, want float64) bool { return got >= want*0.99 && got <= want*1.01 }
