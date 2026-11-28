package loadtest

import (
	"maps"
	"math"
	"regexp"
	"slices"
	"strconv"
	"strings"
	"sync"
	"time"

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

	TotalRequests    int `json:"totalRequests"` // sent, warm-up included
	Successful       int `json:"successful"`
	Failed           int `json:"failed"`
	WarmupSkipped    int `json:"warmupSkipped,omitzero"`
	Iterations       int `json:"iterations"`       // measured iterations
	FailedIterations int `json:"failedIterations"` // measured iterations with a failed step
	// DroppedIterations are arrivals the open model could not start: every VU of the pool was
	// busy. Non-zero means the target (or the pool) could not keep up with the rate.
	DroppedIterations int `json:"droppedIterations,omitzero"`
	// SchedulerLagP99Ms is how late iterations started against their scheduled instant
	// (open model). Above ~10 ms the generator itself is saturated: the numbers are suspect.
	SchedulerLagP99Ms float64 `json:"schedulerLagP99Ms,omitzero"`
	BytesReceived     int64   `json:"bytesReceived"`
	MaxVUs            int     `json:"maxVUs,omitzero"`

	TotalTimeMs    float64 `json:"totalTimeMs"`
	MeasuredTimeMs float64 `json:"measuredTimeMs"`
	AvgMs          float64 `json:"avgMs"`
	MinMs          float64 `json:"minMs"`
	MaxMs          float64 `json:"maxMs"`
	P50Ms          float64 `json:"p50Ms"`
	P75Ms          float64 `json:"p75Ms"`
	P90Ms          float64 `json:"p90Ms"`
	P95Ms          float64 `json:"p95Ms"`
	P99Ms          float64 `json:"p99Ms"`
	P999Ms         float64 `json:"p999Ms"`
	Throughput     float64 `json:"throughput"` // measured requests per second
	ErrorRate      float64 `json:"errorRate"`  // percent of measured requests

	StatusCodes        map[int]int     `json:"statusCodes"`
	ErrorGroups        []ErrorGroup    `json:"errorGroups,omitempty"`
	Steps              []StepResult    `json:"steps,omitempty"`
	Distribution       []Bin           `json:"distribution,omitempty"`
	Apdex              *Apdex          `json:"apdex,omitempty"`
	GateFailures       []string        `json:"gateFailures,omitempty"`
	Timeline           []TimelinePoint `json:"timeline,omitempty"`
	TimelineTruncated  bool            `json:"timelineTruncated,omitzero"`
	ThroughputTimeline []Bucket        `json:"throughputTimeline,omitempty"`
}

// StepResult is one request step of a flow (or the single request of a request scenario).
type StepResult struct {
	ID          string         `json:"id"` // node id; "request" for a request scenario
	Step        string         `json:"step"`
	Count       int            `json:"count"`
	Errors      int            `json:"errors"`
	ErrorPct    float64        `json:"errorPct"`
	MinMs       float64        `json:"minMs"`
	AvgMs       float64        `json:"avgMs"`
	P50Ms       float64        `json:"p50Ms"`
	P90Ms       float64        `json:"p90Ms"`
	P95Ms       float64        `json:"p95Ms"`
	P99Ms       float64        `json:"p99Ms"`
	MaxMs       float64        `json:"maxMs"`
	StatusCodes map[string]int `json:"statusCodes"` // "ERR" when no response arrived
}

// Bin is one bar of the latency distribution; the last one may be the overflow above p99.
type Bin struct {
	FromMs   float64 `json:"fromMs"`
	ToMs     float64 `json:"toMs"` // 0 on the overflow bin (no upper bound)
	Count    int64   `json:"count"`
	Percent  float64 `json:"percentage"`
	Overflow bool    `json:"overflow,omitzero"`
}

// Apdex scores the measured requests against a threshold T: satisfied ≤ T, tolerated ≤ 4T,
// frustrated above or failed.
type Apdex struct {
	ThresholdMs float64 `json:"thresholdMs"`
	Satisfied   int     `json:"satisfied"`
	Tolerated   int     `json:"tolerated"`
	Frustrated  int     `json:"frustrated"`
	Score       float64 `json:"score"`
}

// ErrorGroup counts measured failures with the same cause; ids and long numbers are masked
// so that one cause is one group.
type ErrorGroup struct {
	Code    string   `json:"code"` // HTTP_5xx, HTTP_4xx, TIMEOUT, CONN_ERR, FAILED (script, assertion…)
	Message string   `json:"message"`
	Count   int      `json:"count"`
	Steps   []string `json:"steps,omitempty"`
	Status  int      `json:"status,omitzero"`
}

