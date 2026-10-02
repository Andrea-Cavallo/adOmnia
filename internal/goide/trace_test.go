package goide

import (
	"os"
	"os/exec"
	"path/filepath"
	"testing"

	"golang.org/x/exp/trace"
)

func TestBuildTraceReportFromRealTrace(t *testing.T) {
	goBinary, err := exec.LookPath("go")
	if err != nil {
		t.Skip("go non disponibile")
	}
	dir := t.TempDir()
	if err := os.WriteFile(filepath.Join(dir, "go.mod"), []byte("module traceprobe\n\ngo 1.21\n"), 0o644); err != nil {
		t.Fatal(err)
	}
	source := `package traceprobe

import (
	"runtime"
	"testing"
	"time"
)

func TestTrace(t *testing.T) {
	done := make(chan int, 1)
	go func() {
		time.Sleep(20 * time.Millisecond)
		done <- 1
	}()
	runtime.GC()
	<-done
	time.Sleep(5 * time.Millisecond)
}
`
	if err := os.WriteFile(filepath.Join(dir, "probe_test.go"), []byte(source), 0o644); err != nil {
		t.Fatal(err)
	}
	tracePath := filepath.Join(dir, "trace.out")
	command := exec.Command(goBinary, "test", "-run", "TestTrace", "-trace", tracePath, ".")
	command.Dir = dir
	if out, err := command.CombinedOutput(); err != nil {
		t.Skipf("go test non ha prodotto una traccia: %v\n%s", err, out)
	}
	file, err := os.Open(tracePath)
	if err != nil {
		t.Fatalf("traccia non scritta: %v", err)
	}
	defer file.Close()
	reader, err := trace.NewReader(file)
	if err != nil {
		t.Fatalf("NewReader: %v", err)
	}
	report, err := buildTraceReport(dir, tracePath, reader)
	if err != nil {
		t.Fatalf("buildTraceReport: %v", err)
	}
	if report.DurationNanos <= 0 {
		t.Fatalf("durata non valida: %d", report.DurationNanos)
	}
	if len(report.Goroutines) == 0 {
		t.Fatal("nessuna goroutine nella traccia")
	}
	var withSpans int
	for _, goroutine := range report.Goroutines {
		if len(goroutine.Spans) > 0 {
			withSpans++
		}
	}
	if withSpans == 0 {
		t.Fatal("nessuna timeline di goroutine con span")
	}
}
