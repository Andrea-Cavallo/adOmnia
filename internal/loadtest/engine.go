package loadtest

import (
	"context"
	"math"
	"sync"
	"sync/atomic"
	"time"

	"github.com/Andrea-Cavallo/adOmnia/internal/httpexec"
)

// sender is one request of the target. *httpexec.Client implements it; tests use fakes.
type sender interface {
	Send(ctx context.Context) httpexec.Outcome
}

// controlTick is how often the VU controller follows the stage ramp.
const controlTick = 50 * time.Millisecond

// Run executes the scenario until it completes or ctx is canceled (Stop), calling progress
// once per second. A canceled run returns the partial result with Aborted set.
func Run(ctx context.Context, s Scenario, progress func(Progress)) (Result, error) {
	if err := s.Validate(); err != nil {
		return Result{}, err
	}
	maxConns := s.Workload.VUs
	for _, st := range s.Workload.Stages {
		maxConns = max(maxConns, st.TargetVUs)
	}
	client, err := httpexec.NewClient(s.Request, max(maxConns, s.Workload.Count))
	if err != nil {
		return Result{}, err
	}
	defer client.Close()
	return run(ctx, s, client, progress), nil
}

func run(ctx context.Context, s Scenario, target sender, progress func(Progress)) Result {
	start := time.Now()
	rec := newRecorder(start)
	state := &runState{}

	stopProgress := make(chan struct{})
	progressDone := make(chan struct{})
	go func() {
		defer close(progressDone)
		reportProgress(rec, state, start, stopProgress, progress)
	}()

	if s.Workload.Executor == ExecutorProbe {
		runProbe(ctx, s.Workload, target, rec, state)
	} else {
		runVUs(ctx, s.Workload, target, rec, state)
	}
	close(stopProgress)
	<-progressDone

	end := time.Now()
	rec.flush() // the last, partial second
	res := rec.result(end)
	res.Name = s.Name
	res.Executor = s.Workload.Executor
	res.Aborted = ctx.Err() != nil
	res.MaxVUs = max(res.MaxVUs, int(state.peak.Load()))
	return res
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

func reportProgress(rec *recorder, state *runState, start time.Time, stop <-chan struct{}, progress func(Progress)) {
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
			sent, failed, measured := rec.totals()
			p := Progress{
				ElapsedS:  round2(now.Sub(start).Seconds()),
				VUs:       b.VUs,
				Stage:     int(state.stage.Load()),
				Measuring: state.measuring.Load(),
				Sent:      sent,
				Failed:    failed,
				RPS:       float64(b.Reqs),
				P95Ms:     b.P95Ms,
				Last:      b,
			}
			if measured > 0 {
				p.ErrorRate = round2(float64(failed) / float64(measured) * 100)
			}
			progress(p)
		}
	}
}

// runProbe sends Count single requests, the i-th GapMs·i after the start (0 = all at once).
func runProbe(ctx context.Context, w Workload, target sender, rec *recorder, state *runState) {
	state.stage.Store(-1)
	state.measuring.Store(true)
	state.setVUs(w.Count)
	var wg sync.WaitGroup
	for i := range w.Count {
		wg.Go(func() {
			if w.GapMs > 0 && !sleepCtx(ctx, time.Duration(i*w.GapMs)*time.Millisecond) {
				return
			}
			started := time.Now()
			rec.record(target.Send(ctx), started, true)
		})
	}
	wg.Wait()
	state.setVUs(0)
}

// runVUs is the closed model: a controller keeps the number of running VUs on the stage ramp,
// each VU repeats the request until it is told to stop, the iterations run out or ctx ends.
func runVUs(ctx context.Context, w Workload, target sender, rec *recorder, state *runState) {
	start := time.Now()
	var (
		wg         sync.WaitGroup
		stops      []chan struct{}
		iterations atomic.Int64
		exhausted  = make(chan struct{})
		closeOnce  sync.Once
	)
	vu := func(stop <-chan struct{}) {
		for {
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
			started := time.Now()
			rec.record(target.Send(ctx), started, measured)
			if w.ThinkTimeMs > 0 && !sleepCtx(ctx, time.Duration(w.ThinkTimeMs)*time.Millisecond) {
				return
			}
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
			stops = append(stops, stop)
			wg.Go(func() { vu(stop) })
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
		return w.VUs, -1, true, w.DurationS > 0 && e >= w.DurationS
	}
	from, begin := 0, 0.0
	for i, st := range w.Stages {
		if e < begin+st.DurationS {
			frac := (e - begin) / st.DurationS
			return int(math.Round(float64(from) + float64(st.TargetVUs-from)*frac)), i, !st.Unmeasured, false
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
