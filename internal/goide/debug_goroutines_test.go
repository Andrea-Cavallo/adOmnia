package goide

import "testing"

func TestGoroutineStateFromRuntimeFrames(t *testing.T) {
	cases := []struct {
		name   string
		frames []DebugFrame
		want   string
	}{
		{"channel receive", []DebugFrame{{Name: "runtime.gopark"}, {Name: "runtime.chanrecv"}, {Name: "runtime.chanrecv1"}, {Name: "main.worker", RelativePath: "main.go"}}, GoroutineChanRecv},
		{"mutex", []DebugFrame{{Name: "runtime.gopark"}, {Name: "sync.runtime_SemacquireMutex"}, {Name: "sync.(*Mutex).lockSlow"}, {Name: "main.update", RelativePath: "main.go"}}, GoroutineMutex},
		{"user code", []DebugFrame{{Name: "main.compute", RelativePath: "main.go"}, {Name: "runtime.gopark"}}, GoroutineRunning},
		{"sleep", []DebugFrame{{Name: "time.Sleep"}, {Name: "main.tick", RelativePath: "main.go"}}, GoroutineSleep},
	}
	for _, test := range cases {
		if got := goroutineState(test.frames); got != test.want {
			t.Errorf("%s: state %q, want %q", test.name, got, test.want)
		}
	}
}

func TestBlockedOnReadsTheSourceLine(t *testing.T) {
	cases := map[string][2]string{
		"order := <-s.orderChannel": {GoroutineChanRecv, "s.orderChannel"},
		"results <- value":          {GoroutineChanSend, "results"},
		"s.mu.Lock()":               {GoroutineMutex, "s.mu"},
		"wg.Wait()":                 {GoroutineWaitGroup, "wg"},
		"time.Sleep(time.Second)":   {GoroutineSleep, ""},
	}
	for source, expected := range cases {
		if got := blockedOn(expected[0], source); got != expected[1] {
			t.Errorf("blockedOn(%q, %q) = %q, want %q", expected[0], source, got, expected[1])
		}
	}
}

func TestSummarizeGoroutinePicksProjectFrames(t *testing.T) {
	frames := []DebugFrame{
		{Name: "runtime.gopark"}, {Name: "runtime.chanrecv1"},
		{Name: "main.(*Service).consume", RelativePath: "service.go", Line: 84},
		{Name: "main.(*Service).Start.func1", RelativePath: "service.go", Line: 40},
		{Name: "runtime.goexit"},
	}
	summary := summarizeGoroutine(DebugThread{ID: 21, Name: "[Go 21] main.(*Service).consume"}, frames, newSourceLineCache())
	if summary.ID != 21 || summary.State != GoroutineChanRecv || summary.Current {
		t.Fatalf("unexpected summary %+v", summary)
	}
	if summary.Location.Line != 84 || summary.Origin.Line != 40 {
		t.Fatalf("location %+v origin %+v", summary.Location, summary.Origin)
	}
}

func TestRaceCollectorSplitsReports(t *testing.T) {
	var collector raceCollector
	collector.consumeText("ok\n==================\nWARNING: DATA RACE\nWrite at 0x00c by goroutine 7:\n  main.inc()\n      /p/main.go:10 +0x3c\n")
	collector.consumeText("\nPrevious read at 0x00c by goroutine 6:\n  main.inc()\n      /p/main.go:9 +0x2a\n==================\nPASS\n")
	collector.consumeJSON([]byte(`{"Action":"output","Output":"WARNING: DATA RACE\n"}`))
	collector.consumeJSON([]byte(`{"Action":"output","Output":"==================\n"}`))
	reports := collector.reports()
	if len(reports) != 2 {
		t.Fatalf("got %d reports: %q", len(reports), reports)
	}
	if reports[0][:len(raceReportStart)] != raceReportStart || reports[0][len(reports[0])-len(raceReportSeparator):] != raceReportSeparator {
		t.Fatalf("report not delimited: %q", reports[0])
	}
}
