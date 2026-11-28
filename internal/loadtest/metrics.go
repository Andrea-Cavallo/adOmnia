package loadtest

import (
	"math"
	"slices"
	"strconv"
	"strings"
	"sync"
	"time"

	"github.com/Andrea-Cavallo/adOmnia/internal/httpexec"
	hdr "github.com/HdrHistogram/hdrhistogram-go"
)

// Result is the report of one run. Its JSON keeps the fields of the previous report
// (totalRequests, p95Ms, timeline, throughputTimeline…) so saved results and the UI parts
// that draw them keep working.
type Result struct {
	Name      string `json:"name,omitempty"`
	Executor  string `json:"executor"`
	StartedAt string `json:"startedAt"`
	EndedAt   string `json:"endedAt"`
	Aborted   bool   `json:"aborted,omitzero"`

	TotalRequests int   `json:"totalRequests"` // sent, warm-up included
	Successful    int   `json:"successful"`
	Failed        int   `json:"failed"`
	WarmupSkipped int   `json:"warmupSkipped,omitzero"`
	BytesReceived int64 `json:"bytesReceived"`
	MaxVUs        int   `json:"maxVUs,omitzero"`

	TotalTimeMs float64 `json:"totalTimeMs"`
	AvgMs       float64 `json:"avgMs"`
	MinMs       float64 `json:"minMs"`
	MaxMs       float64 `json:"maxMs"`
	P50Ms       float64 `json:"p50Ms"`
	P75Ms       float64 `json:"p75Ms"`
	P90Ms       float64 `json:"p90Ms"`
	P95Ms       float64 `json:"p95Ms"`
	P99Ms       float64 `json:"p99Ms"`
	P999Ms      float64 `json:"p999Ms"`
	Throughput  float64 `json:"throughput"` // measured requests per second
	ErrorRate   float64 `json:"errorRate"`  // percent of measured requests

	StatusCodes        map[int]int     `json:"statusCodes"`
	ErrorGroups        []ErrorGroup    `json:"errorGroups,omitempty"`
	Timeline           []TimelinePoint `json:"timeline,omitempty"`
	TimelineTruncated  bool            `json:"timelineTruncated,omitzero"`
	ThroughputTimeline []Bucket        `json:"throughputTimeline,omitempty"`
}

// ErrorGroup counts measured failures with the same cause.
type ErrorGroup struct {
	Code    string `json:"code"` // HTTP_5xx, TIMEOUT, CONN_ERR…
	Message string `json:"message"`
	Count   int    `json:"count"`
}

// TimelinePoint is one request, for the waterfall of short runs.
type TimelinePoint struct {
	StartMs   float64 `json:"startMs"`
	TimeMs    float64 `json:"timeMs"` // when it finished, from the start of the run
	LatencyMs float64 `json:"latencyMs"`
	Status    int     `json:"status"`
	Ok        bool    `json:"ok"`
	Error     string  `json:"error,omitempty"`
}

// Bucket is one second of the run (measured requests only).
type Bucket struct {
	Second int     `json:"second"`
	Reqs   int     `json:"reqs"`
	Errors int     `json:"errors"`
	AvgMs  float64 `json:"avgMs"`
	P95Ms  float64 `json:"p95Ms"`
	P99Ms  float64 `json:"p99Ms"`
	VUs    int     `json:"vus"`
}

// Progress is the live view sent once per second while a run is going.
type Progress struct {
	RunID     string  `json:"runId"`
	ElapsedS  float64 `json:"elapsedS"`
	VUs       int     `json:"vus"`
	Stage     int     `json:"stage"` // index in Workload.Stages, -1 without stages
	Measuring bool    `json:"measuring"`
	Sent      int     `json:"sent"`
	Failed    int     `json:"failed"`
	RPS       float64 `json:"rps"`   // last second
	P95Ms     float64 `json:"p95Ms"` // last second
	ErrorRate float64 `json:"errorRate"`
	Last      Bucket  `json:"last"`
}

// recorder collects what the VUs observe. One mutex: a send costs far more than the lock.
type recorder struct {
	mu    sync.Mutex
	start time.Time

	hist   *hdr.Histogram // whole run, microseconds
	window *hdr.Histogram // current second, reset by tick

	sent, ok, failed, warmup int
	bytes                    int64
	status                   map[int]int
	errors                   map[string]*ErrorGroup
	timeline                 []TimelinePoint
	truncated                bool
	buckets                  []Bucket
	winReqs, winErrs         int
	maxVUs, lastVUs          int

	firstMeasured, lastMeasured time.Time
}

func newRecorder(start time.Time) *recorder {
	return &recorder{
		start: start,
		// 1 µs to 60 s at 3 significant digits: sub-millisecond answers are measured, not rounded away.
		hist:   hdr.New(1, 60_000_000, 3),
		window: hdr.New(1, 60_000_000, 3),
		status: make(map[int]int),
		errors: make(map[string]*ErrorGroup),
	}
}

// record stores one send that began at started. A canceled send (the run was stopped) is dropped.
func (r *recorder) record(out httpexec.Outcome, started time.Time, measured bool) {
	if out.Canceled {
		return
	}
	ended := started.Add(out.Latency)
	r.mu.Lock()
	defer r.mu.Unlock()
	r.sent++
	if !measured {
		r.warmup++
		return
	}
	if r.firstMeasured.IsZero() || started.Before(r.firstMeasured) {
		r.firstMeasured = started
	}
	if ended.After(r.lastMeasured) {
		r.lastMeasured = ended
	}
	us := max(out.Latency.Microseconds(), 1)
	_ = r.hist.RecordValue(us)   // > 60 s is out of range: counted, not in the percentiles
	_ = r.window.RecordValue(us) // same
	r.bytes += out.Bytes
	r.winReqs++
	if out.Status > 0 {
		r.status[out.Status]++
	}
	good := out.ErrCode == "" && out.Status >= 200 && out.Status < 400
	if good {
		r.ok++
	} else {
		r.failed++
		r.winErrs++
		r.addError(out)
	}
	r.addTimeline(out, started, ended, good)
}

