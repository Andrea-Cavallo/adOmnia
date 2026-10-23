package adomniacli

import (
	"encoding/json/v2"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"runtime"
	"strings"
	"testing"
)

func TestCloneStringMap(t *testing.T) {
	source := map[string]string{"a": "1", "b": "2"}
	clone := cloneStringMap(source)
	if len(clone) != 2 || clone["a"] != "1" || clone["b"] != "2" {
		t.Fatalf("clone = %v", clone)
	}
	clone["a"] = "changed"
	if source["a"] != "1" {
		t.Fatalf("clone shares state with source: %v", source)
	}
	if empty := cloneStringMap(nil); empty == nil || len(empty) != 0 {
		t.Fatalf("nil map clone = %v", empty)
	}
	if empty := cloneStringMap(map[string]string{}); empty == nil || len(empty) != 0 {
		t.Fatalf("empty map clone = %v", empty)
	}
}

func TestStartupRating(t *testing.T) {
	cases := []struct {
		ms   int64
		want string
	}{
		{0, "✅ fast"},
		{199, "✅ fast"},
		{200, "✅ good"},
		{499, "✅ good"},
		{500, "⚠️ slow"},
		{999, "⚠️ slow"},
		{1000, "❌ very slow"},
		{-1, "✅ fast"},
	}
	for _, tc := range cases {
		if got := startupRating(tc.ms); got != tc.want {
			t.Errorf("startupRating(%d) = %q, want %q", tc.ms, got, tc.want)
		}
	}
}

func TestWriteBenchSection(t *testing.T) {
	t.Run("clean run", func(t *testing.T) {
		var sb strings.Builder
		writeBenchSection(&sb, collBenchResult{
			Collection: "Checkout", Runs: 2, P50Ms: 10, P95Ms: 20, P99Ms: 25,
			MinMs: 8, MaxMs: 25, AvgMs: 12.5, FailRatePct: 0,
			Details: []benchRun{{Run: 1, Passed: 3, Failed: 0, TotalMs: 10}, {Run: 2, Passed: 3, Failed: 0, TotalMs: 15}},
		})
		text := sb.String()
		for _, want := range []string{
			"**Collection:** Checkout", "**Runs:** 2 · **Fail rate:** 0.0%",
			"| P50 | 10 ms |", "| P95 | 20 ms |", "| P99 | 25 ms |",
			"| Min | 8 ms |", "| Max | 25 ms |", "| Avg | 12.5 ms |",
			"| Fail rate | 0.0% ✅ |", "<summary>Per-run details</summary>",
			"| 1 ✅ | 3 | 0 | 10 ms |", "| 2 ✅ | 3 | 0 | 15 ms |", "\n</details>",
		} {
			if !strings.Contains(text, want) {
				t.Errorf("missing %q in:\n%s", want, text)
			}
		}
		if strings.Contains(text, "| Fail rate | 0.0% ❌ |") {
			t.Errorf("clean run must not be flagged:\n%s", text)
		}
	})

	t.Run("failures", func(t *testing.T) {
		var sb strings.Builder
		writeBenchSection(&sb, collBenchResult{
			Collection: "Checkout", Runs: 1, AvgMs: 7, FailRatePct: 33.3,
			Details: []benchRun{{Run: 1, Passed: 2, Failed: 1, TotalMs: 7}},
		})
		text := sb.String()
		for _, want := range []string{"**Fail rate:** 33.3%", "| Fail rate | 33.3% ❌ |", "| 1 ❌ | 2 | 1 | 7 ms |"} {
			if !strings.Contains(text, want) {
				t.Errorf("missing %q in:\n%s", want, text)
			}
		}
	})

	t.Run("no details", func(t *testing.T) {
		var sb strings.Builder
		writeBenchSection(&sb, collBenchResult{Collection: "Empty", Runs: 0})
		text := sb.String()
		if !strings.Contains(text, "**Collection:** Empty") || !strings.Contains(text, "<summary>Per-run details</summary>") {
			t.Fatalf("empty details section = %s", text)
		}
		if strings.Contains(text, "| 1 ") {
			t.Fatalf("unexpected run rows: %s", text)
		}
	})
}

