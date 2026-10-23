package adomniacli

import (
	"bufio"
	"encoding/json/v2"
	"fmt"
	"math"
	"os"
	"os/exec"
	"path/filepath"
	"runtime"
	"sort"
	"strings"
	"time"
)

// ─── stress_run ────────────────────────────────────────────────────────────

// stressRun reads a .stress.json plan from disk and executes it in-process.
func (s *mcpServer) stressRun(planPath string) (string, error) {
	if strings.TrimSpace(planPath) == "" {
		return "", fmt.Errorf("plan path is required")
	}
	data, err := os.ReadFile(planPath)
	if err != nil {
		return "", fmt.Errorf("read plan: %w", err)
	}
	var plan stressPlan
	if err := json.Unmarshal(data, &plan); err != nil || plan.Format != "adomnia-flow-stress-plan" || plan.Version != 1 {
		return "", fmt.Errorf("invalid or unsupported stress plan")
	}
	result, err := executeStressPlan(plan, nil, nil)
	if err != nil {
		return "", err
	}
	return jsonText(result)
}

// ─── collection_benchmark ──────────────────────────────────────────────────

type benchRun struct {
	Run     int   `json:"run"`
	Passed  int   `json:"passed"`
	Failed  int   `json:"failed"`
	TotalMs int64 `json:"totalMs"`
}

type collBenchResult struct {
	Collection  string     `json:"collection"`
	Runs        int        `json:"runs"`
	P50Ms       int64      `json:"p50Ms"`
	P95Ms       int64      `json:"p95Ms"`
	P99Ms       int64      `json:"p99Ms"`
	MinMs       int64      `json:"minMs"`
	MaxMs       int64      `json:"maxMs"`
	AvgMs       float64    `json:"avgMs"`
	FailRatePct float64    `json:"failRatePct"`
	Details     []benchRun `json:"details"`
}

func (s *mcpServer) collectionBenchmark(requested string, runs int, envName string, overrides map[string]string) (string, error) {
	if runs <= 0 {
		runs = 5
	}
	if runs > 20 {
		runs = 20
	}
	collection, folder, err := s.loadCollection(requested)
	if err != nil {
		return "", err
	}
	vars, sources, err := loadRunVars(folder, envName, overrides)
	if err != nil {
		return "", err
	}
	var durations []int64
	details := make([]benchRun, 0, runs)
	totalFailed, totalRequests := 0, 0
	for i := 0; i < runs; i++ {
		start := time.Now()
		summary := executeCollection(collection, false, cloneStringMap(vars), sources, "")
		elapsed := time.Since(start).Milliseconds()
		durations = append(durations, elapsed)
		details = append(details, benchRun{Run: i + 1, Passed: summary.Passed, Failed: summary.Failed, TotalMs: elapsed})
		totalFailed += summary.Failed
		totalRequests += summary.Passed + summary.Failed
	}
	sort.Slice(durations, func(i, j int) bool { return durations[i] < durations[j] })
	pct := func(p float64) int64 {
		idx := int(math.Ceil(p*float64(len(durations)))) - 1
		if idx < 0 {
			idx = 0
		}
		return durations[idx]
	}
	var sum int64
	for _, d := range durations {
		sum += d
	}
	failRate := 0.0
	if totalRequests > 0 {
		failRate = math.Round(float64(totalFailed)/float64(totalRequests)*1000) / 10
	}
	return jsonText(collBenchResult{
		Collection:  collection.Name,
		Runs:        runs,
		P50Ms:       pct(0.50),
		P95Ms:       pct(0.95),
		P99Ms:       pct(0.99),
		MinMs:       durations[0],
		MaxMs:       durations[len(durations)-1],
		AvgMs:       math.Round(float64(sum)/float64(runs)*10) / 10,
		FailRatePct: failRate,
		Details:     details,
	})
}

func cloneStringMap(m map[string]string) map[string]string {
	out := make(map[string]string, len(m))
	for k, v := range m {
		out[k] = v
	}
	return out
}

// ─── app_startup_time ──────────────────────────────────────────────────────

type startupResult struct {
	StartupMs  int64  `json:"startupMs"`
	Executable string `json:"executable"`
	OS         string `json:"os"`
	MeasuredAt string `json:"measuredAt"`
}