// TimelinePoint is one request, for the waterfall and the raw log of short runs.
type TimelinePoint struct {
	StartMs   float64 `json:"startMs"`
	TimeMs    float64 `json:"timeMs"` // when it finished, from the start of the run
	LatencyMs float64 `json:"latencyMs"`
	Status    int     `json:"status"`
	Ok        bool    `json:"ok"`
	Step      string  `json:"step,omitempty"`
	StepID    string  `json:"stepId,omitempty"`
	VU        int     `json:"vu,omitzero"`
	Iteration int     `json:"iteration,omitzero"`
	Bytes     int64   `json:"bytes,omitzero"`
	Measured  bool    `json:"measured"`
	Error     string  `json:"error,omitempty"`
}

// Bucket is one second of the run. Latencies are of the measured requests only.
type Bucket struct {
	Second int     `json:"second"`
	Reqs   int     `json:"reqs"`   // requests sent in that second, warm-up included
	Errors int     `json:"errors"` // failures among them
	AvgMs  float64 `json:"avgMs"`
	P95Ms  float64 `json:"p95Ms"`
	P99Ms  float64 `json:"p99Ms"`
	VUs    int     `json:"vus"`
}

// Progress is the live view sent once per second while a run is going.
type Progress struct {
	RunID      string  `json:"runId"`
	ElapsedS   float64 `json:"elapsedS"`
	VUs        int     `json:"vus"`
	Stage      int     `json:"stage"` // index in Workload.Stages, -1 without stages
	StageLabel string  `json:"stageLabel,omitempty"`
	Measuring  bool    `json:"measuring"`
	Sent       int     `json:"sent"`
	Failed     int     `json:"failed"`
	Iterations int     `json:"iterations"`
	Dropped    int     `json:"dropped,omitzero"`
	RPS        float64 `json:"rps"`   // last second
	P95Ms      float64 `json:"p95Ms"` // last second
	ErrorRate  float64 `json:"errorRate"`
	Last       Bucket  `json:"last"`
	// Snapshot is the result so far, without the per-request timeline.
	Snapshot *Result `json:"snapshot,omitempty"`
}

// sample is one request as the target observed it.
type sample struct {
	stepID   string
	step     string
	started  time.Time
	latency  time.Duration
	status   int // 0: no HTTP response
	bytes    int64
	errCode  string // empty when the request passed
	errMsg   string
	sent     bool // false when it failed before reaching the network (script, auth…)
	canceled bool // the run was stopped while it was in flight
}

func (s sample) ok() bool { return s.errCode == "" }

// latencyCounts says whether a sample has a latency worth measuring: a response arrived, or
// the request timed out. A refused connection takes a few ms and would make a broken target
// look fast; a slow 5xx or a timeout must stay in the percentiles.
func (s sample) latencyCounts() bool { return s.sent && (s.status > 0 || s.errCode == "TIMEOUT") }

type stepStats struct {
	name          string
	hist          *hdr.Histogram
	count, errors int
	statuses      map[string]int
}

// recorder collects what the VUs observe. One mutex: a request costs far more than the lock.
type recorder struct {
	mu        sync.Mutex
	start     time.Time
	apdexTMs  float64
	timelineN int

	hist   *hdr.Histogram // measured latencies, microseconds
	window *hdr.Histogram // current second

	sent, ok, failed, warmup     int
	iterations, failedIters      int
	dropped                      int
	lag                          *hdr.Histogram
	bytes                        int64
	satisfied, tolerated         int
	status                       map[int]int
	errors                       map[string]*ErrorGroup
	errorOrder                   []string
	steps                        map[string]*stepStats
	stepOrder                    []string
	timeline                     []TimelinePoint
	truncated                    bool
	buckets                      []Bucket
	winReqs, winErrs             int
	maxVUs, lastVUs              int
	firstMeasured, lastMeasuredT time.Time
}

const (
	maxErrorGroups = 200
	reportedGroups = 8
)

func newRecorder(start time.Time, apdexTMs float64, timelineCap int) *recorder {
	if apdexTMs <= 0 {
		apdexTMs = 500
	}
	return &recorder{
		start:     start,
		apdexTMs:  apdexTMs,
		timelineN: timelineCap,
		hist:      newHist(),
		window:    newHist(),
		lag:       newHist(),
		status:    make(map[int]int),
		errors:    make(map[string]*ErrorGroup),
		steps:     make(map[string]*stepStats),
	}
}

