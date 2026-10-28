package codestudio

import (
	"maps"
	"sync"
	"time"
)

// loadPerformance keeps bounded, timing-only diagnostics in memory. Project
// paths, contents and session identifiers are never included in snapshots.
type loadPerformance struct {
	mu     sync.Mutex
	values map[string]float64
}

func (p *loadPerformance) record(stage string, elapsed time.Duration) {
	p.mu.Lock()
	defer p.mu.Unlock()
	if p.values == nil {
		p.values = make(map[string]float64)
	}
	milliseconds := float64(elapsed.Microseconds()) / 1000
	// Every occurrence is counted: repeated stages keep the latest duration and
	// the slowest one instead of only the first measurement.
	p.values[stage+"Ms"] = milliseconds
	p.values[stage+"Count"]++
	if milliseconds > p.values[stage+"MaxMs"] {
		p.values[stage+"MaxMs"] = milliseconds
	}
}

// noteLoad records one completed load stage from its start time.
func (s *Service) noteLoad(stage string, started time.Time) {
	s.noteLoadElapsed(stage, time.Since(started))
}

// noteLoadElapsed records one completed load stage from a measured duration.
// Measurements stay out of the session event stream: they are pull-only through
// GetWorkspaceLoadPerformance, so instrumentation never shifts event ordering.
func (s *Service) noteLoadElapsed(stage string, elapsed time.Duration) {
	s.loadPerf.record(stage, elapsed)
}

func (s *Service) GetWorkspaceLoadPerformance() map[string]float64 {
	s.loadPerf.mu.Lock()
	defer s.loadPerf.mu.Unlock()
	result := make(map[string]float64, len(s.loadPerf.values))
	maps.Copy(result, s.loadPerf.values)
	return result
}