// appStartupTime spawns a fresh adomnia mcp subprocess, sends initialize, and
// measures milliseconds until the first JSON-RPC response (cold-start latency).
func (s *mcpServer) appStartupTime() (string, error) {
	executable, err := os.Executable()
	if err != nil {
		return "", fmt.Errorf("executable: %w", err)
	}
	cmd := exec.Command(executable, "mcp")
	stdinPipe, err := cmd.StdinPipe()
	if err != nil {
		return "", fmt.Errorf("stdin pipe: %w", err)
	}
	stdoutPipe, err := cmd.StdoutPipe()
	if err != nil {
		return "", fmt.Errorf("stdout pipe: %w", err)
	}
	start := time.Now()
	if err := cmd.Start(); err != nil {
		return "", fmt.Errorf("start subprocess: %w", err)
	}
	defer func() {
		_ = cmd.Process.Kill()
		_ = cmd.Wait()
	}()
	const initMsg = `{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2025-06-18","clientInfo":{"name":"benchmark","version":"1"}}}` + "\n"
	if _, err := fmt.Fprint(stdinPipe, initMsg); err != nil {
		return "", fmt.Errorf("send initialize: %w", err)
	}
	scanner := bufio.NewScanner(stdoutPipe)
	if !scanner.Scan() {
		if scanErr := scanner.Err(); scanErr != nil {
			return "", fmt.Errorf("read response: %w", scanErr)
		}
		return "", fmt.Errorf("subprocess closed without responding")
	}
	elapsed := time.Since(start).Milliseconds()
	return jsonText(startupResult{
		StartupMs:  elapsed,
		Executable: executable,
		OS:         runtime.GOOS,
		MeasuredAt: time.Now().UTC().Format(time.RFC3339),
	})
}

// ─── performance_report ────────────────────────────────────────────────────

type perfReportParams struct {
	Title      string            `json:"title"`
	Collection string            `json:"collection"`
	Runs       int               `json:"runs"`
	Plan       string            `json:"plan"`
	Env        string            `json:"env"`
	Vars       map[string]string `json:"vars"`
	OutputDir  string            `json:"outputDir"`
}

// performanceReport runs the requested benchmarks and produces a Markdown report.
// If outputDir is set the .md is also saved to disk; the content is always returned.
func (s *mcpServer) performanceReport(p perfReportParams) (string, error) {
	if p.Title == "" {
		p.Title = "adOmnia Performance"
	}
	now := time.Now().UTC()
	executable, _ := os.Executable()

	var sb strings.Builder

	// ── header ──────────────────────────────────────────────────────────────
	fmt.Fprintf(&sb, "# %s\n\n", p.Title)
	fmt.Fprintf(&sb, "> **Generated:** %s  \n", now.Format("2006-01-02 15:04:05 UTC"))
	if executable != "" {
		fmt.Fprintf(&sb, "> **Binary:** `%s`  \n", filepath.Base(executable))
	}
	fmt.Fprintf(&sb, "> **Platform:** `%s/%s`\n\n", runtime.GOOS, runtime.GOARCH)
	fmt.Fprintf(&sb, "---\n\n")

	// ── startup ─────────────────────────────────────────────────────────────
	fmt.Fprintf(&sb, "## 🚀 Startup\n\n")
	startupJSON, startupErr := s.appStartupTime()
	if startupErr != nil {
		fmt.Fprintf(&sb, "> ⚠️ Startup measurement failed: %s\n\n", startupErr)
	} else {
		var sr startupResult
		if json.Unmarshal([]byte(startupJSON), &sr) == nil {
			fmt.Fprintf(&sb, "| Metric | Value | Rating |\n|--------|-------|--------|\n")
			fmt.Fprintf(&sb, "| Cold start (CLI MCP) | **%d ms** | %s |\n\n", sr.StartupMs, startupRating(sr.StartupMs))
		}
	}

	// ── collection benchmark ─────────────────────────────────────────────────
	if strings.TrimSpace(p.Collection) != "" {
		fmt.Fprintf(&sb, "## 📊 Collection Benchmark\n\n")
		benchJSON, benchErr := s.collectionBenchmark(p.Collection, p.Runs, p.Env, p.Vars)
		if benchErr != nil {
			fmt.Fprintf(&sb, "> ⚠️ Benchmark failed: %s\n\n", benchErr)
		} else {
			var br collBenchResult
			if json.Unmarshal([]byte(benchJSON), &br) == nil {
				writeBenchSection(&sb, br)
			}
		}
	}

	// ── stress test ──────────────────────────────────────────────────────────
	if strings.TrimSpace(p.Plan) != "" {
		fmt.Fprintf(&sb, "## ⚡ Stress Test\n\n")
		stressJSON, stressErr := s.stressRun(p.Plan)
		if stressErr != nil {
			fmt.Fprintf(&sb, "> ⚠️ Stress test failed: %s\n\n", stressErr)
		} else {
			var sr stressCLIResult
			if json.Unmarshal([]byte(stressJSON), &sr) == nil {
				writeStressSection(&sb, sr)
			}
		}
	}

	// ── IDE Code Studio manual checklist ─────────────────────────────────────
	writeIDESection(&sb)

	fmt.Fprintf(&sb, "---\n\n*Generated by `adomnia mcp` — tool: `performance_report`*\n")

	content := sb.String()

	// ── save to disk ─────────────────────────────────────────────────────────
	savedPath := ""
	if strings.TrimSpace(p.OutputDir) != "" {
		if mkErr := os.MkdirAll(p.OutputDir, 0755); mkErr == nil {
			slug := strings.ToLower(strings.NewReplacer(" ", "-", "/", "-", "\\", "-", ":", "").Replace(p.Title))
			filename := fmt.Sprintf("%s-%s.md", now.Format("2006-01-02T15-04-05Z"), slug)
			full := filepath.Join(p.OutputDir, filename)
			if writeErr := os.WriteFile(full, []byte(content), 0644); writeErr == nil {
				savedPath = full
			}
		}
	}

	return jsonText(map[string]any{
		"content":   content,
		"savedPath": savedPath,
	})
}

