package goide

import (
	"os/exec"
	"strings"
	"testing"
	"time"
)

func startTestProject(t *testing.T) (*Service, *eventRecorder, Session) {
	t.Helper()
	if _, err := exec.LookPath("go"); err != nil {
		t.Skip("toolchain Go non disponibile")
	}
	root := copyFixture(t, "testproject")
	recorder := &eventRecorder{}
	ide := NewService(&memoryStore{}, recorder.record)
	t.Cleanup(ide.Shutdown)
	session, err := ide.OpenProject(root)
	if err != nil {
		t.Fatal(err)
	}
	if _, err := ide.SetToolAuthorization(string(session.ID), true); err != nil {
		t.Fatal(err)
	}
	if info, err := ide.DetectToolchain(string(session.ID)); err != nil || !info.Available {
		t.Fatalf("toolchain non disponibile: %v", err)
	}
	return ide, recorder, session
}

func waitTestRun(t *testing.T, recorder *eventRecorder, runID RunID) TestRunSnapshot {
	t.Helper()
	event := recorder.waitFor(t, 90*time.Second, func(event EventEnvelope) bool {
		snapshot, ok := event.Payload.(TestRunSnapshot)
		return ok && snapshot.RunID == runID && snapshot.Status != TestRunning
	})
	return event.Payload.(TestRunSnapshot)
}

func TestTestRunnerWithRealGoTest(t *testing.T) {
	ide, recorder, session := startTestProject(t)
	started, err := ide.StartTests(TestRunRequest{SessionID: session.ID, Packages: []string{"./..."}, Coverage: true})
	if err != nil {
		t.Fatal(err)
	}
	finished := waitTestRun(t, recorder, started.RunID)
	if finished.Summary != (TestSummary{Passed: 2, Failed: 1, Skipped: 1}) {
		t.Fatalf("riepilogo inatteso: %+v", finished.Summary)
	}
	full, err := ide.GetTestRun(string(started.RunID))
	if err != nil {
		t.Fatal(err)
	}
	negative := findResult(full.Results, "example.com/tp/calc", "TestAdd/negative")
	if negative == nil || negative.Failure == nil || negative.Failure.RelativePath != "calc/calc_test.go" || negative.Failure.Line != 17 || !strings.Contains(negative.Output, "got -3") {
		t.Fatalf("fallimento non navigabile: %+v", negative)
	}
	if pkg := findResult(finished.Results, "example.com/tp/calc", ""); pkg == nil || pkg.Directory != "calc" {
		t.Fatalf("cartella del package mancante: %+v", pkg)
	}
	if finished.Coverage == nil || len(finished.Coverage.Files) != 1 || finished.Coverage.Files[0].RelativePath != "calc/calc.go" || finished.Coverage.Files[0].DiskToken == "" {
		t.Fatalf("coverage non risolta sui file del progetto: %+v", finished.Coverage)
	}
	if file := finished.Coverage.Files[0]; file.Covered == 0 || file.Covered == file.Statements {
		t.Fatalf("Sign(-1) non è mai chiamato: la coverage deve essere parziale, %+v", file)
	}

	// Rerun del solo sottotest fallito.
	rerun, err := ide.StartTests(TestRunRequest{SessionID: session.ID, Packages: []string{"./calc"}, Run: "^TestAdd$/^negative$"})
	if err != nil {
		t.Fatal(err)
	}
	again := waitTestRun(t, recorder, rerun.RunID)
	for _, result := range again.Results {
		if result.Name != "" && result.Name != "TestAdd" && result.Name != "TestAdd/negative" {
			t.Fatalf("il rerun ha eseguito test fuori perimetro: %s", result.Name)
		}
	}
	if again.Summary.Failed != 1 || again.Summary.Passed != 0 {
		t.Fatalf("rerun inatteso: %+v", again.Summary)
	}

	bench, err := ide.StartTests(TestRunRequest{SessionID: session.ID, Packages: []string{"./calc"}, Bench: "BenchmarkAdd"})
	if err != nil {
		t.Fatal(err)
	}
	benchmarked := waitTestRun(t, recorder, bench.RunID)
	if result := findResult(benchmarked.Results, "example.com/tp/calc", "BenchmarkAdd"); result == nil || result.Status != TestBenchmarked || !strings.Contains(result.Benchmark, "ns/op") {
		t.Fatalf("benchmark non letto: %+v", result)
	}
	if benchmarked.FinishedAt == nil || benchmarked.FinishedAt.Before(benchmarked.StartedAt) {
		t.Fatalf("durata benchmark non disponibile: started=%s finished=%v", benchmarked.StartedAt, benchmarked.FinishedAt)
	}
	if runs, _ := ide.ListTestRuns(string(session.ID)); len(runs) != 3 {
		t.Fatalf("storico delle esecuzioni inatteso: %d", len(runs))
	}
}

func TestTestRunnerStopKillsTheTestProcess(t *testing.T) {
	ide, recorder, session := startTestProject(t)
	started, err := ide.StartTests(TestRunRequest{SessionID: session.ID, Packages: []string{"./calc"}, Run: "^TestHang$", Environment: map[string]string{"GOIDE_HANG": "1"}})
	if err != nil {
		t.Fatal(err)
	}
	recorder.waitFor(t, 60*time.Second, func(event EventEnvelope) bool {
		snapshot, ok := event.Payload.(TestRunSnapshot)
		return ok && snapshot.RunID == started.RunID && findResult(snapshot.Results, "example.com/tp/calc", "TestHang") != nil
	})
	if err := ide.StopRun(string(started.RunID)); err != nil {
		t.Fatal(err)
	}
	stopped := waitTestRun(t, recorder, started.RunID)
	if stopped.Status != "stopped" {
		t.Fatalf("stato dopo Stop: %s", stopped.Status)
	}
	if ide.processes.HasActiveSession(session.ID) {
		t.Fatal("processi di test ancora attivi dopo Stop")
	}
}

func TestTestRunnerRejectsInvalidFilters(t *testing.T) {
	if _, err := testArguments(TestRunRequest{Run: "(unclosed"}, ""); err == nil {
		t.Fatal("una regex non valida deve essere rifiutata prima di avviare go test")
	}
	arguments, err := testArguments(TestRunRequest{Bench: "."}, "")
	if err != nil || strings.Join(arguments, " ") != "test -json -count=1 -run ^$ -bench . -benchmem ./..." {
		t.Fatalf("argomenti benchmark inattesi: %v %v", err, arguments)
	}
}
