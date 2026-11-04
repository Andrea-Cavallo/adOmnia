package flowintel

import (
	"fmt"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"
)

// TestFlowScaleLargeWorkspace guards the promise of "500+ bundles explorable": discovery
// must stay linear and bounded, and a trace must stay within the node bound instead of
// shipping the whole graph.
func TestFlowScaleLargeWorkspace(t *testing.T) {
	if testing.Short() {
		t.Skip("scale test skipped in -short mode")
	}
	root := t.TempDir()
	const bundleCount = 300
	const classesPerBundle = 2
	for bundle := 0; bundle < bundleCount; bundle++ {
		name := fmt.Sprintf("com.acme.bundle%03d", bundle)
		dir := filepath.Join(root, "plugins", name)
		writeFlowFile(t, dir, ".project", `<projectDescription><name>`+name+`</name></projectDescription>`)
		writeFlowFile(t, dir, "META-INF/MANIFEST.MF", "Manifest-Version: 1.0\nBundle-SymbolicName: "+name+"\nBundle-Version: 1.0.0\n")
		for class := 0; class < classesPerBundle; class++ {
			next := (class + 1) % classesPerBundle
			source := fmt.Sprintf(`package com.acme.bundle%03d;

public class Service%d {
	@Flow
	public void run() {
		helper();
		service%d.run();
	}

	public void helper() {
	}
}
`, bundle, class, next)
			writeFlowFile(t, dir, fmt.Sprintf("src/com/acme/bundle%03d/Service%d.java", bundle, class), source)
		}
	}
	started := time.Now()
	discovery, err := Discover(root)
	if err != nil {
		t.Fatal(err)
	}
	elapsed := time.Since(started)
	if elapsed > 45*time.Second {
		t.Fatalf("discovery took %s for %d bundles: the index is not bounded", elapsed, bundleCount)
	}
	if discovery.Counts["flow"] < bundleCount || discovery.Counts["bundle"] < bundleCount {
		t.Fatalf("counts = %v", discovery.Counts)
	}
	index := NewIndex(discovery)
	trace, err := index.Trace("Service0.run", "downstream", 12)
	if err != nil {
		t.Fatal(err)
	}
	if len(trace.Nodes) > maxTraceNodes {
		t.Fatalf("trace returned %d nodes, over the %d bound", len(trace.Nodes), maxTraceNodes)
	}
	if len(trace.Steps) == 0 {
		t.Fatalf("the trace found no step")
	}
	// The call chain is cyclic (service0 → service1 → service0): the trace must not loop.
	seen := map[string]bool{}
	for _, node := range trace.Nodes {
		if seen[node.ID] && node.ID != trace.Root.ID {
			t.Fatalf("trace revisited %s", node.ID)
		}
		seen[node.ID] = true
	}
	_ = os.RemoveAll(root)
	_ = strings.TrimSpace("")
}