func (r *recorder) addError(out httpexec.Outcome) {
	code, msg := out.ErrCode, firstLine(out.ErrMsg)
	if code == "" {
		code, msg = httpClass(out.Status), "HTTP "+strconv.Itoa(out.Status)
	}
	key := code + "\x00" + msg
	if g, ok := r.errors[key]; ok {
		g.Count++
		return
	}
	r.errors[key] = &ErrorGroup{Code: code, Message: msg, Count: 1}
}

func (r *recorder) addTimeline(out httpexec.Outcome, started, ended time.Time, good bool) {
	if len(r.timeline) >= maxTimelineSize {
		r.truncated = true
		return
	}
	point := TimelinePoint{
		StartMs:   ms(started.Sub(r.start)),
		TimeMs:    ms(ended.Sub(r.start)),
		LatencyMs: ms(out.Latency),
		Status:    out.Status,
		Ok:        good,
	}
	if !good {
		point.Error = firstLine(out.ErrMsg)
	}
	r.timeline = append(r.timeline, point)
}

// tick closes the current second and returns it.
func (r *recorder) tick(vus int) Bucket {
	r.mu.Lock()
	defer r.mu.Unlock()
	return r.closeWindow(vus)
}

// flush closes the last, partial second of the run if anything was measured in it.
func (r *recorder) flush() {
	r.mu.Lock()
	defer r.mu.Unlock()
	if r.winReqs > 0 {
		r.closeWindow(r.lastVUs)
	}
}

func (r *recorder) closeWindow(vus int) Bucket {
	r.maxVUs = max(r.maxVUs, vus)
	r.lastVUs = vus
	b := Bucket{Second: len(r.buckets), Reqs: r.winReqs, Errors: r.winErrs, VUs: vus}
	if r.winReqs > 0 {
		b.AvgMs = round2(r.window.Mean() / 1000)
		b.P95Ms = usToMs(r.window.ValueAtQuantile(95))
		b.P99Ms = usToMs(r.window.ValueAtQuantile(99))
	}
	r.window.Reset()
	r.winReqs, r.winErrs = 0, 0
	r.buckets = append(r.buckets, b)
	return b
}

func (r *recorder) totals() (sent, failed, measured int) {
	r.mu.Lock()
	defer r.mu.Unlock()
	return r.sent, r.failed, r.ok + r.failed
}

func (r *recorder) result(end time.Time) Result {
	r.mu.Lock()
	defer r.mu.Unlock()
	res := Result{
		StartedAt:          r.start.UTC().Format(time.RFC3339Nano),
		EndedAt:            end.UTC().Format(time.RFC3339Nano),
		TotalRequests:      r.sent,
		Successful:         r.ok,
		Failed:             r.failed,
		WarmupSkipped:      r.warmup,
		BytesReceived:      r.bytes,
		MaxVUs:             r.maxVUs,
		TotalTimeMs:        round2(ms(end.Sub(r.start))),
		StatusCodes:        r.status,
		Timeline:           r.timeline,
		TimelineTruncated:  r.truncated,
		ThroughputTimeline: r.buckets,
		ErrorGroups:        sortedErrors(r.errors),
	}
	measured := r.ok + r.failed
	if measured == 0 {
		return res
	}
	h := r.hist
	res.AvgMs = round2(h.Mean() / 1000)
	res.MinMs = usToMs(h.Min())
	res.MaxMs = usToMs(h.Max())
	res.P50Ms = usToMs(h.ValueAtQuantile(50))
	res.P75Ms = usToMs(h.ValueAtQuantile(75))
	res.P90Ms = usToMs(h.ValueAtQuantile(90))
	res.P95Ms = usToMs(h.ValueAtQuantile(95))
	res.P99Ms = usToMs(h.ValueAtQuantile(99))
	res.P999Ms = usToMs(h.ValueAtQuantile(99.9))
	res.ErrorRate = round2(float64(r.failed) / float64(measured) * 100)
	// Throughput over the measured window only: warm-up and the ramp to the first measured
	// request do not dilute it.
	if window := r.lastMeasured.Sub(r.firstMeasured).Seconds(); window > 0 {
		res.Throughput = round2(float64(measured) / window)
	}
	return res
}

func sortedErrors(groups map[string]*ErrorGroup) []ErrorGroup {
	out := make([]ErrorGroup, 0, len(groups))
	for _, g := range groups {
		out = append(out, *g)
	}
	slices.SortFunc(out, func(a, b ErrorGroup) int {
		if a.Count != b.Count {
			return b.Count - a.Count
		}
		return strings.Compare(a.Code+a.Message, b.Code+b.Message)
	})
	return out
}

func httpClass(status int) string {
	if status >= 500 {
		return "HTTP_5xx"
	}
	return "HTTP_4xx"
}

func firstLine(s string) string {
	s, _, _ = strings.Cut(strings.TrimSpace(s), "\n")
	if len(s) > 200 {
		s = s[:200] + "…"
	}
	return s
}

func ms(d time.Duration) float64 { return float64(d.Microseconds()) / 1000 }
func usToMs(us int64) float64    { return round2(float64(us) / 1000) }
func round2(v float64) float64   { return math.Round(v*100) / 100 }
