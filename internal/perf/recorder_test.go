package perf

import (
	"encoding/json"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"adomnia/internal/activity"
)

// TestHelperProcess is re-executed by the recording tests as a real child
// process, so the process tree walk has a genuine descendant to report.
func TestHelperProcess(t *testing.T) {
	if os.Getenv("PERF_TEST_HELPER") != "1" {
		return
	}
	time.Sleep(4 * time.Second)
}

func startHelperProcess(t *testing.T) *exec.Cmd {
	t.Helper()
	cmd := exec.Command(os.Args[0], "-test.run=TestHelperProcess")
	cmd.Env = append(os.Environ(), "PERF_TEST_HELPER=1")
	if err := cmd.Start(); err != nil {
		t.Fatalf("start helper process: %v", err)
	}
	t.Cleanup(func() {
		_ = cmd.Process.Kill()
		_, _ = cmd.Process.Wait()
	})
	return cmd
}

func readSamples(t *testing.T, path string) []Sample {
	t.Helper()
	content, err := os.ReadFile(path)
	if err != nil {
		t.Fatalf("read recording: %v", err)
	}
	samples := []Sample{}
	for _, line := range strings.Split(strings.TrimSpace(string(content)), "\n") {
		if strings.TrimSpace(line) == "" {
			continue
		}
		var sample Sample
		if err := json.Unmarshal([]byte(line), &sample); err != nil {
			t.Fatalf("invalid sample line %q: %v", line, err)
		}
		samples = append(samples, sample)
	}
	return samples
}

func TestRecorderWritesRealSamplesWithChildProcess(t *testing.T) {
	helper := startHelperProcess(t)
	dir := t.TempDir()
	recorder, err := Start(dir, "typing continuous", 250*time.Millisecond, nil)
	if err != nil {
		t.Fatalf("start recorder: %v", err)
	}
	if recorder.Scenario() != "typing-continuous" {
		t.Fatalf("scenario not sanitized: %q", recorder.Scenario())
	}
	time.Sleep(1600 * time.Millisecond)
	if err := recorder.Stop(); err != nil {
		t.Fatalf("stop recorder: %v", err)
	}
	if err := recorder.Stop(); err != nil {
		t.Fatalf("second stop must stay clean: %v", err)
	}
	path := recorder.Path()
	if filepath.Dir(path) != filepath.Join(dir, "perf") {
		t.Fatalf("recording outside perf directory: %q", path)
	}
	samples := readSamples(t, path)
	if len(samples) < 2 {
		t.Fatalf("expected at least 2 samples, got %d", len(samples))
	}
	foundChild := false
	for _, sample := range samples {
		if sample.Scenario != "typing-continuous" {
			t.Fatalf("unexpected scenario in sample: %q", sample.Scenario)
		}
		if sample.RootPID != os.Getpid() {
			t.Fatalf("unexpected root pid: %d", sample.RootPID)
		}
		if sample.Runtime.Goroutines <= 0 {
			t.Fatalf("expected live goroutine count, got %d", sample.Runtime.Goroutines)
		}
		if len(sample.Processes) == 0 || sample.RAM == 0 {
			t.Fatalf("expected process tree with RAM, got %+v", sample)
		}
		for _, usage := range sample.Processes {
			if usage.PID == helper.Process.Pid {
				foundChild = true
			}
		}
	}
	if !foundChild {
		t.Fatalf("child process %d never appeared in the recorded tree", helper.Process.Pid)
	}
}

