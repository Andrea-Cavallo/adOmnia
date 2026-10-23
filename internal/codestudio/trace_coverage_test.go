package codestudio

import (
	"bytes"
	"context"
	"os"
	"path/filepath"
	rtrace "runtime/trace"
	"strconv"
	"strings"
	"testing"
	"time"

	"golang.org/x/exp/trace"
)

// recordTrace produces a real Go trace with goroutine transitions, procs, a region, a task
// and a log, so the builder can be exercised without spawning a go test subprocess.
func recordTrace(t *testing.T) []byte {
	t.Helper()
	var buffer bytes.Buffer
	if err := rtrace.Start(&buffer); err != nil {
		t.Fatalf("trace.Start: %v", err)
	}
	ctx := context.Background()
	done := make(chan struct{})
	go func() {
		time.Sleep(2 * time.Millisecond)
		close(done)
	}()
	ctx, task := rtrace.NewTask(ctx, "coverage-task")
	region := rtrace.StartRegion(ctx, "coverage-region")
	rtrace.Log(ctx, "coverage", "hello")
	time.Sleep(time.Millisecond)
	region.End()
	task.End()
	<-done
	rtrace.Stop()
	return buffer.Bytes()
}

func TestBuildTraceReportReadsGoroutinesProcsAndRegions(t *testing.T) {
	data := recordTrace(t)
	reader, err := trace.NewReader(bytes.NewReader(data))
	if err != nil {
		t.Fatalf("NewReader: %v", err)
	}
	root := t.TempDir()
	report, err := buildTraceReport(root, filepath.Join(root, "trace.out"), reader)
	if err != nil {
		t.Fatalf("buildTraceReport: %v", err)
	}
	if report.Name != "trace.out" {
		t.Fatalf("name: %q", report.Name)
	}
	if report.DurationNanos <= 0 {
		t.Fatalf("duration: %d", report.DurationNanos)
	}
	if len(report.Goroutines) == 0 {
		t.Fatal("no goroutines")
	}
	if len(report.Procs) == 0 {
		t.Fatal("no procs")
	}
	if report.Stats.Goroutines != len(report.Goroutines) {
		t.Fatalf("stats goroutines: %d vs %d", report.Stats.Goroutines, len(report.Goroutines))
	}
	var regions int
	for _, event := range report.Events {
		if event.Category == "region" {
			regions++
		}
	}
	if regions == 0 {
		t.Fatalf("no region events: %+v", report.Events)
	}
}

func TestTraceReasonClassifiers(t *testing.T) {
	network := []string{"network", "NETWORK", "poll", "netpoll", "polling"}
	syncReasons := []string{"chan receive", "sync.Mutex", "select", "semacquire", "WaitGroup", "mutex"}
	gcReasons := []string{"GC", "gc assist", "waiting for GC"}
	for _, reason := range network {
		if !isNetworkReason(reason) {
			t.Errorf("isNetworkReason(%q) = false", reason)
		}
	}
	for _, reason := range syncReasons {
		if !isSyncReason(reason) {
			t.Errorf("isSyncReason(%q) = false", reason)
		}
	}
	for _, reason := range gcReasons {
		if !isGCReason(reason) {
			t.Errorf("isGCReason(%q) = false", reason)
		}
	}
	for _, reason := range []string{"", "sleep", "IO wait"} {
		if isNetworkReason(reason) || isSyncReason(reason) || isGCReason(reason) {
			t.Errorf("%q matched a wait category", reason)
		}
	}
}

func TestTraceRangeKind(t *testing.T) {
	cases := []struct{ name, want string }{
		{"GC (dedicated)", "gc"},
		{"STW stop-the-world", "stw"},
		{"STW: mark termination", "stw"},
		{"my-region", "user"},
		{"", "user"},
	}
	for _, testCase := range cases {
		if got := traceRangeKind(testCase.name); got != testCase.want {
			t.Errorf("traceRangeKind(%q) = %q, want %q", testCase.name, got, testCase.want)
		}
	}
}