// 1 µs to 60 s at 3 significant digits: sub-millisecond answers are measured, not rounded away.
func newHist() *hdr.Histogram { return hdr.New(1, 60_000_000, 3) }

// iteration stores the samples of one iteration of VU vu (1-based ids in the timeline).
func (r *recorder) iteration(samples []sample, failed, measured bool, vu, iteration int) {
	r.mu.Lock()
	defer r.mu.Unlock()
	counted := false
	for _, s := range samples {
		if s.canceled {
			continue
		}
		counted = true
		r.record(s, measured, vu, iteration)
	}
	if counted && measured {
		r.iterations++
		if failed {
			r.failedIters++
		}
	}
}

func (r *recorder) record(s sample, measured bool, vu, iteration int) {
	r.sent++
	ended := s.started.Add(s.latency)
	r.addTimeline(s, ended, measured, vu, iteration)
	r.winReqs++ // the second buckets show all traffic, warm-up included
	if !s.ok() {
		r.winErrs++
	}
	if !measured {
		r.warmup++
		return
	}
	if r.firstMeasured.IsZero() || s.started.Before(r.firstMeasured) {
		r.firstMeasured = s.started
	}
	if ended.After(r.lastMeasuredT) {
		r.lastMeasuredT = ended
	}
	st := r.step(s.stepID, s.step)
	st.count++
	code := "ERR"
	if s.status > 0 {
		code = strconv.Itoa(s.status)
		r.status[s.status]++
	}
	st.statuses[code]++
	if s.latencyCounts() {
		us := max(s.latency.Microseconds(), 1)
		_ = r.hist.RecordValue(us)   // > 60 s is out of range: counted, not in the percentiles
		_ = r.window.RecordValue(us) // same
		_ = st.hist.RecordValue(us)  // same
	}
	r.bytes += s.bytes
	if s.ok() {
		r.ok++
		switch latencyMs := float64(s.latency.Microseconds()) / 1000; {
		case latencyMs <= r.apdexTMs:
			r.satisfied++
		case latencyMs <= r.apdexTMs*4:
			r.tolerated++
		}
		return
	}
	r.failed++
	st.errors++
	r.addError(s)
}

func (r *recorder) step(id, name string) *stepStats {
	if id == "" {
		id = name
	}
	if st, ok := r.steps[id]; ok {
		return st
	}
	st := &stepStats{name: name, hist: newHist(), statuses: map[string]int{}}
	r.steps[id] = st
	r.stepOrder = append(r.stepOrder, id)
	return st
}

var (
	idPattern     = regexp.MustCompile(`(?i)[0-9a-f]{8}-[0-9a-f-]{27,}`)
	numberPattern = regexp.MustCompile(`\b\d{3,}\b`)
)

// fingerprint masks per-request ids and numbers so one cause makes one group. Same rule as
// the Flow Stress UI used, so groups look the same as before.
func fingerprint(message string) string {
	m := idPattern.ReplaceAllString(strings.TrimSpace(message), "<id>")
	m = numberPattern.ReplaceAllString(m, "<n>")
	m = strings.Join(strings.Fields(m), " ")
	if r := []rune(m); len(r) > 160 {
		m = string(r[:160])
	}
	return m
}

func (r *recorder) addError(s sample) {
	code, msg := s.errCode, firstLine(s.errMsg)
	if code == "HTTP" || (msg == "" && s.status > 0) {
		code, msg = httpClass(s.status), "HTTP "+strconv.Itoa(s.status)
	}
	if msg == "" {
		msg = "request failed without a message"
	}
	key := code + "|" + fingerprint(msg)
	g, ok := r.errors[key]
	if !ok && len(r.errors) >= maxErrorGroups {
		key = "other"
		g, ok = r.errors[key]
		if !ok {
			g = &ErrorGroup{Code: "OTHER", Message: "other failures"}
		}
	} else if !ok {
		g = &ErrorGroup{Code: code, Message: msg, Status: s.status}
	}
	if !ok {
		r.errors[key] = g
		r.errorOrder = append(r.errorOrder, key)
	}
	g.Count++
	if s.step != "" && len(g.Steps) < 3 && !slices.Contains(g.Steps, s.step) {
		g.Steps = append(g.Steps, s.step)
	}
}

