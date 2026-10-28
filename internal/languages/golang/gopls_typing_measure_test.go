package golang

import (
	"context"
	"errors"
	"fmt"
	"io"
	"net/http"
	"os"
	"path/filepath"
	"slices"
	"sort"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/Andrea-Cavallo/adOmnia/internal/ide/langserver"
	"github.com/Andrea-Cavallo/adOmnia/internal/ide/lsp"
	"github.com/Andrea-Cavallo/adOmnia/internal/ide/sdk"
	"github.com/Andrea-Cavallo/adOmnia/internal/ide/workspace"
	"github.com/shirou/gopsutil/v4/process"
)

// typingScript is typed one rune per tick into an existing function body, then
// erased: the buffer keeps a realistic size while completion, type checking and
// diagnostics keep working on new text.
const typingScript = "\tcounted := len(document.text)\n\tif counted > 0 {\n\t\tcounted++\n\t}\n\t_ = counted\n"

// Opt-in measurement of the PERF-1.1 scenario (typing-continuous): a real gopls
// is driven through the same manager the editor uses, with incremental didChange,
// completion and hover, while the process RSS and CPU are sampled every second.
// Typing runs continuously; every 20 keystrokes there is a 200 ms settle pause and
// the completion/hover requested after it is never superseded, so its latency is
// the one the editor actually shows. It never runs in a normal test pass.
//
//	ADOMNIA_MEASURE_LSP_ROOT       workspace root (required)
//	ADOMNIA_MEASURE_LSP_BINARY     gopls binary (required)
//	ADOMNIA_MEASURE_LSP_TYPING     set to 1 to enable this scenario
//	ADOMNIA_MEASURE_LSP_LIMIT      GOMEMLIMIT, e.g. 768MiB (default 768MiB)
//	ADOMNIA_MEASURE_LSP_DURATION   typing time, e.g. 10m (default 10m)
//	ADOMNIA_MEASURE_LSP_INTERVAL   keystroke interval (default 150ms)
//	ADOMNIA_MEASURE_LSP_FILE       file to type in, relative to root
//	ADOMNIA_MEASURE_LSP_OUT        CSV output path (default: temp directory)
func TestMeasureLanguageServerTyping(t *testing.T) {
	root := os.Getenv("ADOMNIA_MEASURE_LSP_ROOT")
	binary := os.Getenv("ADOMNIA_MEASURE_LSP_BINARY")
	if os.Getenv("ADOMNIA_MEASURE_LSP_TYPING") != "1" || root == "" || binary == "" {
		t.Skip("set ADOMNIA_MEASURE_LSP_TYPING=1, ADOMNIA_MEASURE_LSP_ROOT and ADOMNIA_MEASURE_LSP_BINARY")
	}
	limit := envOr("ADOMNIA_MEASURE_LSP_LIMIT", "768MiB")
	duration := envDuration(t, "ADOMNIA_MEASURE_LSP_DURATION", 10*time.Minute)
	interval := envDuration(t, "ADOMNIA_MEASURE_LSP_INTERVAL", 150*time.Millisecond)
	target := envOr("ADOMNIA_MEASURE_LSP_FILE", filepath.Join("internal", "codestudio", "lsp_features.go"))
	path := filepath.Join(root, target)
	content, err := os.ReadFile(path)
	if err != nil {
		t.Fatalf("read typing target: %v", err)
	}
	marker := strings.TrimSpace(os.Getenv("ADOMNIA_MEASURE_LSP_ANCHOR"))
	if marker == "" {
		marker = "document, process, err := m.snapshot(sessionID, documentID)"
	}
	insertLine := firstBodyLine(t, string(content), marker)

	manager := langserver.NewLSPManager(goOnlyRegistry())
	t.Cleanup(manager.Shutdown)
	env := []string{"GOMEMLIMIT=" + limit}
	for _, value := range os.Environ() {
		if !strings.HasPrefix(strings.ToUpper(value), "GOMEMLIMIT=") {
			env = append(env, value)
		}
	}
	env = sdk.WithDefaultEnvironment(env, map[string]string{"GO_TELEMETRY_CHILD": "2"})
	session := workspace.Session{ID: "typing", Project: workspace.Project{Name: "typing", RealPath: root, RootPath: root}}
	spec := GoplsServerSpec(GoplsInfo{Binary: binary}, env, GoplsSettings{})
	// Profilo CPU di gopls (PERF-1.4): `gopls serve` non ha -cpuprofile, espone pprof
	// con -debug. Il profilo viene scaricato mentre il workspace si carica.
	profileOut := strings.TrimSpace(os.Getenv("ADOMNIA_MEASURE_LSP_CPUPROFILE"))
	if profileOut != "" {
		address := strings.TrimSpace(os.Getenv("ADOMNIA_MEASURE_LSP_DEBUG"))
		if address == "" {
			t.Fatal("ADOMNIA_MEASURE_LSP_CPUPROFILE requires ADOMNIA_MEASURE_LSP_DEBUG=localhost:PORT")
		}
		spec.Arguments = append(spec.Arguments, "-debug", address)
		go func() {
			if err := captureCPUProfile(address, profileOut); err != nil {
				t.Logf("cpu profile: %v", err)
			}
		}()
	}
	started := time.Now()
	status, err := manager.Start(session, spec)
	if err != nil {
		t.Fatal(err)
	}
	defer manager.CloseSession(session.ID)
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Minute)
	defer cancel()
	if _, err := manager.WorkspaceSymbols(ctx, session.ID, "LSPManager"); err != nil {
		t.Fatalf("workspace ready: %v", err)
	}
	loaded := time.Since(started)
	proc, err := process.NewProcess(int32(status.PID))
	if err != nil {
		t.Fatal(err)
	}

	manager.TrackDocument(session, workspace.Document{ID: "typing", Path: path, URI: lsp.FileURI(path)}, string(content), false)

	recording := newTypingRecording(t, limit, duration)
	recording.start(proc)
	version := 1
	typed := ""
	cursorLine, cursorColumn := insertLine, 0
	deadline := time.Now().Add(duration)
	ticker := time.NewTicker(interval)
	defer ticker.Stop()
	script := 0
	typedCount := 0
	settled := 0
	for time.Now().Before(deadline) {
		<-ticker.C
		key := typingScript[script]
		script++
		typed += string(key)
		if script == len(typingScript) {
			script = 0
		}
		cursorLine, cursorColumn = materializeTyping(t, manager, session.ID, string(content), version+1, insertLine, typed, path)
		version++
		typedCount++
		if typedCount%20 == 0 && cursorColumn > 0 {
			// Settle like a developer reading the popup: the request below is never
			// superseded, so its latency is the one the editor actually shows.
			time.Sleep(200 * time.Millisecond)
			settled++
			recording.request("completion", "completion-superseded", func() error {
				requestCtx, stop := context.WithTimeout(context.Background(), 10*time.Second)
				defer stop()
				_, err := manager.Completion(requestCtx, session.ID, "typing", cursorLine+1, cursorColumn)
				return err
			})
			if settled%4 == 0 {
				recording.request("hover", "hover-superseded", func() error {
					requestCtx, stop := context.WithTimeout(context.Background(), 10*time.Second)
					defer stop()
					_, err := manager.Hover(requestCtx, session.ID, "typing", cursorLine+1, cursorColumn)
					return err
				})
			}
		}
		if script == 0 {
			// Erase the typed block and let diagnostics settle before typing again.
			cursorLine, cursorColumn = materializeTyping(t, manager, session.ID, string(content), version+1, insertLine, "", path)
			version++
			time.Sleep(500 * time.Millisecond)
		}
	}
	recording.stop()
	summary := recording.summary(loaded, target, typedCount)
	t.Logf("%s", summary.line)
	if err := recording.writeCSV(summary.csvPath); err != nil {
		t.Fatalf("write csv: %v", err)
	}
	t.Logf("csv=%s", summary.csvPath)
}