func TestTraceGoroutineStateName(t *testing.T) {
	cases := []struct {
		state trace.GoState
		want  string
	}{
		{trace.GoRunning, "running"},
		{trace.GoRunnable, "runnable"},
		{trace.GoWaiting, "waiting"},
		{trace.GoSyscall, "syscall"},
		{trace.GoUndetermined, ""},
		{trace.GoNotExist, ""},
	}
	for _, testCase := range cases {
		if got := goroutineStateName(testCase.state); got != testCase.want {
			t.Errorf("goroutineStateName(%v) = %q, want %q", testCase.state, got, testCase.want)
		}
	}
}

func TestTraceBuilderMarkAndAddEvent(t *testing.T) {
	builder := &traceBuilder{report: TraceReport{Events: []TraceEvent{}}}
	builder.addEvent(TraceEvent{Time: 5, Category: "log", Label: "first"})
	builder.mark(50)
	builder.mark(10)
	builder.mark(90)
	if got := builder.report.Events; len(got) != 1 || got[0].Label != "first" {
		t.Fatalf("events: %+v", got)
	}
	if !builder.haveTime || builder.first != 10 || builder.last != 90 {
		t.Fatalf("time window: %d-%d (%v)", builder.first, builder.last, builder.haveTime)
	}
}

func TestTraceAddWaitStatsAttributesDuration(t *testing.T) {
	stats := TraceStats{}
	addWaitStats(&stats, TraceSpan{State: "running", Start: 0, End: 10})
	if stats.NetworkWait != 0 || stats.SyncWait != 0 || stats.GCWait != 0 {
		t.Fatalf("running span counted as wait: %+v", stats)
	}
	addWaitStats(&stats, TraceSpan{State: "waiting", Reason: "netpoll", Start: 10, End: 40})
	addWaitStats(&stats, TraceSpan{State: "waiting", Reason: "chan receive", Start: 40, End: 50})
	addWaitStats(&stats, TraceSpan{State: "waiting", Reason: "GC assist", Start: 50, End: 80})
	if stats.NetworkWait != 30 {
		t.Errorf("network wait: %d", stats.NetworkWait)
	}
	if stats.SyncWait != 10 {
		t.Errorf("sync wait: %d", stats.SyncWait)
	}
	if stats.GCWait != 30 {
		t.Errorf("gc wait: %d", stats.GCWait)
	}
}

func TestAppendSpansRejectsReversedIntervals(t *testing.T) {
	goroutine := &TraceGoroutine{}
	appendGoroutineSpan(goroutine, nil, 10)
	appendGoroutineSpan(goroutine, &traceGoroutineState{state: "running", start: 20}, 10)
	if len(goroutine.Spans) != 0 || goroutine.Running != 0 {
		t.Fatalf("reversed span appended: %+v", goroutine.Spans)
	}
	proc := &TraceProc{}
	appendProcSpan(proc, nil, 10)
	appendProcSpan(proc, &traceGoroutineState{start: 20}, 10)
	if len(proc.Spans) != 0 || proc.Running != 0 {
		t.Fatalf("reversed proc span appended: %+v", proc.Spans)
	}
}

func TestAppendSpansHonourLimits(t *testing.T) {
	goroutine := &TraceGoroutine{Spans: make([]TraceSpan, maxTraceSpans)}
	appendGoroutineSpan(goroutine, &traceGoroutineState{state: "waiting", start: 0}, 10)
	if len(goroutine.Spans) != maxTraceSpans {
		t.Fatalf("goroutine spans grew to %d", len(goroutine.Spans))
	}
	if goroutine.Waiting != 10 {
		t.Fatalf("duration not accounted: %d", goroutine.Waiting)
	}
	proc := &TraceProc{Spans: make([]TraceSpan, maxTraceProcSpans)}
	appendProcSpan(proc, &traceGoroutineState{start: 0}, 4)
	if len(proc.Spans) != maxTraceProcSpans || proc.Running != 4 {
		t.Fatalf("proc span: %d spans, running %d", len(proc.Spans), proc.Running)
	}
	events := make([]TraceEvent, maxTraceEvents)
	if got := appendTraceEvent(events, TraceEvent{Label: "overflow"}); len(got) != maxTraceEvents {
		t.Fatalf("event limit: %d", len(got))
	}
	if got := appendTraceEvent(nil, TraceEvent{Label: "ok"}); len(got) != 1 || got[0].Label != "ok" {
		t.Fatalf("append below limit: %+v", got)
	}
}