func (r *recorder) addTimeline(s sample, ended time.Time, measured bool, vu, iteration int) {
	if len(r.timeline) >= r.timelineN {
		r.truncated = true
		return
	}
	point := TimelinePoint{
		StartMs:   ms(s.started.Sub(r.start)),
		TimeMs:    ms(ended.Sub(r.start)),
		LatencyMs: ms(s.latency),
		Status:    s.status,
		Ok:        s.ok(),
		Step:      s.step,
		StepID:    s.stepID,
		VU:        vu,
		Iteration: iteration,
		Bytes:     s.bytes,
		Measured:  measured,
	}
	if !s.ok() {
		point.Error = firstLine(s.errMsg)
		if point.Error == "" && s.status > 0 {
			point.Error = "HTTP " + strconv.Itoa(s.status)
		}
	}
	r.timeline = append(r.timeline, point)
}

// drop counts an arrival the pool could not start.
func (r *recorder) drop(_ bool) {
	r.mu.Lock()
	defer r.mu.Unlock()
	r.dropped++
}

// schedulerLag records how late an open-model iteration started.
func (r *recorder) schedulerLag(d time.Duration) {
	r.mu.Lock()
	defer r.mu.Unlock()
	_ = r.lag.RecordValue(max(d.Microseconds(), 1)) // > 60 s is out of range and dropped
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
	if r.window.TotalCount() > 0 {
		b.AvgMs = round2(r.window.Mean() / 1000)
		b.P95Ms = usToMs(r.window.ValueAtQuantile(95))
		b.P99Ms = usToMs(r.window.ValueAtQuantile(99))
	}
	r.window.Reset()
	r.winReqs, r.winErrs = 0, 0
	r.buckets = append(r.buckets, b)
	return b
}

func (r *recorder) totals() (sent, failed, measured, iterations, dropped int) {
	r.mu.Lock()
	defer r.mu.Unlock()
	return r.sent, r.failed, r.ok + r.failed, r.iterations, r.dropped
}

func (r *recorder) result(end time.Time) Result { return r.report(end, true) }

// snapshot is the report so far without the timeline, cheap enough to send every second.
func (r *recorder) snapshot(now time.Time) *Result {
	res := r.report(now, false)
	return &res
}

func (r *recorder) report(end time.Time, withTimeline bool) Result {
	r.mu.Lock()
	defer r.mu.Unlock()
	res := Result{
		StartedAt:          r.start.UTC().Format(time.RFC3339Nano),
		EndedAt:            end.UTC().Format(time.RFC3339Nano),
		TotalRequests:      r.sent,
		Successful:         r.ok,
		Failed:             r.failed,
		WarmupSkipped:      r.warmup,
		Iterations:         r.iterations,
		FailedIterations:   r.failedIters,
		DroppedIterations:  r.dropped,
		BytesReceived:      r.bytes,
		MaxVUs:             r.maxVUs,
		TotalTimeMs:        round2(ms(end.Sub(r.start))),
		StatusCodes:        maps.Clone(r.status),
		TimelineTruncated:  r.truncated,
		ThroughputTimeline: slices.Clone(r.buckets),
		ErrorGroups:        r.sortedErrors(),
		Steps:              r.stepResults(),
	}
	if r.lag.TotalCount() > 0 {
		res.SchedulerLagP99Ms = usToMs(r.lag.ValueAtQuantile(99))
	}
	if withTimeline {
		res.Timeline = slices.Clone(r.timeline)
	}
	measured := r.ok + r.failed
	if measured == 0 {
		return res
	}
	if window := r.lastMeasuredT.Sub(r.firstMeasured); window > 0 {
		// Throughput over the measured window only: warm-up and ramp do not dilute it.
		res.MeasuredTimeMs = round2(ms(window))
		res.Throughput = round2(float64(measured) / window.Seconds())
	}
	res.ErrorRate = round2(float64(r.failed) / float64(measured) * 100)
	res.Apdex = &Apdex{
		ThresholdMs: r.apdexTMs,
		Satisfied:   r.satisfied,
		Tolerated:   r.tolerated,
		Frustrated:  measured - r.satisfied - r.tolerated,
		Score:       math.Round((float64(r.satisfied)+float64(r.tolerated)/2)/float64(measured)*1000) / 1000,
	}
	if h := r.hist; h.TotalCount() > 0 {
		res.AvgMs = round2(h.Mean() / 1000)
		res.MinMs = usToMs(h.Min())
		res.MaxMs = usToMs(h.Max())
		res.P50Ms = usToMs(h.ValueAtQuantile(50))
		res.P75Ms = usToMs(h.ValueAtQuantile(75))
		res.P90Ms = usToMs(h.ValueAtQuantile(90))
		res.P95Ms = usToMs(h.ValueAtQuantile(95))
		res.P99Ms = usToMs(h.ValueAtQuantile(99))
		res.P999Ms = usToMs(h.ValueAtQuantile(99.9))
		res.Distribution = distribution(h, res.P99Ms)
	}
	return res
}

