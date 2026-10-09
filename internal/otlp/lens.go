package otlp

import (
	"sort"
	"strconv"
)

// LensStat is the runtime summary of the spans started at one source location.
type LensStat struct {
	File     string  `json:"file"`
	Line     int     `json:"line"`
	Function string  `json:"function,omitempty"`
	Name     string  `json:"name"`
	Count    int     `json:"count"`
	Errors   int     `json:"errors"`
	Retries  int     `json:"retries"`
	AvgMs    float64 `json:"avgMs"`
	P50Ms    float64 `json:"p50Ms"`
	P95Ms    float64 `json:"p95Ms"`
	P99Ms    float64 `json:"p99Ms"`
	MaxMs    float64 `json:"maxMs"`
	LastMs   float64 `json:"lastMs"`
	FirstMs  float64 `json:"firstMs"`
	Kind     string  `json:"kind"`
	Category string  `json:"category"`
}

// percentile reads a sorted slice with the nearest-rank method.
func percentile(sorted []float64, p float64) float64 {
	if len(sorted) == 0 {
		return 0
	}
	rank := int(p/100*float64(len(sorted))+0.999999) - 1
	if rank < 0 {
		rank = 0
	}
	if rank >= len(sorted) {
		rank = len(sorted) - 1
	}
	return sorted[rank]
}

// Lens aggregates every stored span that carries code.filepath/code.lineno (or the stable
// code.file.path/code.line.number) by source location.
func (s *Store) Lens() []LensStat {
	type bucket struct {
		stat      LensStat
		durations []float64
	}
	buckets := map[string]*bucket{}
	s.mu.RLock()
	for _, spans := range s.traces {
		retry := retryIDs(spans)
		for _, span := range spans {
			file := span.Attributes["code.filepath"]
			if file == "" {
				file = span.Attributes["code.file.path"]
			}
			if file == "" {
				continue
			}
			lineText := span.Attributes["code.lineno"]
			if lineText == "" {
				lineText = span.Attributes["code.line.number"]
			}
			line, _ := strconv.Atoi(lineText)
			key := file + ":" + strconv.Itoa(line)
			b := buckets[key]
			if b == nil {
				function := span.Attributes["code.function"]
				if function == "" {
					function = span.Attributes["code.function.name"]
				}
				b = &bucket{stat: LensStat{File: file, Line: line, Function: function, Name: span.Name, Category: span.Category, Kind: span.Kind, FirstMs: span.StartMs}}
				buckets[key] = b
			}
			b.durations = append(b.durations, span.DurationMs)
			b.stat.Count++
			if span.StatusCode == "ERROR" {
				b.stat.Errors++
			}
			if retry[span.SpanID] {
				b.stat.Retries++
			}
			if span.StartMs < b.stat.FirstMs {
				b.stat.FirstMs = span.StartMs
			}
			if end := span.StartMs + span.DurationMs; end > b.stat.LastMs {
				b.stat.LastMs = end
			}
		}
	}
	s.mu.RUnlock()
	out := make([]LensStat, 0, len(buckets))
	for _, b := range buckets {
		sort.Float64s(b.durations)
		total := 0.0
		for _, d := range b.durations {
			total += d
		}
		b.stat.AvgMs = total / float64(len(b.durations))
		b.stat.P50Ms, b.stat.P95Ms, b.stat.P99Ms = percentile(b.durations, 50), percentile(b.durations, 95), percentile(b.durations, 99)
		b.stat.MaxMs = b.durations[len(b.durations)-1]
		out = append(out, b.stat)
	}
	sort.Slice(out, func(i, j int) bool {
		if out[i].File != out[j].File {
			return out[i].File < out[j].File
		}
		return out[i].Line < out[j].Line
	})
	return out
}