func TestTraceBuilderGoroutineLifecycle(t *testing.T) {
	builder := newTestTraceBuilder()

	builder.onGoroutineDestroyed(42, 5)
	if len(builder.goroutines) != 0 {
		t.Fatalf("untracked goroutine created: %+v", builder.goroutines)
	}

	builder.onGoroutineTransition(10, trace.Event{}, trace.MakeGoStateTransition(7, trace.GoNotExist, trace.GoRunnable))
	goroutine := builder.goroutines[7]
	if goroutine == nil || goroutine.Start != 10 || len(goroutine.StartStack) != 0 {
		t.Fatalf("created goroutine: %+v", goroutine)
	}

	builder.onGoroutineTransition(20, trace.Event{}, trace.MakeGoStateTransition(7, trace.GoRunnable, trace.GoUndetermined))
	if len(goroutine.Spans) != 0 {
		t.Fatalf("undetermined transition recorded a span: %+v", goroutine.Spans)
	}

	builder.onGoroutineTransition(30, trace.Event{}, trace.MakeGoStateTransition(7, trace.GoRunnable, trace.GoNotExist))
	if goroutine.End != 30 || goroutine.Runnable != 20 || builder.goroutineState[7] != nil {
		t.Fatalf("destroyed goroutine: %+v state %+v", goroutine, builder.goroutineState[7])
	}

	builder.onGoroutineTransition(40, trace.Event{}, trace.MakeGoStateTransition(99, trace.GoRunning, trace.GoNotExist))
	if _, tracked := builder.goroutines[99]; tracked {
		t.Fatalf("destroyed untracked goroutine was created: %+v", builder.goroutines[99])
	}
}

func TestTraceBuilderProcLifecycle(t *testing.T) {
	builder := newTestTraceBuilder()
	builder.onProcTransition(10, trace.MakeProcStateTransition(2, trace.ProcIdle, trace.ProcRunning))
	builder.onProcTransition(35, trace.MakeProcStateTransition(2, trace.ProcRunning, trace.ProcIdle))
	proc := builder.procs[2]
	if proc == nil || proc.Running != 25 || len(proc.Spans) != 1 || proc.Spans[0].State != "running" {
		t.Fatalf("proc timeline: %+v", proc)
	}
	if builder.procState[2] != nil {
		t.Fatalf("proc still open: %+v", builder.procState[2])
	}
}

func newTestTraceBuilder() *traceBuilder {
	return &traceBuilder{
		report:         TraceReport{GC: []TraceRange{}, Events: []TraceEvent{}},
		goroutines:     map[int64]*TraceGoroutine{},
		goroutineState: map[int64]*traceGoroutineState{},
		procs:          map[int64]*TraceProc{},
		procState:      map[int64]*traceGoroutineState{},
	}
}

func TestTraceBuilderOnRangeEndClosesOnlyMatchingRange(t *testing.T) {
	builder := &traceBuilder{report: TraceReport{GC: []TraceRange{}, Events: []TraceEvent{}}}
	builder.openRanges = []traceOpenRange{
		{name: "gc-cycle", kind: "gc", start: 10},
		{name: "user-range", kind: "user", start: 20, goroutine: 7},
	}
	builder.onRangeEnd(30, "missing")
	if len(builder.report.GC) != 0 || len(builder.report.Events) != 0 {
		t.Fatal("unknown range changed the report")
	}
	if len(builder.openRanges) != 2 {
		t.Fatalf("open ranges: %+v", builder.openRanges)
	}
	builder.onRangeEnd(40, "gc-cycle")
	if len(builder.report.GC) != 1 || builder.report.GC[0].End != 40 {
		t.Fatalf("gc range: %+v", builder.report.GC)
	}
	builder.onRangeEnd(50, "user-range")
	if len(builder.report.Events) != 1 || builder.report.Events[0].Category != "region" || builder.report.Events[0].Goroutine != 7 {
		t.Fatalf("region event: %+v", builder.report.Events)
	}
	if len(builder.openRanges) != 0 {
		t.Fatalf("open ranges left: %+v", builder.openRanges)
	}
}

