package loadtest

import (
	"context"
	"testing"
	"time"
)

func TestArrivalRateHoldsTheRate(t *testing.T) {
	target := &fakeSender{status: 200, latency: time.Millisecond, delay: time.Millisecond}
	res := run(context.Background(), scenario(Workload{Executor: ExecutorArrivalRate, RPS: 200, DurationS: 2, MaxVUs: 20}), requestTarget{send: target}, nil)
	if got := target.calls.Load(); got < 392 || got > 408 {
		t.Fatalf("sent %d iterations in 2 s at 200/s, want 400 ±2%%", got)
	}
	if res.DroppedIterations != 0 || res.Failed != 0 {
		t.Fatalf("dropped=%d failed=%d, want none with a free pool", res.DroppedIterations, res.Failed)
	}
	if res.Throughput < 190 || res.Throughput > 210 {
		t.Fatalf("throughput %.1f req/s, want ~200", res.Throughput)
	}
}

// The open model does not slow down with the target: with a large pool every scheduled
// iteration starts even though each takes 100 ms.
func TestArrivalRateDoesNotWaitForASlowTarget(t *testing.T) {
	target := &fakeSender{status: 200, latency: 100 * time.Millisecond, delay: 100 * time.Millisecond}
	res := run(context.Background(), scenario(Workload{Executor: ExecutorArrivalRate, RPS: 100, DurationS: 1, MaxVUs: 50}), requestTarget{send: target}, nil)
	if got := target.calls.Load(); got < 98 || got > 102 {
		t.Fatalf("started %d iterations, want ~100: the rate must not depend on the target's speed", got)
	}
	if res.MaxVUs < 9 {
		t.Fatalf("peak VUs %d, want ~10 busy at once (100/s × 100 ms)", res.MaxVUs)
	}
}

func TestArrivalRateDropsWhenThePoolIsExhausted(t *testing.T) {
	target := &fakeSender{status: 200, latency: 200 * time.Millisecond, delay: 200 * time.Millisecond}
	res := run(context.Background(), scenario(Workload{Executor: ExecutorArrivalRate, RPS: 100, DurationS: 1, MaxVUs: 5}), requestTarget{send: target}, nil)
	if res.DroppedIterations < 60 {
		t.Fatalf("dropped %d of ~100 arrivals with 5 VUs busy 200 ms each, want most of them dropped and reported", res.DroppedIterations)
	}
	if res.MaxVUs != 5 || int(target.calls.Load())+res.DroppedIterations < 98 {
		t.Fatalf("maxVUs=%d calls=%d dropped=%d, want the pool capped at 5 and every arrival either run or dropped", res.MaxVUs, target.calls.Load(), res.DroppedIterations)
	}
}

// lateTarget starts its request 30 ms after it is asked to, like a saturated generator.
type lateTarget struct{}

func (lateTarget) iterate(_ context.Context, _, _ int) ([]sample, bool) {
	return []sample{{step: "x", started: time.Now().Add(30 * time.Millisecond), latency: 5 * time.Millisecond, status: 200, sent: true}}, false
}

func TestArrivalRateTimesFromTheScheduledInstant(t *testing.T) {
	res := run(context.Background(), scenario(Workload{Executor: ExecutorArrivalRate, RPS: 20, DurationS: 0.5, MaxVUs: 5}), lateTarget{}, nil)
	if res.P50Ms < 34 || res.P50Ms > 37 {
		t.Fatalf("p50 = %.1f ms, want ~35 (5 ms of request + 30 ms late start): coordinated omission must not hide the delay", res.P50Ms)
	}
	if res.SchedulerLagP99Ms < 29 {
		t.Fatalf("scheduler lag p99 = %.1f ms, want ~30 reported", res.SchedulerLagP99Ms)
	}
}

func TestTargetRateFollowsTheStages(t *testing.T) {
	ramp := 2.0
	w := Workload{Executor: ExecutorArrivalRate, MaxVUs: 10, Stages: []Stage{
		{Label: "warm", DurationS: 4, TargetRPS: 100, Unmeasured: true},
		{Label: "hold", DurationS: 6, TargetRPS: 300, RampS: &ramp},
	}}
	for _, tc := range []struct {
		at        float64
		rate      float64
		stage     int
		measuring bool
		done      bool
	}{{0, 0, 0, false, false}, {2, 50, 0, false, false}, {5, 200, 1, true, false}, {7, 300, 1, true, false}, {10, 0, 1, false, true}} {
		rate, stage, measuring, done := targetRate(w, tc.at)
		if rate != tc.rate || stage != tc.stage || measuring != tc.measuring || done != tc.done {
			t.Errorf("at %vs: rate=%v stage=%d measuring=%v done=%v, want %v/%d/%v/%v", tc.at, rate, stage, measuring, done, tc.rate, tc.stage, tc.measuring, tc.done)
		}
	}
}

func TestValidateArrivalRate(t *testing.T) {
	ok := Workload{Executor: ExecutorArrivalRate, RPS: 50, DurationS: 10, MaxVUs: 20}
	if err := scenario(ok).Validate(); err != nil {
		t.Fatalf("valid arrival-rate rejected: %v", err)
	}
	for name, w := range map[string]Workload{
		"no pool":         {Executor: ExecutorArrivalRate, RPS: 50, DurationS: 10},
		"no rate":         {Executor: ExecutorArrivalRate, DurationS: 10, MaxVUs: 5},
		"no duration":     {Executor: ExecutorArrivalRate, RPS: 50, MaxVUs: 5},
		"rate too high":   {Executor: ExecutorArrivalRate, RPS: MaxRPS + 1, DurationS: 1, MaxVUs: 5},
		"all stages at 0": {Executor: ExecutorArrivalRate, MaxVUs: 5, Stages: []Stage{{DurationS: 5}}},
		"warmup swallows": {Executor: ExecutorArrivalRate, RPS: 5, DurationS: 5, WarmupS: 5, MaxVUs: 5},
	} {
		if err := scenario(w).Validate(); err == nil {
			t.Errorf("%s: Validate() = nil, want an error", name)
		}
	}
}

func TestPlanRateModeIsTheOpenModel(t *testing.T) {
	plan := Plan{Format: PlanFormat, Version: 1, FlowName: "f", Graph: Graph{Nodes: []Node{{ID: "r", Type: "request", Config: NodeConfig{Request: req("GET", "http://localhost:1/x")}}}},
		Config: StressConfig{Mode: "rate", VUs: 40, RPS: 25, DurationS: 30, RampUpS: 5}}
	s, err := plan.Scenario(FlowInput{})
	if err != nil {
		t.Fatal(err)
	}
	w := s.Workload
	if w.Executor != ExecutorArrivalRate || w.MaxVUs != 40 || len(w.Stages) != 2 || w.Stages[1].TargetRPS != 25 || w.WarmupS != 5 {
		t.Fatalf("workload = %+v, want arrival-rate, pool 40, ramp then 25/s, ramp not measured", w)
	}
}