// captureCPUProfile downloads a few seconds of gopls CPU profile from its debug
// server (-debug=host:port). The workspace load happens in that window.
func captureCPUProfile(address, path string) error {
	deadline := time.Now().Add(20 * time.Second)
	for time.Now().Before(deadline) {
		response, err := http.Get("http://" + address + "/debug/pprof/profile?seconds=6")
		if err != nil {
			time.Sleep(200 * time.Millisecond)
			continue
		}
		defer response.Body.Close()
		if response.StatusCode != http.StatusOK {
			time.Sleep(200 * time.Millisecond)
			continue
		}
		if err := os.MkdirAll(filepath.Dir(path), 0o700); err != nil {
			return err
		}
		file, err := os.Create(path)
		if err != nil {
			return err
		}
		defer file.Close()
		_, err = io.Copy(file, response.Body)
		return err
	}
	return fmt.Errorf("debug server %s did not answer", address)
}

// firstBodyLine returns the 0-based line index where typed text is inserted: the
// line holding anchor, or the first line of the first function body when the
// anchor does not exist in this workspace.
func firstBodyLine(t *testing.T, content, anchor string) int {
	t.Helper()
	if before, _, ok := strings.Cut(content, anchor); ok {
		return strings.Count(before, "\n") // 1-based line of the anchor, minus one
	}
	for index, line := range strings.Split(content, "\n") {
		if strings.HasPrefix(line, "func ") && strings.HasSuffix(strings.TrimSpace(line), "{") {
			return index + 1
		}
	}
	t.Fatalf("no function body found in the typing target (anchor %q)", anchor)
	return 0
}