func TestTraceBuilderCloseOpenStateFinalizesAliveAndOpenRanges(t *testing.T) {
	builder := &traceBuilder{
		report:         TraceReport{GC: []TraceRange{}, Events: []TraceEvent{}},
		goroutines:     map[int64]*TraceGoroutine{},
		goroutineState: map[int64]*traceGoroutineState{},
		procs:          map[int64]*TraceProc{},
		procState:      map[int64]*traceGoroutineState{},
		first:          10,
		last:           100,
		haveTime:       true,
	}
	builder.goroutines[1] = &TraceGoroutine{ID: 1, Start: 10, Alive: true}
	builder.goroutineState[1] = &traceGoroutineState{state: "running", start: 60}
	builder.goroutines[2] = &TraceGoroutine{ID: 2, Start: 10, End: 100, Alive: true}
	builder.procs[3] = &TraceProc{ID: 3}
	builder.procState[3] = &traceGoroutineState{state: "running", start: 70}
	builder.openRanges = []traceOpenRange{{name: "gc-open", kind: "gc", start: 80}, {name: "user-open", kind: "user", start: 90}}

	report := builder.finish()

	if report.DurationNanos != 90 {
		t.Fatalf("duration: %d", report.DurationNanos)
	}
	if len(report.GC) != 1 || report.GC[0].End != 100 || report.Stats.GC != 20 {
		t.Fatalf("gc: %+v stats %+v", report.GC, report.Stats)
	}
	if report.Stats.Running != 40 {
		t.Fatalf("running total: %d", report.Stats.Running)
	}
	alive := map[int64]bool{}
	for _, goroutine := range report.Goroutines {
		alive[goroutine.ID] = goroutine.Alive
	}
	if !alive[1] {
		t.Error("goroutine with an open state must stay alive")
	}
	if alive[2] {
		t.Error("goroutine closed at the end of the trace must not be alive")
	}
}

func TestSummarizeGoroutinesAndProcsCapAndOrder(t *testing.T) {
	goroutines := map[int64]*TraceGoroutine{}
	for index := 0; index < maxTraceGoroutines+5; index++ {
		id := int64(index)
		goroutines[id] = &TraceGoroutine{ID: id, Running: int64(index), Spans: []TraceSpan{{Start: 30}, {Start: 10}}}
	}
	summary := summarizeGoroutines(goroutines)
	if len(summary) != maxTraceGoroutines {
		t.Fatalf("goroutines: %d", len(summary))
	}
	if summary[0].Running < summary[len(summary)-1].Running {
		t.Fatal("goroutines not sorted by busy time")
	}
	if summary[0].Spans[0].Start != 10 {
		t.Fatalf("spans not sorted: %+v", summary[0].Spans)
	}

	procs := map[int64]*TraceProc{}
	for index := maxTraceProcs + 5; index > 0; index-- {
		id := int64(index)
		procs[id] = &TraceProc{ID: id, Spans: []TraceSpan{{Start: 30}, {Start: 10}}}
	}
	procSummary := summarizeProcs(procs)
	if len(procSummary) != maxTraceProcs {
		t.Fatalf("procs: %d", len(procSummary))
	}
	if procSummary[0].ID != 1 {
		t.Fatalf("procs not sorted by id: %+v", procSummary[0])
	}
	if procSummary[0].Spans[0].Start != 10 {
		t.Fatalf("proc spans not sorted: %+v", procSummary[0].Spans)
	}
}

func TestTraceFramesOfEmptyStack(t *testing.T) {
	frames := traceFrames(trace.Stack{}, t.TempDir())
	if frames == nil || len(frames) != 0 {
		t.Fatalf("frames: %+v", frames)
	}
}

func TestListTraceFilesFindsOnlyTraceArtifacts(t *testing.T) {
	root := t.TempDir()
	writeFixtureFile(t, root, "trace.out", "trace")
	writeFixtureFile(t, root, "trace-run.out", "trace")
	writeFixtureFile(t, root, "nested/run.trace", "trace")
	writeFixtureFile(t, root, "notes.txt", "not a trace")
	writeFixtureFile(t, root, "empty-trace.out", "")
	writeFixtureFile(t, root, ".git/trace.out", "trace")
	service := NewService(&memoryStore{}, nil)
	t.Cleanup(service.Shutdown)
	session, err := service.OpenProject(root)
	if err != nil {
		t.Fatal(err)
	}
	files, err := service.ListTraceFiles(string(session.ID))
	if err != nil {
		t.Fatal(err)
	}
	found := map[string]bool{}
	for _, file := range files {
		found[file.Relative] = true
		if file.Kind != "trace" || file.Size == 0 {
			t.Fatalf("bad entry: %+v", file)
		}
	}
	for _, want := range []string{"trace.out", "trace-run.out", "nested/run.trace"} {
		if !found[want] {
			t.Errorf("missing %s in %+v", want, found)
		}
	}
	for _, unwanted := range []string{"notes.txt", "empty-trace.out", ".git/trace.out"} {
		if found[unwanted] {
			t.Errorf("unexpected %s in %+v", unwanted, found)
		}
	}
}

