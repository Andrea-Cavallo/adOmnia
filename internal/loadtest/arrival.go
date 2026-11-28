package loadtest

import (
	"context"
	"sync"
	"sync/atomic"
	"time"
)

// arrival is one iteration the open model scheduled at a precise instant.
type arrival struct {
	scheduled time.Time
	iteration int
	measured  bool
}

// schedulerSlack is the longest the scheduler sleeps: arrivals due meanwhile start together,
// each still timed from its own scheduled instant.
const schedulerSlack = 2 * time.Millisecond

// runArrival is the open model. Iterations start on the rate curve, not when a VU is free:
// a slow target does not slow the load down. An idle VU of the pool takes the arrival; the
// pool grows up to MaxVUs; past that the arrival is dropped and counted, never queued.
//
// Coordinated omission: an iteration that starts late (generator busy, pool growing) is timed
// from the instant it was scheduled, so the delay shows in the latency instead of vanishing.
func runArrival(ctx context.Context, w Workload, t target, rec *recorder, state *runState) {
	start := time.Now()
	var (
		wg      sync.WaitGroup
		jobs    = make(chan arrival)
		quit    = make(chan struct{})
		spawned int
		busy    atomic.Int64
	)
	execute := func(id int, a arrival) {
		state.setVUs(int(busy.Add(1)))
		defer func() { state.setVUs(int(busy.Add(-1))) }()
		samples, failed := t.iterate(ctx, id, a.iteration)
		if len(samples) > 0 && !samples[0].canceled {
			lag := samples[0].started.Sub(a.scheduled)
			rec.schedulerLag(lag)
			if lag > 0 {
				samples[0].started, samples[0].latency = a.scheduled, samples[0].latency+lag
			}
		}
		rec.iteration(samples, failed, a.measured, id+1, a.iteration+1)
	}
	worker := func(id int, first arrival) {
		for a := first; ; {
			execute(id, a)
			select {
			case a = <-jobs:
			case <-quit:
				return
			case <-ctx.Done():
				return
			}
		}
	}
	dispatch := func(a arrival) {
		select {
		case jobs <- a:
		default:
			if spawned < w.MaxVUs {
				id := spawned
				spawned++
				wg.Go(func() { worker(id, a) })
				return
			}
			rec.drop(a.measured)
		}
	}

	next := 0.0 // seconds from start of the next arrival
	n := 0
schedule:
	for ctx.Err() == nil {
		elapsed := time.Since(start).Seconds()
		for next <= elapsed {
			rate, stage, measuring, done := targetRate(w, next)
			state.stage.Store(int64(stage))
			state.measuring.Store(measuring)
			if done {
				break schedule
			}
			if rate <= 0 { // a stage at 0 req/s: look again a little later
				next += schedulerSlack.Seconds()
				continue
			}
			dispatch(arrival{scheduled: start.Add(time.Duration(next * float64(time.Second))), iteration: n, measured: measuring})
			n++
			next += 1 / rate
		}
		wait := min(time.Duration((next-elapsed)*float64(time.Second)), schedulerSlack)
		if !sleepCtx(ctx, wait) {
			break
		}
	}
	close(quit)
	wg.Wait()
	state.setVUs(0)
}

// targetRate is where the rate curve is at e seconds (stages ramp like targetVUs).
func targetRate(w Workload, e float64) (rate float64, stage int, measuring, done bool) {
	if len(w.Stages) == 0 {
		return w.RPS, -1, e >= w.WarmupS, e >= w.DurationS
	}
	from, begin := 0.0, 0.0
	for i, st := range w.Stages {
		if e < begin+st.DurationS {
			ramp := st.DurationS
			if st.RampS != nil {
				ramp = *st.RampS
			}
			within := e - begin
			measuring = !st.Unmeasured && e >= w.WarmupS
			if ramp <= 0 || within >= ramp {
				return st.TargetRPS, i, measuring, false
			}
			return from + (st.TargetRPS-from)*within/ramp, i, measuring, false
		}
		from, begin = st.TargetRPS, begin+st.DurationS
	}
	return 0, len(w.Stages) - 1, false, true
}