// materializeTyping writes the original file plus the typed prefix into the
// manager and returns the 0-based caret position after the typed text.
func materializeTyping(t *testing.T, manager *langserver.LSPManager, sessionID langserver.SessionID, original string, version, insertLine int, typed, path string) (int, int) {
	t.Helper()
	if typed == "" {
		if err := manager.UpdateDocument(sessionID, "typing", version, original); err != nil {
			t.Fatalf("update document: %v", err)
		}
		return insertLine, 0
	}
	lines := strings.Split(original, "\n")
	typedLines := strings.Split(typed, "\n")
	merged := make([]string, 0, len(lines)+len(typedLines))
	merged = append(merged, lines[:insertLine]...)
	merged = append(merged, typedLines...)
	merged = append(merged, lines[insertLine:]...)
	if err := manager.UpdateDocument(sessionID, "typing", version, strings.Join(merged, "\n")); err != nil {
		t.Fatalf("update document: %v", err)
	}
	return insertLine + len(typedLines) - 1, len(typedLines[len(typedLines)-1])
}

type typingSample struct {
	at  time.Duration
	rss uint64
	cpu float64
}

type typingRequest struct {
	kind    string
	at      time.Duration
	latency time.Duration
	err     error
}

type typingRecorder struct {
	limit    string
	duration time.Duration
	begin    time.Time

	mu       sync.Mutex
	samples  []typingSample
	requests []typingRequest
	stopCh   chan struct{}
	stopped  chan struct{}
}

func newTypingRecording(t *testing.T, limit string, duration time.Duration) *typingRecorder {
	_ = t
	return &typingRecorder{limit: limit, duration: duration, stopCh: make(chan struct{}), stopped: make(chan struct{})}
}

func (r *typingRecorder) start(proc *process.Process) {
	r.begin = time.Now()
	go func() {
		defer close(r.stopped)
		ticker := time.NewTicker(time.Second)
		defer ticker.Stop()
		for {
			select {
			case <-r.stopCh:
				return
			case <-ticker.C:
				memory, err := proc.MemoryInfo()
				if err != nil {
					return
				}
				times, err := proc.Times()
				if err != nil {
					return
				}
				r.mu.Lock()
				r.samples = append(r.samples, typingSample{at: time.Since(r.begin), rss: memory.RSS, cpu: times.User + times.System})
				r.mu.Unlock()
			}
		}
	}()
}

func (r *typingRecorder) request(kind, supersededKind string, call func() error) {
	start := time.Now()
	err := call()
	latency := time.Since(start)
	if err != nil && (errors.Is(err, context.Canceled) || errors.Is(err, context.DeadlineExceeded)) {
		kind = supersededKind
	}
	r.mu.Lock()
	r.requests = append(r.requests, typingRequest{kind: kind, at: time.Since(r.begin), latency: latency, err: err})
	r.mu.Unlock()
}

func (r *typingRecorder) stop() {
	close(r.stopCh)
	<-r.stopped
}

type typingSummary struct {
	line    string
	csvPath string
}

