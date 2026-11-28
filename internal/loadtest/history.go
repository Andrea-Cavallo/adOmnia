package loadtest

import (
	"encoding/json/v2"
	"errors"
	"fmt"
	"slices"
	"strings"
	"time"

	"github.com/Andrea-Cavallo/adOmnia/internal/jsonutil"
)

// History keeps the finished runs in bbolt: a small summary per run for the list, the full
// report apart, the oldest dropped past the retention.
type History struct {
	Put       func(bucket, key string, value []byte) error
	Get       func(bucket, key string) ([]byte, error)
	List      func(bucket, prefix string) ([]string, error)
	Delete    func(bucket, key string) error
	Retention int // runs kept; 0 = DefaultRetention
}

const (
	historyBucket    = "loadtest"
	summaryPrefix    = "run:"
	resultPrefix     = "result:"
	DefaultRetention = 200
	// storedTimeline caps the per-request log kept in the history: the aggregates count
	// every request, the log is for the raw CSV and the inspector.
	storedTimeline = 5000
)

// RunSummary is one row of the run list.
type RunSummary struct {
	ID           string   `json:"id"`
	Name         string   `json:"name"`
	Target       string   `json:"target"` // request | flow | grpc
	TargetLabel  string   `json:"targetLabel"`
	Executor     string   `json:"executor"`
	StartedAt    string   `json:"startedAt"`
	Aborted      bool     `json:"aborted,omitzero"`
	AbortReason  string   `json:"abortReason,omitempty"`
	Requests     int      `json:"requests"`
	ErrorRate    float64  `json:"errorRate"`
	P95Ms        float64  `json:"p95Ms"`
	Throughput   float64  `json:"throughput"`
	GateFailures []string `json:"gateFailures,omitempty"`
	ScenarioHash string   `json:"scenarioHash,omitempty"`
	Imported     bool     `json:"imported,omitzero"` // migrated from the old Flow Stress history
}

// RunRecord is a saved run: its summary and the full report.
type RunRecord struct {
	Summary RunSummary `json:"summary"`
	Result  Result     `json:"result"`
}

func summarize(id string, r Result) RunSummary {
	s := RunSummary{
		ID: id, Name: r.Name, Executor: r.Executor, StartedAt: r.StartedAt, Aborted: r.Aborted, AbortReason: r.AbortReason,
		Requests: r.Successful + r.Failed, ErrorRate: r.ErrorRate, P95Ms: r.P95Ms, Throughput: r.Throughput, GateFailures: r.GateFailures,
	}
	if m := r.Manifest; m != nil {
		s.Target, s.TargetLabel, s.ScenarioHash = m.Target, m.TargetLabel, m.ScenarioHash
	}
	return s
}

// historyKey sorts by start time: the newest is last in bbolt's byte order.
func historyKey(r Result, id string) string {
	started, err := time.Parse(time.RFC3339Nano, r.StartedAt)
	if err != nil {
		started = time.Now()
	}
	return started.UTC().Format("20060102T150405.000000000") + "-" + id
}

// Save stores a finished run and applies the retention.
func (h *History) Save(id string, r Result) (RunSummary, error) {
	key := historyKey(r, id)
	summary := summarize(key, r)
	if len(r.Timeline) > storedTimeline {
		r.Timeline, r.TimelineTruncated = r.Timeline[:storedTimeline], true
	}
	full, err := jsonutil.Marshal(r)
	if err != nil {
		return summary, fmt.Errorf("encode run: %w", err)
	}
	head, err := jsonutil.Marshal(summary)
	if err != nil {
		return summary, fmt.Errorf("encode run summary: %w", err)
	}
	if err := h.Put(historyBucket, resultPrefix+key, full); err != nil {
		return summary, fmt.Errorf("save run: %w", err)
	}
	if err := h.Put(historyBucket, summaryPrefix+key, head); err != nil {
		return summary, fmt.Errorf("save run: %w", err)
	}
	h.prune()
	return summary, nil
}

func (h *History) prune() {
	keep := h.Retention
	if keep <= 0 {
		keep = DefaultRetention
	}
	keys, err := h.List(historyBucket, summaryPrefix)
	if err != nil || len(keys) <= keep {
		return
	}
	slices.Sort(keys)
	for _, k := range keys[:len(keys)-keep] {
		id := strings.TrimPrefix(k, summaryPrefix)
		_ = h.Delete(historyBucket, k)               // best effort: a leftover is pruned next time
		_ = h.Delete(historyBucket, resultPrefix+id) // same
	}
}

// Runs lists the saved runs, newest first.
func (h *History) Runs() ([]RunSummary, error) {
	keys, err := h.List(historyBucket, summaryPrefix)
	if err != nil {
		return nil, fmt.Errorf("list runs: %w", err)
	}
	slices.Sort(keys)
	slices.Reverse(keys)
	out := make([]RunSummary, 0, len(keys))
	for _, k := range keys {
		data, err := h.Get(historyBucket, k)
		if err != nil || data == nil {
			continue
		}
		var s RunSummary
		if json.Unmarshal(data, &s) == nil {
			out = append(out, s)
		}
	}
	return out, nil
}

// Run returns the full report of a saved run.
func (h *History) Run(id string) (Result, error) {
	data, err := h.Get(historyBucket, resultPrefix+id)
	if err != nil {
		return Result{}, fmt.Errorf("load run: %w", err)
	}
	if data == nil {
		return Result{}, errors.New("run not found: it may have been deleted or pruned")
	}
	var r Result
	if err := json.Unmarshal(data, &r); err != nil {
		return Result{}, fmt.Errorf("decode run: %w", err)
	}
	return r, nil
}

// DeleteRun removes a saved run.
func (h *History) DeleteRun(id string) error {
	if err := h.Delete(historyBucket, summaryPrefix+id); err != nil {
		return fmt.Errorf("delete run: %w", err)
	}
	return h.Delete(historyBucket, resultPrefix+id)
}

// Import stores a run made elsewhere (an old Flow Stress history entry, a JSON report)
// unless a run with the same start time and name is already there.
func (h *History) Import(r Result) (RunSummary, error) {
	if r.StartedAt == "" {
		return RunSummary{}, errors.New("the run has no start time")
	}
	runs, err := h.Runs()
	if err != nil {
		return RunSummary{}, err
	}
	for _, s := range runs {
		if s.StartedAt == r.StartedAt && s.Name == r.Name {
			return s, nil
		}
	}
	summary, err := h.Save(newRunID(), r)
	if err != nil {
		return summary, err
	}
	summary.Imported = true
	head, err := jsonutil.Marshal(summary)
	if err == nil {
		err = h.Put(historyBucket, summaryPrefix+summary.ID, head)
	}
	return summary, err
}