func (r *recorder) stepResults() []StepResult {
	out := make([]StepResult, 0, len(r.stepOrder))
	for _, id := range r.stepOrder {
		st := r.steps[id]
		sr := StepResult{ID: id, Step: st.name, Count: st.count, Errors: st.errors, StatusCodes: maps.Clone(st.statuses)}
		if st.count > 0 {
			sr.ErrorPct = round2(float64(st.errors) / float64(st.count) * 100)
		}
		if h := st.hist; h.TotalCount() > 0 {
			sr.MinMs, sr.AvgMs, sr.MaxMs = usToMs(h.Min()), round2(h.Mean()/1000), usToMs(h.Max())
			sr.P50Ms, sr.P90Ms = usToMs(h.ValueAtQuantile(50)), usToMs(h.ValueAtQuantile(90))
			sr.P95Ms, sr.P99Ms = usToMs(h.ValueAtQuantile(95)), usToMs(h.ValueAtQuantile(99))
		}
		out = append(out, sr)
	}
	return out
}

func (r *recorder) sortedErrors() []ErrorGroup {
	out := make([]ErrorGroup, 0, len(r.errorOrder))
	for _, key := range r.errorOrder {
		g := *r.errors[key]
		g.Steps = slices.Clone(g.Steps)
		out = append(out, g)
	}
	slices.SortStableFunc(out, func(a, b ErrorGroup) int { return b.Count - a.Count })
	if len(out) > reportedGroups {
		out = out[:reportedGroups]
	}
	return out
}

// distribution groups the latencies in about ten "nice" bins up to p99, plus an overflow bin.
func distribution(h *hdr.Histogram, p99Ms float64) []Bin {
	total := h.TotalCount()
	binMs := niceBinSize(max(1, p99Ms) / 10)
	n := int(math.Ceil(max(1, p99Ms) / binMs))
	bins := make([]Bin, n)
	for i := range bins {
		bins[i] = Bin{FromMs: float64(i) * binMs, ToMs: float64(i+1) * binMs}
	}
	var overflow int64
	limit := bins[n-1].ToMs
	for _, bar := range h.Distribution() {
		if bar.Count == 0 {
			continue
		}
		v := float64(bar.From) / 1000
		if v > limit {
			overflow += bar.Count
			continue
		}
		bins[min(n-1, int(v/binMs))].Count += bar.Count
	}
	for i := range bins {
		bins[i].Percent = round1(float64(bins[i].Count) / float64(total) * 100)
	}
	if overflow > 0 {
		bins = append(bins, Bin{FromMs: limit, Count: overflow, Percent: round1(float64(overflow) / float64(total) * 100), Overflow: true})
	}
	return bins
}

func niceBinSize(v float64) float64 {
	if v <= 1 {
		return 1
	}
	mag := math.Pow(10, math.Floor(math.Log10(v)))
	switch n := v / mag; {
	case n <= 1:
		return mag
	case n <= 2:
		return 2 * mag
	case n <= 5:
		return 5 * mag
	default:
		return 10 * mag
	}
}

func httpClass(status int) string {
	if status >= 500 {
		return "HTTP_5xx"
	}
	return "HTTP_4xx"
}

func firstLine(s string) string {
	s, _, _ = strings.Cut(strings.TrimSpace(s), "\n")
	if r := []rune(s); len(r) > 240 {
		s = string(r[:240]) + "…"
	}
	return s
}

func ms(d time.Duration) float64 { return float64(d.Microseconds()) / 1000 }
func usToMs(us int64) float64    { return round2(float64(us) / 1000) }
func round2(v float64) float64   { return math.Round(v*100) / 100 }
func round1(v float64) float64   { return math.Round(v*10) / 10 }
