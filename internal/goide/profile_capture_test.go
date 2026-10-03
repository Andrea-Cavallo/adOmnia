package goide

import "testing"

func TestQuickProfileCaptureInProjectRoot(t *testing.T) {
	root := t.TempDir()
	writeFixtureFile(t, root, "go.mod", "module example.com/capture\n\ngo 1.22\n")
	writeFixtureFile(t, root, "work/work_test.go", "package work\nimport \"testing\"\nfunc TestWork(t *testing.T) { data := make([]byte, 1024); if len(data) != 1024 { t.Fatal() } }\n")
	recorder := &eventRecorder{}
	service := NewService(&memoryStore{}, recorder.record)
	t.Cleanup(service.Shutdown)
	session, err := service.OpenProject(root)
	if err != nil {
		t.Fatal(err)
	}
	request := RunRequest{SessionID: session.ID, Kind: "test", Target: "./work", GoArguments: []string{"-count=1", "-memprofile=mem-capture.pprof"}}
	if _, err := service.StartRun(request); err == nil {
		t.Fatal("capture allowed without project authorization")
	}
	if _, err := service.SetToolAuthorization(string(session.ID), true); err != nil {
		t.Fatal(err)
	}
	finished, output := runAndWait(t, service, recorder, request)
	if finished.Status != "exited" {
		t.Fatalf("capture failed: %+v\n%s", finished, output)
	}
	files, err := service.ListProfileFiles(string(session.ID))
	if err != nil {
		t.Fatal(err)
	}
	if len(files) != 1 || files[0].Relative != "mem-capture.pprof" {
		t.Fatalf("profile not in project root: %+v", files)
	}
	report, err := service.LoadProfile(string(session.ID), files[0].Relative)
	if err != nil {
		t.Fatal(err)
	}
	if len(report.SampleTypes) == 0 {
		t.Fatal("generated profile has no sample types")
	}
	request.GoArguments = []string{"-count=1", "-trace=trace-capture.out"}
	finished, output = runAndWait(t, service, recorder, request)
	if finished.Status != "exited" {
		t.Fatalf("trace capture failed: %+v\n%s", finished, output)
	}
	traces, err := service.ListTraceFiles(string(session.ID))
	if err != nil {
		t.Fatal(err)
	}
	if len(traces) != 1 || traces[0].Relative != "trace-capture.out" {
		t.Fatalf("trace not in project root: %+v", traces)
	}
	traceReport, err := service.LoadTrace(string(session.ID), traces[0].Relative)
	if err != nil {
		t.Fatal(err)
	}
	if traceReport.DurationNanos <= 0 || len(traceReport.Goroutines) == 0 {
		t.Fatal("generated trace contains no runtime activity")
	}
}
