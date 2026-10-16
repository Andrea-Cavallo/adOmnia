package perf

import (
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"regexp"
	"runtime"
	"strings"
	"sync"
	"time"

	"adomnia/internal/activity"
	"adomnia/internal/resources"
)

// DefaultScenarioInterval matches the resources sampler cache (1s), so every
// recorded line carries a fresh CPU delta.
const DefaultScenarioInterval = time.Second

// minScenarioInterval protects the application from a pathological request.
const minScenarioInterval = 250 * time.Millisecond

var scenarioNameSanitizer = regexp.MustCompile(`[^a-zA-Z0-9._-]+`)

// RuntimeStats are Go runtime counters of the backend process itself.
type RuntimeStats struct {
	Goroutines     int     `json:"goroutines"`
	HeapAlloc      uint64  `json:"heapAlloc"`
	HeapInuse      uint64  `json:"heapInuse"`
	HeapSys        uint64  `json:"heapSys"`
	Sys            uint64  `json:"sys"`
	NumGC          uint32  `json:"numGC"`
	GCPauseTotalNs uint64  `json:"gcPauseTotalNs"`
	GCCPUFraction  float64 `json:"gcCpuFraction"`
}

// Sample is one recorded line: the backend's own runtime counters plus the
// process tree (WebView2, gopls, debug adapters, child tools) with per-process
// RAM and CPU. Local diagnostics only.
type Sample struct {
	At        string            `json:"at"`
	Scenario  string            `json:"scenario"`
	RootPID   int               `json:"rootPid"`
	Runtime   RuntimeStats      `json:"runtime"`
	Processes []resources.Usage `json:"processes"`
	RAM       uint64            `json:"ram"`
	CPU       float64           `json:"cpu"`
	Instances int               `json:"instances"`
	Frontend  map[string]any    `json:"frontend,omitempty"`
	Activity  activity.Snapshot `json:"activity"`
}

// Recorder writes periodic scenario samples to a local JSONL file.
type Recorder struct {
	path     string
	scenario string
	file     *os.File
	stop     chan struct{}
	done     chan struct{}
	targets  func() []resources.Target

	mu         sync.Mutex
	lastSnapAt time.Time
	err        error
}

// sanitizeScenario keeps recorded filenames safe and stable across runs.
func sanitizeScenario(scenario string) string {
	cleaned := scenarioNameSanitizer.ReplaceAllString(strings.TrimSpace(scenario), "-")
	cleaned = strings.Trim(cleaned, "-.")
	if cleaned == "" {
		return "adhoc"
	}
	return cleaned
}

// Start opens a new recording under <dataDir>/perf and samples until Stop.
// targets may be nil; the process tree walk still reports every descendant.
func Start(dataDir, scenario string, interval time.Duration, targets func() []resources.Target) (*Recorder, error) {
	if interval <= 0 {
		interval = DefaultScenarioInterval
	}
	if interval < minScenarioInterval {
		interval = minScenarioInterval
	}
	name := sanitizeScenario(scenario)
	dir := filepath.Join(dataDir, "perf")
	if err := os.MkdirAll(dir, 0700); err != nil {
		return nil, fmt.Errorf("create perf recording directory: %w", err)
	}
	path := filepath.Join(dir, fmt.Sprintf("%s-%s.jsonl", name, time.Now().UTC().Format("20060102-150405")))
	file, err := os.OpenFile(path, os.O_APPEND|os.O_CREATE|os.O_WRONLY, 0600)
	if err != nil {
		return nil, fmt.Errorf("open perf recording: %w", err)
	}
	recorder := &Recorder{
		path:     path,
		scenario: name,
		file:     file,
		stop:     make(chan struct{}),
		done:     make(chan struct{}),
		targets:  targets,
	}
	go recorder.loop(interval)
	return recorder, nil
}

// Path is the local JSONL file being written.
func (r *Recorder) Path() string { return r.path }

// Scenario is the sanitized scenario name.
func (r *Recorder) Scenario() string { return r.scenario }

// Active reports whether the recording loop is still running.
func (r *Recorder) Active() bool {
	select {
	case <-r.stop:
		return false
	default:
		return true
	}
}

// Stop finishes the recording and closes the file. Safe to call twice.
func (r *Recorder) Stop() error {
	r.mu.Lock()
	select {
	case <-r.stop:
		r.mu.Unlock()
		<-r.done
		return r.err
	default:
		close(r.stop)
	}
	r.mu.Unlock()
	<-r.done
	return r.err
}

func (r *Recorder) loop(interval time.Duration) {
	defer close(r.done)
	defer r.file.Close()
	ticker := time.NewTicker(interval)
	defer ticker.Stop()
	r.record()
	for {
		select {
		case <-r.stop:
			return
		case <-ticker.C:
			r.record()
		}
	}
}