func TestRecorderIncludesFrontendMetrics(t *testing.T) {
	if _, err := activity.Default.Report("perf-test", activity.Idle, []string{"goide:perf-test"}); err != nil {
		t.Fatal(err)
	}
	defer activity.Default.RemoveWindow("perf-test")
	SetFrontendMetrics(map[string]any{"inputP95Ms": 12.5})
	defer SetFrontendMetrics(nil)
	dir := t.TempDir()
	recorder, err := Start(dir, "idle", 250*time.Millisecond, nil)
	if err != nil {
		t.Fatalf("start recorder: %v", err)
	}
	if err := recorder.Stop(); err != nil {
		t.Fatalf("stop recorder: %v", err)
	}
	samples := readSamples(t, recorder.Path())
	if len(samples) == 0 {
		t.Fatal("expected at least one sample")
	}
	if samples[0].Frontend["inputP95Ms"] != 12.5 {
		t.Fatalf("frontend metrics missing: %+v", samples[0].Frontend)
	}
	if samples[0].Activity.Scopes["goide:perf-test"] != activity.Idle {
		t.Fatalf("activity scope missing from sample: %+v", samples[0].Activity)
	}
}

func TestSetFrontendMetricsJSONIgnoresMalformedInput(t *testing.T) {
	SetFrontendMetrics(nil)
	SetFrontendMetricsJSON("not json")
	if frontendMetrics() != nil {
		t.Fatal("malformed metrics must be ignored")
	}
	SetFrontendMetricsJSON(`{"framesDropped":3}`)
	defer SetFrontendMetrics(nil)
	if frontendMetrics()["framesDropped"] != float64(3) {
		t.Fatalf("expected parsed metrics, got %+v", frontendMetrics())
	}
}

func TestSanitizeScenario(t *testing.T) {
	for input, expected := range map[string]string{
		"idle":                 "idle",
		"typing continuous":    "typing-continuous",
		"../../etc/passwd":     "etc-passwd",
		"3-5 workspaces":       "3-5-workspaces",
		"":                     "adhoc",
		"...":                  "adhoc",
		"apertura/chiusura×10": "apertura-chiusura-10",
	} {
		if got := sanitizeScenario(input); got != expected {
			t.Fatalf("sanitizeScenario(%q) = %q, want %q", input, got, expected)
		}
	}
}

func TestScenarioFromEnv(t *testing.T) {
	config, ok := scenarioFromEnv(envLookup(map[string]string{}))
	if ok {
		t.Fatalf("expected no scenario, got %+v", config)
	}
	config, ok = scenarioFromEnv(envLookup(map[string]string{
		"ADOMNIA_PERF_SCENARIO": "cold-start",
	}))
	if !ok || config.Scenario != "cold-start" || config.Interval != DefaultScenarioInterval || config.Duration != 0 {
		t.Fatalf("unexpected defaults: %+v ok=%v", config, ok)
	}
	config, _ = scenarioFromEnv(envLookup(map[string]string{
		"ADOMNIA_PERF_SCENARIO": "idle-30m",
		"ADOMNIA_PERF_INTERVAL": "500ms",
		"ADOMNIA_PERF_DURATION": "30m",
	}))
	if config.Interval != 500*time.Millisecond || config.Duration != 30*time.Minute {
		t.Fatalf("overrides not applied: %+v", config)
	}
	config, _ = scenarioFromEnv(envLookup(map[string]string{
		"ADOMNIA_PERF_SCENARIO": "idle",
		"ADOMNIA_PERF_INTERVAL": "nonsense",
		"ADOMNIA_PERF_DURATION": "-1",
	}))
	if config.Interval != DefaultScenarioInterval || config.Duration != 0 {
		t.Fatalf("invalid overrides must fall back to defaults: %+v", config)
	}
}

func TestMaybeStartFromEnv(t *testing.T) {
	t.Setenv("ADOMNIA_PERF_SCENARIO", "")
	if recorder := MaybeStartFromEnv(t.TempDir(), nil); recorder != nil {
		_ = recorder.Stop()
		t.Fatal("recording must not start without a scenario")
	}
	t.Setenv("ADOMNIA_PERF_SCENARIO", "startup")
	dir := t.TempDir()
	recorder := MaybeStartFromEnv(dir, nil)
	if recorder == nil {
		t.Fatal("expected recording to start")
	}
	defer recorder.Stop()
	if _, err := os.Stat(recorder.Path()); err != nil {
		t.Fatalf("recording file missing: %v", err)
	}
}
