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

	"github.com/Andrea-Cavallo/adOmnia/internal/languages/golang"
)

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
	for index := range golang.MaxProfileFiles + 5 {
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
	if len(cappedFiles) != golang.MaxProfileFiles {
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