// ─── report helpers ─────────────────────────────────────────────────────────

func startupRating(ms int64) string {
	switch {
	case ms < 200:
		return "✅ fast"
	case ms < 500:
		return "✅ good"
	case ms < 1000:
		return "⚠️ slow"
	default:
		return "❌ very slow"
	}
}

func writeBenchSection(sb *strings.Builder, br collBenchResult) {
	fmt.Fprintf(sb, "**Collection:** %s  \n", br.Collection)
	fmt.Fprintf(sb, "**Runs:** %d · **Fail rate:** %.1f%%\n\n", br.Runs, br.FailRatePct)

	failIcon := "✅"
	if br.FailRatePct > 0 {
		failIcon = "❌"
	}
	fmt.Fprintf(sb, "| Metric | Value |\n|--------|-------|\n")
	fmt.Fprintf(sb, "| P50 | %d ms |\n", br.P50Ms)
	fmt.Fprintf(sb, "| P95 | %d ms |\n", br.P95Ms)
	fmt.Fprintf(sb, "| P99 | %d ms |\n", br.P99Ms)
	fmt.Fprintf(sb, "| Min | %d ms |\n", br.MinMs)
	fmt.Fprintf(sb, "| Max | %d ms |\n", br.MaxMs)
	fmt.Fprintf(sb, "| Avg | %.1f ms |\n", br.AvgMs)
	fmt.Fprintf(sb, "| Fail rate | %.1f%% %s |\n\n", br.FailRatePct, failIcon)

	sb.WriteString("<details>\n<summary>Per-run details</summary>\n\n")
	sb.WriteString("| Run | Passed | Failed | Duration |\n|-----|--------|--------|----------|\n")
	for _, d := range br.Details {
		icon := "✅"
		if d.Failed > 0 {
			icon = "❌"
		}
		fmt.Fprintf(sb, "| %d %s | %d | %d | %d ms |\n", d.Run, icon, d.Passed, d.Failed, d.TotalMs)
	}
	sb.WriteString("\n</details>\n\n")
}

