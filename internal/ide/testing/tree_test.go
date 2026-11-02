package testing

import (
	"slices"
	"testing"
)

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

// TestTreeChangesReturnsOnlyTouchedNodes: gli aggiornamenti in corsa portano solo i nodi cambiati,
// nell'ordine di Snapshot, con il riepilogo dell'albero intero; una seconda chiamata senza eventi è vuota.
func TestTreeChangesReturnsOnlyTouchedNodes(t *testing.T) {
	tree := NewTree()
	tree.Apply(Event{Action: "run", Package: "b", Test: "TestOne"})
	tree.Apply(Event{Action: "pass", Package: "b", Test: "TestOne"})
	tree.Apply(Event{Action: "run", Package: "a", Test: "TestTwo"})
	first, _ := tree.Changes()
	if ids := resultIDs(first); !slices.Equal(ids, []string{"a", "a\x00TestTwo", "b", "b\x00TestOne"}) {
		t.Fatalf("first changes = %q", ids)
	}
	if again, _ := tree.Changes(); len(again) != 0 {
		t.Fatalf("changes without events = %q", resultIDs(again))
	}
	tree.Apply(Event{Action: "fail", Package: "a", Test: "TestTwo"})
	changed, summary := tree.Changes()
	if ids := resultIDs(changed); !slices.Equal(ids, []string{"a\x00TestTwo"}) || changed[0].Status != TestFailed {
		t.Fatalf("changes after fail = %q", ids)
	}
	if summary.Passed != 1 || summary.Failed != 1 {
		t.Fatalf("summary must cover the whole tree, got %+v", summary)
	}
	all, _ := tree.Snapshot()
	if len(all) != 4 {
		t.Fatalf("Snapshot must stay complete, got %d nodes", len(all))
	}
}

func resultIDs(results []TestResult) []string {
	ids := make([]string, 0, len(results))
	for _, result := range results {
		ids = append(ids, result.ID)
	}
	return ids
}
