package goide

import (
	"os"
	"os/exec"
	"path/filepath"
	"testing"

	"github.com/google/pprof/profile"
)

func sampleProfile() *profile.Profile {
	work := &profile.Function{ID: 1, Name: "example.com/pkg.main.work", SystemName: "example.com/pkg.main.work", Filename: "/proj/main.go", StartLine: 12}
	main := &profile.Function{ID: 2, Name: "runtime.main", SystemName: "runtime.main", Filename: "/goroot/runtime/proc.go", StartLine: 250}
	leaf := &profile.Location{ID: 1, Line: []profile.Line{{Function: work, Line: 14}}}
	root := &profile.Location{ID: 2, Line: []profile.Line{{Function: main, Line: 271}}}
	return &profile.Profile{
		SampleType:    []*profile.ValueType{{Type: "samples", Unit: "count"}, {Type: "cpu", Unit: "nanoseconds"}},
		PeriodType:    &profile.ValueType{Type: "cpu", Unit: "nanoseconds"},
		Period:        10000000,
		DurationNanos: 20_000_000,
		Sample: []*profile.Sample{{
			Location: []*profile.Location{leaf, root},
			Value:    []int64{2, 5000000},
		}},
		Location: []*profile.Location{leaf, root},
		Function: []*profile.Function{work, main},
	}
}

func TestBuildProfileReportAggregatesTopFlameAndEdges(t *testing.T) {
	report := buildProfileReport("/proj", "/proj/cpu.pprof", sampleProfile())

	if report.Kind != "cpu" || report.Samples != 1 {
		t.Fatalf("unexpected meta: kind=%q samples=%d", report.Kind, report.Samples)
	}
	if len(report.SampleTypes) != 2 || report.SampleTypes[1].Unit != "nanoseconds" {
		t.Fatalf("unexpected sample types: %+v", report.SampleTypes)
	}
	if len(report.Totals) != 2 || report.Totals[1] != 5000000 {
		t.Fatalf("unexpected totals: %+v", report.Totals)
	}

	var workFlat, mainCum int64
	for _, node := range report.TopFlat {
		if node.Function.Name == "example.com/pkg.main.work" {
			workFlat = node.Flat[1]
		}
	}
	for _, node := range report.TopCum {
		if node.Function.Name == "runtime.main" {
			mainCum = node.Cum[1]
			if !node.Function.Runtime {
				t.Fatalf("runtime.main should be flagged as runtime")
			}
		}
	}
	if workFlat != 5000000 || mainCum != 5000000 {
		t.Fatalf("flat/cum wrong: workFlat=%d mainCum=%d", workFlat, mainCum)
	}

	if report.Flame == nil || len(report.Flame.Children) != 1 || report.Flame.Children[0].Function.Name != "runtime.main" {
		t.Fatalf("flame root wrong: %+v", report.Flame)
	}
	if len(report.Flame.Children[0].Children) != 1 || report.Flame.Children[0].Children[0].Function.Name != "example.com/pkg.main.work" {
		t.Fatalf("flame leaf wrong: %+v", report.Flame.Children[0])
	}

	if len(report.Edges) != 1 {
		t.Fatalf("expected one edge, got %d", len(report.Edges))
	}
	edge := report.Edges[0]
	if edge.Caller.Name != "runtime.main" || edge.Callee.Name != "example.com/pkg.main.work" || edge.Value[1] != 5000000 {
		t.Fatalf("unexpected edge: %+v", edge)
	}

	if len(report.Lines) != 1 || report.Lines[0].Line != 14 || report.Lines[0].Relative != "main.go" {
		t.Fatalf("unexpected lines: %+v", report.Lines)
	}
	if report.TopFlat[0].Function.Short == "" || report.TopFlat[0].Function.Package == "" {
		t.Fatalf("function names not split: %+v", report.TopFlat[0].Function)
	}
}

func TestDescribeProfileFunctionSplitsMethodNames(t *testing.T) {
	fn := &profile.Function{Name: "example.com/acme/client.(*Client).Do", Filename: "/proj/client.go", StartLine: 40}
	described := describeProfileFunction(fn, "/proj")
	if described.Package != "example.com/acme/client" || described.Short != "(*Client).Do" {
		t.Fatalf("unexpected split: %+v", described)
	}
	if described.Relative != "client.go" || described.Line != 40 {
		t.Fatalf("unexpected file/line: %+v", described)
	}
}

func TestBuildProfileReportFromRealCPUProfile(t *testing.T) {
	goBinary, err := exec.LookPath("go")
	if err != nil {
		t.Skip("go non disponibile")
	}
	dir := t.TempDir()
	if err := os.WriteFile(filepath.Join(dir, "go.mod"), []byte("module profprobe\n\ngo 1.21\n"), 0o644); err != nil {
		t.Fatal(err)
	}
	source := "package profprobe\n\nimport \"testing\"\n\nfunc hot(n int) int { s := 0; for i := 0; i < n; i++ { s += i * i }; return s }\n\nfunc TestHot(t *testing.T) { total := 0; for i := 0; i < 2_000_000; i++ { total += hot(200) }; if total == 0 { t.Fatal(\"noop\") } }\n"
	if err := os.WriteFile(filepath.Join(dir, "probe_test.go"), []byte(source), 0o644); err != nil {
		t.Fatal(err)
	}
	profilePath := filepath.Join(dir, "cpu.pprof")
	command := exec.Command(goBinary, "test", "-run", "TestHot", "-cpuprofile", profilePath, ".")
	command.Dir = dir
	if out, err := command.CombinedOutput(); err != nil {
		t.Skipf("go test non ha prodotto un profilo: %v\n%s", err, out)
	}
	data, err := os.ReadFile(profilePath)
	if err != nil {
		t.Fatalf("profilo non scritto: %v", err)
	}
	parsed, err := profile.ParseData(data)
	if err != nil {
		t.Fatalf("ParseData: %v", err)
	}
	report := buildProfileReport(dir, profilePath, parsed)
	if report.Samples == 0 || len(report.TopCum) == 0 || report.Flame == nil {
		t.Fatalf("report vuoto: samples=%d top=%d flame=%v", report.Samples, len(report.TopCum), report.Flame)
	}
	var foundHot bool
	for _, node := range report.TopCum {
		if node.Function.Short == "hot" || node.Function.Short == "profprobe.hot" {
			foundHot = true
		}
	}
	if !foundHot {
		t.Fatalf("funzione calda non trovata nel profilo reale")
	}
}

func TestProfileKindFromFilename(t *testing.T) {
	cases := map[string]string{"cpu.pprof": "cpu", "mem.pprof": "heap", "heap.pprof": "heap", "block.pprof": "block", "mutex.pprof": "mutex", "goroutine.pprof": "goroutine"}
	for name, want := range cases {
		if got := profileKind(name); got != want {
			t.Fatalf("profileKind(%q)=%q want %q", name, got, want)
		}
	}
}