func (r *typingRecorder) summary(loaded time.Duration, target string, keystrokes int) typingSummary {
	r.mu.Lock()
	samples := append([]typingSample(nil), r.samples...)
	requests := append([]typingRequest(nil), r.requests...)
	r.mu.Unlock()
	rss := make([]uint64, 0, len(samples))
	for _, sample := range samples {
		rss = append(rss, sample.rss)
	}
	slices.Sort(rss)
	median, max, first := uint64(0), uint64(0), uint64(0)
	if len(rss) > 0 {
		median = rss[len(rss)/2]
		max = rss[len(rss)-1]
		first = samples[0].rss
	}
	cpu := 0.0
	cores := 0.0
	if len(samples) > 0 {
		cpu = samples[len(samples)-1].cpu
		if elapsed := r.duration.Seconds(); elapsed > 0 {
			cores = (cpu - samples[0].cpu) / elapsed
		}
	}
	completion := percentiles(requests, "completion")
	hover := percentiles(requests, "hover")
	errorsCount := 0
	superseded := 0
	for _, request := range requests {
		switch {
		case strings.HasSuffix(request.kind, "-superseded"):
			superseded++
		case request.err != nil:
			errorsCount++
		}
	}
	line := fmt.Sprintf("scenario=typing-continuous limit=%s file=%s duration=%s keystrokes=%d rss_first_MiB=%.1f rss_median_MiB=%.1f rss_max_MiB=%.1f samples=%d load_ms=%d completion_p50_ms=%.1f completion_p95_ms=%.1f completion_n=%d hover_p50_ms=%.1f hover_p95_ms=%.1f hover_n=%d request_errors=%d superseded=%d cpu_seconds=%.2f cpu_cores=%.2f",
		r.limit, target, r.duration, keystrokes, float64(first)/(1<<20), float64(median)/(1<<20), float64(max)/(1<<20), len(samples), loaded.Milliseconds(),
		completion.p50, completion.p95, completion.n, hover.p50, hover.p95, hover.n, errorsCount, superseded, cpu, cores)
	name := fmt.Sprintf("adomnia-lsp-typing-%s-%s.csv", strings.NewReplacer("/", "-").Replace(r.limit), time.Now().UTC().Format("20060102-150405"))
	out := os.Getenv("ADOMNIA_MEASURE_LSP_OUT")
	switch {
	case out == "":
		out = filepath.Join(os.TempDir(), name)
	case strings.EqualFold(filepath.Ext(out), ".csv"):
	default:
		out = filepath.Join(out, name)
	}
	return typingSummary{line: line, csvPath: out}
}

type latencyStats struct {
	p50, p95 float64
	n        int
}

func percentiles(requests []typingRequest, kind string) latencyStats {
	values := make([]float64, 0, len(requests))
	for _, request := range requests {
		if request.kind == kind && request.err == nil {
			values = append(values, float64(request.latency.Microseconds())/1000)
		}
	}
	if len(values) == 0 {
		return latencyStats{}
	}
	sort.Float64s(values)
	pick := func(fraction float64) float64 {
		return values[int(fraction*float64(len(values)-1))]
	}
	return latencyStats{p50: pick(0.5), p95: pick(0.95), n: len(values)}
}

func (r *typingRecorder) writeCSV(path string) error {
	if err := os.MkdirAll(filepath.Dir(path), 0o700); err != nil {
		return err
	}
	var builder strings.Builder
	builder.WriteString("kind,at_ms,latency_ms,rss_MiB,cpu_seconds,error\n")
	r.mu.Lock()
	for _, sample := range r.samples {
		fmt.Fprintf(&builder, "sample,%d,,%.1f,%.2f,\n", sample.at.Milliseconds(), float64(sample.rss)/(1<<20), sample.cpu)
	}
	for _, request := range r.requests {
		errText := ""
		if request.err != nil {
			errText = strings.ReplaceAll(request.err.Error(), ",", ";")
		}
		fmt.Fprintf(&builder, "%s,%d,%.1f,,,%s\n", request.kind, request.at.Milliseconds(), float64(request.latency.Microseconds())/1000, errText)
	}
	r.mu.Unlock()
	return os.WriteFile(path, []byte(builder.String()), 0o600)
}

func envOr(key, fallback string) string {
	if value := strings.TrimSpace(os.Getenv(key)); value != "" {
		return value
	}
	return fallback
}

func envDuration(t *testing.T, key string, fallback time.Duration) time.Duration {
	t.Helper()
	raw := strings.TrimSpace(os.Getenv(key))
	if raw == "" {
		return fallback
	}
	parsed, err := time.ParseDuration(raw)
	if err != nil {
		t.Fatalf("%s: %v", key, err)
	}
	return parsed
}
