package testing

import "testing"

func TestBenchmarkSamplesKeepEveryRepetition(t *testing.T) {
	tree := NewTree()
	for _, line := range []string{"100 12 ns/op", "100 14 ns/op", "100 13 ns/op"} {
		tree.Apply(Event{Action: "output", Package: "p", Test: "BenchmarkX", Benchmark: line})
	}
	results, _ := tree.Snapshot()
	var bench *TestResult
	for index := range results {
		if results[index].Name == "BenchmarkX" {
			bench = &results[index]
		}
	}
	if bench == nil || len(bench.BenchmarkSamples) != 3 || bench.Benchmark != "100 13 ns/op" || bench.Status != TestBenchmarked {
		t.Fatalf("unexpected benchmark node: %+v", bench)
	}
	tree.Apply(Event{Action: "output", Package: "p", Test: "BenchmarkX", Benchmark: "100 15 ns/op"})
	if len(bench.BenchmarkSamples) != 3 {
		t.Fatal("snapshot must not alias the live samples")
	}
}