// record appends one sample. Cached resource snapshots (same At) are skipped:
// without a fresh process walk there is no CPU delta to report.
func (r *Recorder) record() {
	targets := []resources.Target{}
	if r.targets != nil {
		targets = r.targets()
	}
	snapshot := resources.Sample(targets)
	r.mu.Lock()
	if !r.lastSnapAt.IsZero() && !snapshot.At.After(r.lastSnapAt) {
		r.mu.Unlock()
		return
	}
	r.lastSnapAt = snapshot.At
	sample := Sample{
		At:        time.Now().UTC().Format(time.RFC3339Nano),
		Scenario:  r.scenario,
		RootPID:   os.Getpid(),
		Runtime:   runtimeStats(),
		Processes: snapshot.Processes,
		RAM:       snapshot.RAM,
		CPU:       snapshot.CPU,
		Instances: snapshot.Instances,
		Frontend:  frontendMetrics(),
		Activity:  activity.Default.Snapshot(),
	}
	err := json.NewEncoder(r.file).Encode(sample)
	if err != nil && r.err == nil {
		r.err = fmt.Errorf("write perf sample: %w", err)
	}
	r.mu.Unlock()
}

func runtimeStats() RuntimeStats {
	var mem runtime.MemStats
	runtime.ReadMemStats(&mem)
	return RuntimeStats{
		Goroutines:     runtime.NumGoroutine(),
		HeapAlloc:      mem.HeapAlloc,
		HeapInuse:      mem.HeapInuse,
		HeapSys:        mem.HeapSys,
		Sys:            mem.Sys,
		NumGC:          mem.NumGC,
		GCPauseTotalNs: mem.PauseTotalNs,
		GCCPUFraction:  mem.GCCPUFraction,
	}
}

var frontendMu sync.Mutex
var frontendLatest map[string]any

// SetFrontendMetrics stores renderer-side metrics (for example input latency
// percentiles) merged into the following samples. Values stay in memory and in
// the local recording only.
func SetFrontendMetrics(metrics map[string]any) {
	frontendMu.Lock()
	defer frontendMu.Unlock()
	frontendLatest = metrics
}

// SetFrontendMetricsJSON is the binding-friendly variant; malformed JSON is ignored.
func SetFrontendMetricsJSON(metricsJSON string) {
	var metrics map[string]any
	if err := json.Unmarshal([]byte(metricsJSON), &metrics); err != nil {
		return
	}
	SetFrontendMetrics(metrics)
}

func frontendMetrics() map[string]any {
	frontendMu.Lock()
	defer frontendMu.Unlock()
	if frontendLatest == nil {
		return nil
	}
	merged := make(map[string]any, len(frontendLatest))
	for key, value := range frontendLatest {
		merged[key] = value
	}
	return merged
}

// ScenarioConfig describes an env-requested recording.
type ScenarioConfig struct {
	Scenario string
	Interval time.Duration
	Duration time.Duration
}

// ScenarioFromEnv reads the opt-in recording request:
//
//	ADOMNIA_PERF_SCENARIO=<name>       enables recording for that scenario
//	ADOMNIA_PERF_INTERVAL=<duration>   sampling interval (default 1s)
//	ADOMNIA_PERF_DURATION=<duration>   auto-stop after this time (0 = until shutdown)
func ScenarioFromEnv() (ScenarioConfig, bool) {
	return scenarioFromEnv(os.Getenv)
}

func scenarioFromEnv(getenv func(string) string) (ScenarioConfig, bool) {
	scenario := strings.TrimSpace(getenv("ADOMNIA_PERF_SCENARIO"))
	if scenario == "" {
		return ScenarioConfig{}, false
	}
	config := ScenarioConfig{Scenario: scenario, Interval: DefaultScenarioInterval}
	if raw := strings.TrimSpace(getenv("ADOMNIA_PERF_INTERVAL")); raw != "" {
		if parsed, err := time.ParseDuration(raw); err == nil && parsed > 0 {
			config.Interval = parsed
		}
	}
	if raw := strings.TrimSpace(getenv("ADOMNIA_PERF_DURATION")); raw != "" {
		if parsed, err := time.ParseDuration(raw); err == nil && parsed > 0 {
			config.Duration = parsed
		}
	}
	return config, true
}

// MaybeStartFromEnv starts a recording when ADOMNIA_PERF_SCENARIO requests it,
// auto-stopping after ADOMNIA_PERF_DURATION when set. Returns nil when no
// recording is requested and keeps the started recorder reachable through
// Current for the binding layer.
func MaybeStartFromEnv(dataDir string, targets func() []resources.Target) *Recorder {
	config, ok := ScenarioFromEnv()
	if !ok {
		return nil
	}
	recorder, err := Start(dataDir, config.Scenario, config.Interval, targets)
	if err != nil {
		return nil
	}
	currentMu.Lock()
	current = recorder
	currentMu.Unlock()
	if config.Duration > 0 {
		go func() {
			time.Sleep(config.Duration)
			_ = recorder.Stop()
		}()
	}
	return recorder
}

var (
	currentMu sync.Mutex
	current   *Recorder
)

// Current reports the recording started from the environment, if any.
func Current() *Recorder {
	currentMu.Lock()
	defer currentMu.Unlock()
	return current
}