func TestWriteStressSection(t *testing.T) {
	alwaysPass := stressCLIResult{
		FlowName: "Checkout", StartedAt: "2026-01-01T00:00:00Z", FinishedAt: "2026-01-01T00:00:01Z",
		Stats: stressStats{P50: 11, P95: 22, P99: 33, RPS: 12.5, Apdex: 0.95, Requests: 40, Errors: 0},
	}
	var pass strings.Builder
	writeStressSection(&pass, alwaysPass)
	passText := pass.String()
	for _, want := range []string{
		"**Flow:** Checkout", "**Started:** 2026-01-01T00:00:00Z · **Finished:** 2026-01-01T00:00:01Z",
		"| P50 | 11 ms |", "| P95 | 22 ms |", "| P99 | 33 ms |",
		"| RPS | 12.5 req/s |", "| APDEX | 0.950 |", "| Requests | 40 |", "| Errors | 0 |",
		"**Release gates:** ✅ All passed",
	} {
		if !strings.Contains(passText, want) {
			t.Errorf("missing %q in:\n%s", want, passText)
		}
	}

	failing := alwaysPass
	failing.Stats.Errors = 3
	failing.Stats.GateFailures = []string{"p95 above 100 ms", "error rate above 1%"}
	var fail strings.Builder
	writeStressSection(&fail, failing)
	failText := fail.String()
	for _, want := range []string{
		"**Release gates:** ❌ 2 failure(s)",
		"- ❌ p95 above 100 ms\n", "- ❌ error rate above 1%\n",
	} {
		if !strings.Contains(failText, want) {
			t.Errorf("missing %q in:\n%s", want, failText)
		}
	}
	if strings.Contains(failText, "All passed") {
		t.Errorf("failing gates reported as passed:\n%s", failText)
	}
}

func TestWriteIDESection(t *testing.T) {
	var sb strings.Builder
	writeIDESection(&sb)
	text := sb.String()
	for _, want := range []string{
		"## 🔧 Code Studio (IDE) — Performance Gates",
		"### Startup & Load",
		"### Language Servers",
		"### CPU / RAM at Idle",
		"### Language Actions",
		"| Go | gopls | ___ | < 10 s | ⬜ |",
		"| Rust | rust-analyzer | ___ | < 20 s | ⬜ |",
		"| Java: Maven build | < 60 s | ___ | ⬜ |",
		"`mds/MANUAL-CHECK.md`",
	} {
		if !strings.Contains(text, want) {
			t.Errorf("missing %q", want)
		}
	}
	if got := strings.Count(text, "### "); got != 4 {
		t.Errorf("sections = %d", got)
	}
}

func TestCollectionBenchmarkClampsRuns(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) { w.WriteHeader(http.StatusOK) }))
	defer server.Close()
	s := &mcpServer{defaultFolder: exportTestCollection(t, server.URL, "200")}

	cases := []struct {
		name      string
		runs, want int
	}{
		{"default", 0, 5},
		{"negative", -3, 5},
		{"capped", 50, 20},
		{"explicit", 2, 2},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			text, err := s.collectionBenchmark("", tc.runs, "", map[string]string{"extra": "1"})
			if err != nil {
				t.Fatalf("benchmark: %v", err)
			}
			var result collBenchResult
			if err := json.Unmarshal([]byte(text), &result); err != nil {
				t.Fatalf("decode %q: %v", text, err)
			}
			if result.Runs != tc.want || len(result.Details) != tc.want {
				t.Fatalf("runs = %d, details = %d, want %d", result.Runs, len(result.Details), tc.want)
			}
			if result.Collection == "" || result.FailRatePct != 0 {
				t.Fatalf("result = %+v", result)
			}
			if result.MinMs < 0 || result.MaxMs < result.MinMs || result.P50Ms < result.MinMs {
				t.Fatalf("inconsistent percentiles: %+v", result)
			}
			for i, detail := range result.Details {
				if detail.Run != i+1 || detail.Passed != 1 || detail.Failed != 0 {
					t.Fatalf("detail %d = %+v", i, detail)
				}
			}
		})
	}
}

func TestCollectionBenchmarkErrors(t *testing.T) {
	s := &mcpServer{}
	if _, err := s.collectionBenchmark(filepath.Join(t.TempDir(), "missing"), 1, "", nil); err == nil || !strings.Contains(err.Error(), "no adOmnia collection") {
		t.Fatalf("missing collection err = %v", err)
	}

	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) { w.WriteHeader(http.StatusOK) }))
	defer server.Close()
	root := exportTestCollection(t, server.URL, "200")
	s = &mcpServer{defaultFolder: root}
	if _, err := s.collectionBenchmark("", 1, "missing", nil); err == nil || !strings.Contains(err.Error(), `read environment "missing"`) {
		t.Fatalf("missing environment err = %v", err)
	}
}

