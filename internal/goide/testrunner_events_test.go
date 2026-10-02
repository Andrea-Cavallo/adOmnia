package goide

import (
	"bufio"
	"os"
	"strings"
	"testing"
)

func treeFromFile(t *testing.T, name string) *testTree {
	t.Helper()
	file, err := os.Open("testdata/testjson/" + name)
	if err != nil {
		t.Fatal(err)
	}
	defer file.Close()
	tree := newTestTree()
	scanner := bufio.NewScanner(file)
	for scanner.Scan() {
		tree.apply(scanner.Bytes())
	}
	return tree
}

func findResult(results []TestResult, pkg, name string) *TestResult {
	for index := range results {
		if results[index].Package == pkg && results[index].Name == name {
			return &results[index]
		}
	}
	return nil
}

func TestTestTreeFromRealGoTestJSON(t *testing.T) {
	results, summary := treeFromFile(t, "mixed.jsonl").snapshot()
	broken := findResult(results, "example.com/tj/broken", "")
	if broken == nil || broken.Status != TestFailed || !broken.BuildFailed || broken.Failure == nil || broken.Failure.File != "broken/broken.go" || broken.Failure.Line != 3 {
		t.Fatalf("errore di build non riconosciuto: %+v", broken)
	}
	parent := findResult(results, "example.com/tj/calc", "TestAdd")
	positive := findResult(results, "example.com/tj/calc", "TestAdd/positive")
	negative := findResult(results, "example.com/tj/calc", "TestAdd/negative")
	skip := findResult(results, "example.com/tj/calc", "TestSkip")
	if parent == nil || parent.Status != TestFailed || positive == nil || positive.Status != TestPassed || positive.ParentID != parent.ID {
		t.Fatalf("albero dei sottotest errato: %+v %+v", parent, positive)
	}
	if negative == nil || negative.Status != TestFailed || negative.Failure == nil || negative.Failure.File != "calc_test.go" || negative.Failure.Line != 13 || !strings.Contains(negative.Output, "got -3") {
		t.Fatalf("fallimento del sottotest non localizzato: %+v", negative)
	}
	if skip == nil || skip.Status != TestSkipped {
		t.Fatalf("skip non riconosciuto: %+v", skip)
	}
	if summary != (TestSummary{Passed: 1, Failed: 2, Skipped: 1}) {
		t.Fatalf("riepilogo errato: %+v", summary)
	}
}

func TestTestTreeReadsBenchmarkResults(t *testing.T) {
	results, _ := treeFromFile(t, "bench.jsonl").snapshot()
	bench := findResult(results, "example.com/tj/calc", "BenchmarkAdd")
	if bench == nil || bench.Status != TestBenchmarked || !strings.HasPrefix(bench.Benchmark, "100 ") || !strings.HasSuffix(bench.Benchmark, "ns/op") {
		t.Fatalf("risultato del benchmark non letto: %+v", bench)
	}
}

func TestTestTreeHandlesInterleavedOutputAndTimeouts(t *testing.T) {
	tree := newTestTree()
	for _, line := range []string{
		`{"Action":"run","Package":"p","Test":"TestA"}`,
		`{"Action":"run","Package":"p","Test":"TestB"}`,
		`{"Action":"output","Package":"p","Test":"TestB","Output":"b1\n"}`,
		`{"Action":"output","Package":"p","Test":"TestA","Output":"a1\n"}`,
		`{"Action":"pass","Package":"p","Test":"TestB","Elapsed":0.5}`,
		`not json at all`,
		`{"Action":"output","Package":"p","Output":"panic: test timed out after 1s\n"}`,
		`{"Action":"fail","Package":"p","Elapsed":1}`,
	} {
		tree.apply([]byte(line))
	}
	results, summary := tree.snapshot()
	a, b := findResult(results, "p", "TestA"), findResult(results, "p", "TestB")
	if a.Output != "a1\n" || b.Output != "b1\n" {
		t.Fatalf("output parallelo mescolato: %q %q", a.Output, b.Output)
	}
	if a.Status != TestTimedOut || b.Status != TestPassed || b.ElapsedMillis != 500 {
		t.Fatalf("stati inattesi: %+v %+v", a, b)
	}
	if summary.Failed != 1 || summary.Passed != 1 {
		t.Fatalf("riepilogo errato: %+v", summary)
	}
}

func TestTestTreeCapsOutputAndNodes(t *testing.T) {
	tree := newTestTree()
	big := strings.Repeat("x", maxTestOutputBytes)
	tree.apply([]byte(`{"Action":"output","Package":"p","Test":"TestA","Output":"` + big + `"}`))
	tree.apply([]byte(`{"Action":"output","Package":"p","Test":"TestA","Output":"more"}`))
	results, _ := tree.snapshot()
	if node := findResult(results, "p", "TestA"); len(node.Output) != maxTestOutputBytes || !node.Truncated {
		t.Fatalf("output non limitato: %d", len(node.Output))
	}
}

func TestTestTreeCountsRepetitionsAndShuffleSeed(t *testing.T) {
	results, summary := treeFromFile(t, "flaky.jsonl").snapshot()
	flaky := findResult(results, "example.com/flaky", "TestFlaky")
	if flaky == nil || flaky.Runs != 3 || flaky.Failures != 1 || flaky.Status != TestFailed {
		t.Fatalf("ripetizioni flaky non contate o fallimento perso dall'ultima ripetizione verde: %+v", flaky)
	}
	stable := findResult(results, "example.com/flaky", "TestStable")
	if stable == nil || stable.Runs != 3 || stable.Failures != 0 || stable.Status != TestPassed {
		t.Fatalf("test stabile: %+v", stable)
	}
	if pkg := findResult(results, "example.com/flaky", ""); pkg == nil || pkg.ShuffleSeed != "42" {
		t.Fatalf("seed di -shuffle non letto: %+v", pkg)
	}
	if summary.Failed != 1 || summary.Passed != 1 {
		t.Fatalf("summary: %+v", summary)
	}
}

func TestTestArgumentsRepeatAndShuffle(t *testing.T) {
	arguments, err := testArguments(TestRunRequest{Repeat: 20, Shuffle: "123"}, "")
	if err != nil || !strings.Contains(strings.Join(arguments, " "), "-count=20 -shuffle=123") {
		t.Fatalf("argomenti: %v %v", arguments, err)
	}
	for _, bad := range []TestRunRequest{{Repeat: 5000}, {Repeat: -1}, {Shuffle: "on; rm"}} {
		if _, err := testArguments(bad, ""); err == nil {
			t.Fatalf("richiesta non valida accettata: %+v", bad)
		}
	}
}