func writeStressSection(sb *strings.Builder, sr stressCLIResult) {
	fmt.Fprintf(sb, "**Flow:** %s  \n", sr.FlowName)
	fmt.Fprintf(sb, "**Started:** %s · **Finished:** %s\n\n", sr.StartedAt, sr.FinishedAt)

	fmt.Fprintf(sb, "| Metric | Value |\n|--------|-------|\n")
	fmt.Fprintf(sb, "| P50 | %d ms |\n", sr.Stats.P50)
	fmt.Fprintf(sb, "| P95 | %d ms |\n", sr.Stats.P95)
	fmt.Fprintf(sb, "| P99 | %d ms |\n", sr.Stats.P99)
	fmt.Fprintf(sb, "| RPS | %.1f req/s |\n", sr.Stats.RPS)
	fmt.Fprintf(sb, "| APDEX | %.3f |\n", sr.Stats.Apdex)
	fmt.Fprintf(sb, "| Requests | %d |\n", sr.Stats.Requests)
	fmt.Fprintf(sb, "| Errors | %d |\n\n", sr.Stats.Errors)

	if len(sr.Stats.GateFailures) == 0 {
		sb.WriteString("**Release gates:** ✅ All passed\n\n")
	} else {
		fmt.Fprintf(sb, "**Release gates:** ❌ %d failure(s)\n\n", len(sr.Stats.GateFailures))
		for _, f := range sr.Stats.GateFailures {
			fmt.Fprintf(sb, "- ❌ %s\n", f)
		}
		sb.WriteByte('\n')
	}
}

// writeIDESection generates the Code Studio checklist table that a human fills in
// while running the desktop app. The checkboxes track the MANUAL-CHECK.md targets.
func writeIDESection(sb *strings.Builder) {
	sb.WriteString("## 🔧 Code Studio (IDE) — Performance Gates\n\n")
	sb.WriteString("> Requires the desktop app running (`wails3 task dev` or release build).  \n")
	sb.WriteString("> Fill in measured values from Task Manager / the in-app Resource Monitor.\n\n")

	sb.WriteString("### Startup & Load\n\n")
	sb.WriteString("| Check | Target | Measured | Status |\n|-------|--------|----------|--------|\n")
	sb.WriteString("| App window visible after launch | < 3 s | ___ | ⬜ |\n")
	sb.WriteString("| Workspace load (cold, small project) | < 5 s | ___ | ⬜ |\n")
	sb.WriteString("| Workspace load (warm) | < 1 s | ___ | ⬜ |\n")
	sb.WriteString("| Workspace load (large: ≥80 Go pkgs) | < 15 s | ___ | ⬜ |\n\n")

	sb.WriteString("### Language Servers\n\n")
	sb.WriteString("| Language | Server | Ready in | Target | Status |\n|----------|--------|----------|--------|--------|\n")
	sb.WriteString("| Go | gopls | ___ | < 10 s | ⬜ |\n")
	sb.WriteString("| Go | first semantic colour | ___ | < 3 s after gopls | ⬜ |\n")
	sb.WriteString("| Rust | rust-analyzer | ___ | < 20 s | ⬜ |\n")
	sb.WriteString("| Python | basedpyright | ___ | < 15 s | ⬜ |\n")
	sb.WriteString("| Java | JDT LS | ___ | < 30 s | ⬜ |\n")
	sb.WriteString("| Web (TS/JS) | tsserver | ___ | < 10 s | ⬜ |\n\n")

	sb.WriteString("### CPU / RAM at Idle\n\n")
	sb.WriteString("| Condition | Target | Measured | Status |\n|-----------|--------|----------|--------|\n")
	sb.WriteString("| No project open, 2 min idle | CPU < 0.5% | ___ | ⬜ |\n")
	sb.WriteString("| Project open (Go), 2 min idle | CPU < 2% | ___ | ⬜ |\n")
	sb.WriteString("| App running 30 min (no activity) | RAM < 300 MB | ___ | ⬜ |\n\n")

	sb.WriteString("### Language Actions\n\n")
	sb.WriteString("| Action | Target | Measured | Status |\n|--------|--------|----------|--------|\n")
	sb.WriteString("| Go: `go test ./...` (adOmnia itself) | < 120 s | ___ | ⬜ |\n")
	sb.WriteString("| Rust: `cargo check` on save | < 8 s | ___ | ⬜ |\n")
	sb.WriteString("| Rust: `cargo test` (unit) | < 30 s | ___ | ⬜ |\n")
	sb.WriteString("| Python: pytest run | < 15 s | ___ | ⬜ |\n")
	sb.WriteString("| Java: Maven build | < 60 s | ___ | ⬜ |\n\n")

	sb.WriteString("> **Reference:** `mds/MANUAL-CHECK.md` §IDE-1…7, GS-4, GS-6, RES-1, REF-11, RS, PY, JS-9\n\n")
}