func TestCollectionBenchmarkReportsFailures(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) { w.WriteHeader(http.StatusInternalServerError) }))
	defer server.Close()
	s := &mcpServer{defaultFolder: exportTestCollection(t, server.URL, "200")}

	text, err := s.collectionBenchmark("", 1, "", nil)
	if err != nil {
		t.Fatalf("benchmark: %v", err)
	}
	var result collBenchResult
	if err := json.Unmarshal([]byte(text), &result); err != nil {
		t.Fatalf("decode %q: %v", text, err)
	}
	if result.FailRatePct != 100 {
		t.Fatalf("fail rate = %v", result.FailRatePct)
	}
	if len(result.Details) != 1 || result.Details[0].Failed != 1 || result.Details[0].Passed != 0 {
		t.Fatalf("details = %+v", result.Details)
	}
	if result.P50Ms != result.P95Ms || result.P50Ms != result.P99Ms || result.P50Ms != result.MinMs || result.P50Ms != result.MaxMs {
		t.Fatalf("single run must collapse percentiles: %+v", result)
	}
	if result.AvgMs != float64(result.Details[0].TotalMs) {
		t.Fatalf("avg = %v, total = %d", result.AvgMs, result.Details[0].TotalMs)
	}
}

func TestStressRunRejectsBadPlans(t *testing.T) {
	raw := func(body string) string {
		path := filepath.Join(t.TempDir(), "plan.stress.json")
		if err := os.WriteFile(path, []byte(body), 0o600); err != nil {
			t.Fatal(err)
		}
		return path
	}
	cases := []struct {
		name, path, want string
	}{
		{"empty path", "", "plan path is required"},
		{"blank path", "   ", "plan path is required"},
		{"missing file", filepath.Join(t.TempDir(), "nope.json"), "read plan"},
		{"not json", raw("{"), "invalid or unsupported stress plan"},
		{"wrong format", raw(`{"format":"other","version":1}`), "invalid or unsupported stress plan"},
		{"wrong version", raw(`{"format":"adomnia-flow-stress-plan","version":2}`), "invalid or unsupported stress plan"},
		{"no nodes", raw(`{"format":"adomnia-flow-stress-plan","version":1,"config":{"vus":1,"mode":"iterations","iterations":1}}`), "flow has no nodes"},
	}
	s := &mcpServer{}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			if _, err := s.stressRun(tc.path); err == nil || !strings.Contains(err.Error(), tc.want) {
				t.Fatalf("err = %v, want %q", err, tc.want)
			}
		})
	}
}

func TestStressRunExecutesPlan(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) { w.WriteHeader(http.StatusNoContent) }))
	defer server.Close()
	path := writeStressPlan(t, server.URL, 1000)

	text, err := (&mcpServer{}).stressRun(path)
	if err != nil {
		t.Fatalf("stress run: %v", err)
	}
	var result stressCLIResult
	if err := json.Unmarshal([]byte(text), &result); err != nil {
		t.Fatalf("decode %q: %v", text, err)
	}
	if result.Format != "adomnia-flow-stress-result" || result.FlowName != "Checkout CI" {
		t.Fatalf("result = %+v", result)
	}
	if result.Stats.Requests != 4 || result.Stats.Errors != 0 || len(result.Stats.GateFailures) != 0 {
		t.Fatalf("stats = %+v", result.Stats)
	}
	if result.StartedAt == "" || result.FinishedAt == "" {
		t.Fatalf("missing timestamps: %+v", result)
	}
}

// useStartupProbe swaps the cold-start measurement so report tests never spawn the CLI.
func useStartupProbe(t *testing.T, payload string, err error) {
	t.Helper()
	previous := startupProbe
	startupProbe = func(*mcpServer) (string, error) { return payload, err }
	t.Cleanup(func() { startupProbe = previous })
}

func decodeReport(t *testing.T, text string) (content, savedPath string) {
	t.Helper()
	var report struct {
		Content   string `json:"content"`
		SavedPath string `json:"savedPath"`
	}
	if err := json.Unmarshal([]byte(text), &report); err != nil {
		t.Fatalf("decode report %q: %v", text, err)
	}
	return report.Content, report.SavedPath
}

func TestPerformanceReportStartupOnly(t *testing.T) {
	useStartupProbe(t, `{"startupMs":123,"executable":"adomnia.exe"}`, nil)

	text, err := (&mcpServer{}).performanceReport(perfReportParams{})
	if err != nil {
		t.Fatalf("report: %v", err)
	}
	content, savedPath := decodeReport(t, text)
	for _, want := range []string{
		"# adOmnia Performance",
		"> **Generated:**",
		"> **Platform:** `" + runtime.GOOS + "/" + runtime.GOARCH + "`",
		"## 🚀 Startup",
		"| Cold start (CLI MCP) | **123 ms** | ✅ fast |",
		"## 🔧 Code Studio (IDE) — Performance Gates",
		"*Generated by `adomnia mcp` — tool: `performance_report`*",
	} {
		if !strings.Contains(content, want) {
			t.Errorf("missing %q in:\n%s", want, content)
		}
	}
	if strings.Contains(content, "## 📊 Collection Benchmark") || strings.Contains(content, "## ⚡ Stress Test") {
		t.Errorf("sections rendered without input:\n%s", content)
	}
	if savedPath != "" {
		t.Errorf("savedPath = %q without outputDir", savedPath)
	}
}

