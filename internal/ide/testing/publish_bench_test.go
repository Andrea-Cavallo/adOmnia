package testing

import (
	"encoding/json"
	"fmt"
	"testing"
)

func largeRun() *testRun {
	r := &testRun{tree: NewTree()}
	for p := 0; p < 150; p++ {
		pkg := fmt.Sprintf("github.com/example/project/internal/pkg%03d", p)
		for t := 0; t < 20; t++ {
			name := fmt.Sprintf("TestSomething%02d/case_%d", t, t)
			r.tree.Apply(Event{Action: "run", Package: pkg, Test: name})
			r.tree.Apply(Event{Action: "output", Package: pkg, Test: name, Output: "=== RUN   " + name + "\n    some_test.go:42: log line\n"})
			r.tree.Apply(Event{Action: "pass", Package: pkg, Test: name, Elapsed: 0.01})
		}
	}
	return r
}

// BenchmarkPublishFull misura lo snapshot completo di una run grande (go test ./... di adOmnia): era il costo di ogni tick.
func BenchmarkPublishFull(b *testing.B) {
	r := largeRun()
	b.ReportAllocs()
	var size int
	for b.Loop() {
		data, err := json.Marshal(r.snapshotLocked(false))
		if err != nil {
			b.Fatal(err)
		}
		size = len(data)
	}
	b.ReportMetric(float64(size), "bytes/event")
}

// BenchmarkPublishTick misura un tick in corsa: 50 test finiti nei 250 ms precedenti su un albero da 3000 nodi.
func BenchmarkPublishTick(b *testing.B) {
	r := largeRun()
	r.tree.Changes()
	b.ReportAllocs()
	var size int
	for b.Loop() {
		for t := 0; t < 50; t++ {
			r.tree.Apply(Event{Action: "pass", Package: "github.com/example/project/internal/pkg010", Test: fmt.Sprintf("TestSomething%02d/case_%d", t%20, t%20)})
		}
		s := r.headerLocked()
		s.Results, s.Summary = r.tree.Changes()
		r.resolveResults(s.Results)
		data, err := json.Marshal(s)
		if err != nil {
			b.Fatal(err)
		}
		size = len(data)
	}
	b.ReportMetric(float64(size), "bytes/event")
}
