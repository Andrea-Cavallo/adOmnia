package loadtest

import "fmt"

const (
	liveWindowS     = 10 // seconds the live gates look back on
	liveMinRequests = 20 // fewer requests in the window say nothing yet
	saturationLagMs = 10 // scheduler p99 above this: the generator is saturated
)

// recentBuckets returns the last n closed seconds.
func (r *recorder) recentBuckets(n int) []Bucket {
	r.mu.Lock()
	defer r.mu.Unlock()
	from := max(0, len(r.buckets)-n)
	return append([]Bucket(nil), r.buckets[from:]...)
}

// liveGateFailure checks the error rate and p95 gates on the window, so a run with
// abortOnFail stops while the target is failing rather than at the end. p95 is the
// request-weighted mean of the per-second p95s: an approximation, enough to decide a stop.
func liveGateFailure(g *Gates, window []Bucket) string {
	reqs, errs := 0, 0
	weighted := 0.0
	for _, b := range window {
		reqs += b.Reqs
		errs += b.Errors
		weighted += b.P95Ms * float64(b.Reqs)
	}
	if reqs < liveMinRequests {
		return ""
	}
	if g.MaxErrorPct != nil {
		if pct := float64(errs) / float64(reqs) * 100; pct > *g.MaxErrorPct {
			return fmt.Sprintf("error rate %.1f%% over the last %d s exceeds %.1f%%", pct, liveWindowS, *g.MaxErrorPct)
		}
	}
	if g.MaxP95Ms > 0 {
		if p95 := weighted / float64(reqs); p95 > g.MaxP95Ms {
			return fmt.Sprintf("p95 %.0fms over the last %d s exceeds %.0fms", p95, liveWindowS, g.MaxP95Ms)
		}
	}
	return ""
}
