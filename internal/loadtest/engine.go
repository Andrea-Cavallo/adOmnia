package loadtest

import (
	"context"
	"fmt"
	"math"
	"sync"
	"sync/atomic"
	"time"

	"github.com/Andrea-Cavallo/adOmnia/internal/httpexec"
)

// target is what one VU iteration runs: the single request, or the whole flow.
type target interface {
	iterate(ctx context.Context, vu, iteration int) (samples []sample, failed bool)
}

// sender is one request already resolved by the app. *httpexec.Client implements it.
type sender interface {
	Send(ctx context.Context) httpexec.Outcome
}

// requestTarget turns a sender into a one-step target.
type requestTarget struct {
	send sender
	step string
}

func (t requestTarget) iterate(ctx context.Context, _, _ int) ([]sample, bool) {
	started := time.Now()
	out := t.send.Send(ctx)
	s := sample{stepID: "request", step: t.step, started: started, latency: out.Latency, status: out.Status, bytes: out.Bytes, errCode: out.ErrCode, errMsg: out.ErrMsg, canceled: out.Canceled}
	// INVALID_URL and PSD2_ERR fail before the network; everything else reached it.
	s.sent = out.ErrCode != "INVALID_URL" && out.ErrCode != "PSD2_ERR"
	if s.errCode == "" && (s.status < 200 || s.status >= 400) {
		s.errCode = "HTTP"
	}
	return []sample{s}, !s.ok()
}

// controlTick is how often the VU controller follows the stage ramp.
const controlTick = 50 * time.Millisecond

// Run executes the scenario until it completes or ctx is canceled (Stop), calling progress
// once per second. A canceled run returns the partial result with Aborted set.
func Run(ctx context.Context, s Scenario, progress func(Progress)) (Result, error) {
	if err := s.Validate(); err != nil {
		return Result{}, err
	}
	conns := max(s.Workload.VUs, s.Workload.Count, s.Workload.MaxVUs, 1)
	for _, st := range s.Workload.Stages {
		conns = max(conns, st.TargetVUs)
	}
	if s.Flow != nil {
		pool := httpexec.NewPool(conns)
		defer pool.Close()
		return run(ctx, s, newFlowTarget(s.Flow, pool), progress), nil
	}
	client, err := httpexec.NewClient(*s.Request, conns)
	if err != nil {
		return Result{}, err
	}
	defer client.Close()
	step := s.Name
	if step == "" {
		step = s.Request.Method + " " + s.Request.URL
	}
	return run(ctx, s, requestTarget{send: client, step: step}, progress), nil
}

func run(ctx context.Context, s Scenario, t target, progress func(Progress)) Result {
	start := time.Now()
	apdexT := 0.0
	if s.Gates != nil {
		apdexT = s.Gates.ApdexTMs
	}
	rec := newRecorder(start, apdexT, maxTimelineSize)
	state := &runState{}

	stopProgress := make(chan struct{})
	progressDone := make(chan struct{})
	go func() {
		defer close(progressDone)
		reportProgress(rec, state, s.Workload, start, stopProgress, progress)
	}()

	switch s.Workload.Executor {
	case ExecutorProbe:
		runProbe(ctx, s.Workload, t, rec, state)
	case ExecutorArrivalRate:
		runArrival(ctx, s.Workload, t, rec, state)
	default:
		runVUs(ctx, s.Workload, t, rec, state)
	}
	close(stopProgress)
	<-progressDone

	rec.flush() // the last, partial second
	res := rec.result(time.Now())
	res.Name = s.Name
	res.Executor = s.Workload.Executor
	res.Aborted = ctx.Err() != nil
	res.MaxVUs = max(res.MaxVUs, int(state.peak.Load()))
	res.GateFailures = evaluateGates(s.Gates, res)
	return res
}

// evaluateGates lists the rules the run broke; nothing measured fails every active gate.
func evaluateGates(g *Gates, r Result) []string {
	if g == nil {
		return nil
	}
	var out []string
	measured := r.Successful + r.Failed
	if measured == 0 {
		return []string{"no measured request to evaluate the gates"}
	}
	if g.MaxP95Ms > 0 && r.P95Ms > g.MaxP95Ms {
		out = append(out, fmt.Sprintf("p95 %.0fms exceeds %.0fms", r.P95Ms, g.MaxP95Ms))
	}
	if g.MaxErrorPct != nil && r.ErrorRate > *g.MaxErrorPct {
		out = append(out, fmt.Sprintf("error rate %.1f%% exceeds %.1f%%", r.ErrorRate, *g.MaxErrorPct))
	}
	if g.MinRPS > 0 && r.Throughput < g.MinRPS {
		out = append(out, fmt.Sprintf("throughput %.1f req/s is below %.1f", r.Throughput, g.MinRPS))
	}
	if g.MinApdex > 0 && r.Apdex != nil && r.Apdex.Score < g.MinApdex {
		out = append(out, fmt.Sprintf("APDEX %.3f is below %.3f", r.Apdex.Score, g.MinApdex))
	}
	return out
}

// runState is what the progress reporter reads while the executor runs.
type runState struct {
	vus       atomic.Int64
	stage     atomic.Int64
	measuring atomic.Bool
	peak      atomic.Int64 // most VUs at once, even between two progress ticks
}

func (s *runState) setVUs(n int) {
	s.vus.Store(int64(n))
	for {
		peak := s.peak.Load()
		if int64(n) <= peak || s.peak.CompareAndSwap(peak, int64(n)) {
			return
		}
	}
}