func TestListTraceFilesSkipsDeepFoldersAndCapsResults(t *testing.T) {
	root := t.TempDir()
	shallow := filepath.Join("a", "b", "c", "d", "e", "f", "g", "trace.out")
	deep := filepath.Join("a", "b", "c", "d", "e", "f", "g", "h", "i", "trace.out")
	writeFixtureFile(t, root, shallow, "trace")
	writeFixtureFile(t, root, deep, "trace")
	service := NewService(&memoryStore{}, nil)
	t.Cleanup(service.Shutdown)
	session, err := service.OpenProject(root)
	if err != nil {
		t.Fatal(err)
	}
	files, err := service.ListTraceFiles(string(session.ID))
	if err != nil {
		t.Fatal(err)
	}
	if len(files) != 1 || files[0].Relative != filepath.ToSlash(shallow) {
		t.Fatalf("depth filter: %+v", files)
	}

	capped := t.TempDir()
	for index := 0; index < maxProfileFiles+5; index++ {
		writeFixtureFile(t, capped, "trace-"+strconv.Itoa(index)+".out", "trace")
	}
	cappedService := NewService(&memoryStore{}, nil)
	t.Cleanup(cappedService.Shutdown)
	cappedSession, err := cappedService.OpenProject(capped)
	if err != nil {
		t.Fatal(err)
	}
	cappedFiles, err := cappedService.ListTraceFiles(string(cappedSession.ID))
	if err != nil {
		t.Fatal(err)
	}
	if len(cappedFiles) != maxProfileFiles {
		t.Fatalf("cap: %d", len(cappedFiles))
	}
}

func TestLoadTraceValidationErrors(t *testing.T) {
	root := t.TempDir()
	writeFixtureFile(t, root, "build/trace.out", "not a go trace")
	service := NewService(&memoryStore{}, nil)
	t.Cleanup(service.Shutdown)
	session, err := service.OpenProject(root)
	if err != nil {
		t.Fatal(err)
	}
	outside := filepath.Join(t.TempDir(), "trace.out")
	if err := os.WriteFile(outside, []byte("trace"), 0o644); err != nil {
		t.Fatal(err)
	}
	cases := []struct {
		name     string
		path     string
		contains string
	}{
		{"empty", "", "no trace selected"},
		{"missing", "build/missing.out", "trace not found"},
		{"outside", outside, "trace outside the project"},
		{"directory", "build", "trace invalid"},
		{"not a trace", "build/trace.out", "invalid Go trace"},
	}
	for _, testCase := range cases {
		t.Run(testCase.name, func(t *testing.T) {
			if _, err := service.LoadTrace(string(session.ID), testCase.path); err == nil {
				t.Fatalf("LoadTrace(%q) succeeded", testCase.path)
			} else if !strings.Contains(err.Error(), testCase.contains) {
				t.Fatalf("LoadTrace(%q) = %v", testCase.path, err)
			}
		})
	}
}

func TestLoadTraceFromRecordedFile(t *testing.T) {
	data := recordTrace(t)
	root := t.TempDir()
	if err := os.WriteFile(filepath.Join(root, "trace.out"), data, 0o644); err != nil {
		t.Fatal(err)
	}
	service := NewService(&memoryStore{}, nil)
	t.Cleanup(service.Shutdown)
	session, err := service.OpenProject(root)
	if err != nil {
		t.Fatal(err)
	}
	report, err := service.LoadTrace(string(session.ID), "trace.out")
	if err != nil {
		t.Fatalf("LoadTrace: %v", err)
	}
	if report.Name != "trace.out" || report.DurationNanos <= 0 || len(report.Goroutines) == 0 {
		t.Fatalf("report: %+v", report)
	}
}
