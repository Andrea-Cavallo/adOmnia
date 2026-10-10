// Package otlp is adOmnia's local OpenTelemetry trace receiver: services export spans to
// 127.0.0.1 (OTLP/HTTP and OTLP/gRPC) and the UI reads them back. Nothing leaves the machine
// and nothing listens until the user starts the receiver.
package otlp

import (
	"sort"
	"sync"
)

// Span is one received span, flattened for the UI.
type Span struct {
	TraceID       string  `json:"traceId"`
	SpanID        string  `json:"spanId"`
	ParentSpanID  string  `json:"parentSpanId,omitempty"`
	Name          string  `json:"name"`
	Kind          string  `json:"kind"`
	Service       string  `json:"service"`
	StartMs       float64 `json:"startMs"`
	DurationMs    float64 `json:"durationMs"`
	StatusCode    string  `json:"statusCode"`
	StatusMessage string  `json:"statusMessage,omitempty"`
	// Category groups spans by semantic conventions: http, db, rpc, messaging or internal.
	Category   string            `json:"category"`
	Attributes map[string]string `json:"attributes,omitempty"`
	Events     []SpanEvent       `json:"events,omitempty"`
	// PID is the resource's process.pid, when the SDK reports it.
	PID int `json:"pid,omitempty"`
}

type SpanEvent struct {
	Name       string            `json:"name"`
	TimeMs     float64           `json:"timeMs"`
	Attributes map[string]string `json:"attributes,omitempty"`
}

// TraceSummary is one row of the trace list.
type TraceSummary struct {
	TraceID    string   `json:"traceId"`
	Root       string   `json:"root"`
	Services   []string `json:"services"`
	StartMs    float64  `json:"startMs"`
	DurationMs float64  `json:"durationMs"`
	Spans      int      `json:"spans"`
	Errors     int      `json:"errors"`
}

// Store keeps the most recent traces in memory, evicting whole traces past the span cap.
type Store struct {
	mu       sync.RWMutex
	maxSpans int
	total    int
	order    []string // trace ids, oldest first
	traces   map[string][]Span
}

func NewStore(maxSpans int) *Store {
	return &Store{maxSpans: maxSpans, traces: map[string][]Span{}}
}

func (s *Store) Add(spans []Span) {
	s.mu.Lock()
	defer s.mu.Unlock()
	for _, span := range spans {
		if _, ok := s.traces[span.TraceID]; !ok {
			s.order = append(s.order, span.TraceID)
		}
		s.traces[span.TraceID] = append(s.traces[span.TraceID], span)
		s.total++
	}
	for s.total > s.maxSpans && len(s.order) > 1 {
		oldest := s.order[0]
		s.order = s.order[1:]
		s.total -= len(s.traces[oldest])
		delete(s.traces, oldest)
	}
}

// Import loads saved traces (Trace Studio "Save", a reproduction's trace.json). A trace already in
// the store is kept as is, so loading the same file twice does not duplicate its spans.
func (s *Store) Import(spans []Span) (added int) {
	s.mu.RLock()
	fresh := make([]Span, 0, len(spans))
	for _, span := range spans {
		if _, exists := s.traces[span.TraceID]; !exists && span.TraceID != "" && span.SpanID != "" {
			fresh = append(fresh, span)
		}
	}
	s.mu.RUnlock()
	s.Add(fresh)
	return len(fresh)
}

func (s *Store) Clear() {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.order, s.total, s.traces = nil, 0, map[string][]Span{}
}

func (s *Store) Counts() (traces, spans int) {
	s.mu.RLock()
	defer s.mu.RUnlock()
	return len(s.order), s.total
}

// Trace returns the spans of one trace sorted by start time.
func (s *Store) Trace(traceID string) []Span {
	s.mu.RLock()
	spans := append([]Span(nil), s.traces[traceID]...)
	s.mu.RUnlock()
	sort.SliceStable(spans, func(i, j int) bool { return spans[i].StartMs < spans[j].StartMs })
	return spans
}

// Summaries lists the newest traces first.
func (s *Store) Summaries(limit int) []TraceSummary {
	s.mu.RLock()
	defer s.mu.RUnlock()
	out := []TraceSummary{}
	for i := len(s.order) - 1; i >= 0 && (limit <= 0 || len(out) < limit); i-- {
		out = append(out, summarize(s.order[i], s.traces[s.order[i]]))
	}
	return out
}

func summarize(traceID string, spans []Span) TraceSummary {
	summary := TraceSummary{TraceID: traceID, Spans: len(spans)}
	ids := map[string]bool{}
	for _, span := range spans {
		ids[span.SpanID] = true
	}
	services := map[string]bool{}
	end := 0.0
	for i, span := range spans {
		if i == 0 || span.StartMs < summary.StartMs {
			summary.StartMs = span.StartMs
		}
		if span.StartMs+span.DurationMs > end {
			end = span.StartMs + span.DurationMs
		}
		services[span.Service] = true
		if span.StatusCode == "ERROR" {
			summary.Errors++
		}
		// The root is the span whose parent is not part of what we received.
		if summary.Root == "" && (span.ParentSpanID == "" || !ids[span.ParentSpanID]) {
			summary.Root = span.Service + " " + span.Name
		}
	}
	summary.DurationMs = end - summary.StartMs
	for service := range services {
		summary.Services = append(summary.Services, service)
	}
	sort.Strings(summary.Services)
	return summary
}