func reportProgress(rec *recorder, state *runState, w Workload, start time.Time, stop <-chan struct{}, progress func(Progress)) {
	ticker := time.NewTicker(time.Second)
	defer ticker.Stop()
	for {
		select {
		case <-stop:
			return
		case now := <-ticker.C:
			b := rec.tick(int(state.vus.Load()))
			if progress == nil {
				continue
			}
			sent, failed, measured, iterations, dropped := rec.totals()
			stage := int(state.stage.Load())
			p := Progress{
				ElapsedS:   round2(now.Sub(start).Seconds()),
				VUs:        b.VUs,
				Stage:      stage,
				Measuring:  state.measuring.Load(),
				Sent:       sent,
				Failed:     failed,
				Iterations: iterations,
				Dropped:    dropped,
				RPS:        float64(b.Reqs),
				P95Ms:      b.P95Ms,
				Last:       b,
				Snapshot:   rec.snapshot(now),
			}
			if stage >= 0 && stage < len(w.Stages) {
				p.StageLabel = w.Stages[stage].Label
			}
			if measured > 0 {
				p.ErrorRate = round2(float64(failed) / float64(measured) * 100)
			}
			progress(p)
		}
	}
}

// runProbe runs Count single iterations, the i-th GapMs·i after the start (0 = all at once).
func runProbe(ctx context.Context, w Workload, t target, rec *recorder, state *runState) {
	state.stage.Store(-1)
	state.measuring.Store(true)
	state.setVUs(w.Count)
	var wg sync.WaitGroup
	for i := range w.Count {
		wg.Go(func() {
			if w.GapMs > 0 && !sleepCtx(ctx, time.Duration(i*w.GapMs)*time.Millisecond) {
				return
			}
			samples, failed := t.iterate(ctx, i, i)
			rec.iteration(samples, failed, true, i+1, i+1)
		})
	}
	wg.Wait()
	state.setVUs(0)
}

// runVUs is the closed model: a controller keeps the number of running VUs on the stage ramp,
// each VU repeats the target until it is told to stop, the iterations run out or ctx ends.
func runVUs(ctx context.Context, w Workload, t target, rec *recorder, state *runState) {
	start := time.Now()
	var (
		wg         sync.WaitGroup
		stops      []chan struct{}
		iterations atomic.Int64
		exhausted  = make(chan struct{})
		closeOnce  sync.Once
	)
	vu := func(id int, stop <-chan struct{}) {
		for first := true; ; first = false {
			if !first && w.ThinkTimeMs > 0 && !sleepCtx(ctx, time.Duration(w.ThinkTimeMs)*time.Millisecond) {
				return
			}
			select {
			case <-ctx.Done():
				return
			case <-stop:
				return
			case <-exhausted:
				return
			default:
			}
			n := iterations.Add(1)
			if w.Iterations > 0 && n > int64(w.Iterations) {
				closeOnce.Do(func() { close(exhausted) })
				return
			}
			measured := state.measuring.Load() && n > int64(w.WarmupIterations)
			samples, failed := t.iterate(ctx, id, int(n-1))
			rec.iteration(samples, failed, measured, id+1, int(n))
		}
	}

	ticker := time.NewTicker(controlTick)
	defer ticker.Stop()
control:
	for {
		want, stage, measuring, done := targetVUs(w, time.Since(start))
		state.stage.Store(int64(stage))
		state.measuring.Store(measuring)
		if done {
			break control
		}
		for len(stops) < want {
			stop := make(chan struct{})
			id := len(stops)
			stops = append(stops, stop)
			wg.Go(func() { vu(id, stop) })
		}
		for len(stops) > want { // a stopped VU finishes the iteration it is in
			last := len(stops) - 1
			close(stops[last])
			stops = stops[:last]
		}
		state.setVUs(len(stops))
		select {
		case <-ctx.Done():
			break control
		case <-exhausted:
			break control
		case <-ticker.C:
		}
	}
	for _, stop := range stops {
		close(stop)
	}
	wg.Wait()
	state.setVUs(0)
}

// targetVUs is where the ramp is at elapsed: how many VUs, which stage, whether that time
// is measured and whether the workload is over.
func targetVUs(w Workload, elapsed time.Duration) (vus, stage int, measuring, done bool) {
	e := elapsed.Seconds()
	if len(w.Stages) == 0 {
		return w.VUs, -1, e >= w.WarmupS, w.DurationS > 0 && e >= w.DurationS
	}
	from, begin := 0, 0.0
	for i, st := range w.Stages {
		if e < begin+st.DurationS {
			ramp := st.DurationS
			if st.RampS != nil {
				ramp = *st.RampS
			}
			within := e - begin
			measuring := !st.Unmeasured && e >= w.WarmupS
			if ramp <= 0 || within >= ramp {
				return st.TargetVUs, i, measuring, false
			}
			return int(math.Round(float64(from) + float64(st.TargetVUs-from)*within/ramp)), i, measuring, false
		}
		from, begin = st.TargetVUs, begin+st.DurationS
	}
	return 0, len(w.Stages) - 1, false, true
}

// sleepCtx waits d, or returns false as soon as ctx ends.
func sleepCtx(ctx context.Context, d time.Duration) bool {
	t := time.NewTimer(d)
	defer t.Stop()
	select {
	case <-ctx.Done():
		return false
	case <-t.C:
		return true
	}
}