func TestPerformanceReportStartupProblems(t *testing.T) {
	t.Run("measurement error", func(t *testing.T) {
		useStartupProbe(t, "", os.ErrDeadlineExceeded)
		text, err := (&mcpServer{}).performanceReport(perfReportParams{})
		if err != nil {
			t.Fatalf("report: %v", err)
		}
		content, _ := decodeReport(t, text)
		if !strings.Contains(content, "> ⚠️ Startup measurement failed: i/o timeout") {
			t.Fatalf("missing failure note:\n%s", content)
		}
		if strings.Contains(content, "Cold start") {
			t.Fatalf("failure must not render the metric table:\n%s", content)
		}
	})

	t.Run("invalid payload", func(t *testing.T) {
		useStartupProbe(t, "not json", nil)
		text, err := (&mcpServer{}).performanceReport(perfReportParams{})
		if err != nil {
			t.Fatalf("report: %v", err)
		}
		content, _ := decodeReport(t, text)
		if strings.Contains(content, "Cold start") || strings.Contains(content, "Startup measurement failed") {
			t.Fatalf("invalid payload rendered a section:\n%s", content)
		}
		if !strings.Contains(content, "## 🚀 Startup") {
			t.Fatalf("startup heading missing:\n%s", content)
		}
	})
}

func TestPerformanceReportWithBenchmarkAndStress(t *testing.T) {
	useStartupProbe(t, `{"startupMs":250}`, nil)
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) { w.WriteHeader(http.StatusNoContent) }))
	defer server.Close()
	outDir := t.TempDir()

	text, err := (&mcpServer{}).performanceReport(perfReportParams{
		Title:      "Night: Release/Check",
		Collection: exportTestCollection(t, server.URL, "204"),
		Runs:       1,
		Plan:       writeStressPlan(t, server.URL, 1000),
		OutputDir:  outDir,
	})
	if err != nil {
		t.Fatalf("report: %v", err)
	}
	content, savedPath := decodeReport(t, text)
	for _, want := range []string{
		"# Night: Release/Check",
		"| Cold start (CLI MCP) | **250 ms** | ✅ good |",
		"## 📊 Collection Benchmark",
		"**Collection:** CLI Collection",
		"| P50 |",
		"## ⚡ Stress Test",
		"**Flow:** Checkout CI",
		"**Release gates:** ✅ All passed",
		"## 🔧 Code Studio (IDE) — Performance Gates",
	} {
		if !strings.Contains(content, want) {
			t.Errorf("missing %q in:\n%s", want, content)
		}
	}

	if savedPath == "" {
		t.Fatal("report was not saved")
	}
	if !strings.HasPrefix(savedPath, outDir) || !strings.HasSuffix(filepath.Base(savedPath), "-night-release-check.md") {
		t.Fatalf("savedPath = %q", savedPath)
	}
	saved, err := os.ReadFile(savedPath)
	if err != nil {
		t.Fatalf("read saved report: %v", err)
	}
	if string(saved) != content {
		t.Fatal("saved report differs from returned content")
	}
}

func TestPerformanceReportSectionErrors(t *testing.T) {
	useStartupProbe(t, `{"startupMs":100}`, nil)

	text, err := (&mcpServer{}).performanceReport(perfReportParams{
		Collection: filepath.Join(t.TempDir(), "missing"),
		Plan:       filepath.Join(t.TempDir(), "missing.stress.json"),
	})
	if err != nil {
		t.Fatalf("report: %v", err)
	}
	content, _ := decodeReport(t, text)
	if !strings.Contains(content, "> ⚠️ Benchmark failed: no adOmnia collection") {
		t.Errorf("missing benchmark failure:\n%s", content)
	}
	if !strings.Contains(content, "> ⚠️ Stress test failed: read plan") {
		t.Errorf("missing stress failure:\n%s", content)
	}
	if strings.Contains(content, "| P50 |") {
		t.Errorf("failed sections must not render metrics:\n%s", content)
	}
}

func TestPerformanceReportUnwritableOutputDir(t *testing.T) {
	useStartupProbe(t, `{"startupMs":100}`, nil)
	blocker := filepath.Join(t.TempDir(), "blocker")
	if err := os.WriteFile(blocker, []byte("file"), 0o600); err != nil {
		t.Fatal(err)
	}

	text, err := (&mcpServer{}).performanceReport(perfReportParams{OutputDir: filepath.Join(blocker, "reports")})
	if err != nil {
		t.Fatalf("report: %v", err)
	}
	content, savedPath := decodeReport(t, text)
	if savedPath != "" {
		t.Fatalf("savedPath = %q for an unwritable directory", savedPath)
	}
	if !strings.Contains(content, "# adOmnia Performance") {
		t.Fatalf("content missing when saving fails:\n%s", content)
	}
}
