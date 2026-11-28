package loadtest

import (
	"bytes"
	"encoding/csv"
	"encoding/json/jsontext"
	"encoding/xml"
	"fmt"
	"html"
	"slices"
	"strconv"
	"strings"

	"github.com/Andrea-Cavallo/adOmnia/internal/jsonutil"
)

// Report formats, all rendered from the canonical JSON Result (what the history saves).
const (
	ReportJSON     = "json"
	ReportMarkdown = "md"
	ReportHTML     = "html"
	ReportJUnit    = "junit"
	ReportCSV      = "csv"     // one row per step plus the totals
	ReportSamples  = "samples" // the per-request log as CSV
)

// Render turns a result into one of the report formats.
func Render(r Result, format string) ([]byte, error) {
	switch format {
	case ReportJSON, "":
		data, err := jsonutil.Marshal(r, jsontext.WithIndent("  "))
		return append(data, '\n'), err
	case ReportMarkdown, "markdown":
		return []byte(markdownReport(r)), nil
	case ReportHTML:
		return []byte(htmlReport(r)), nil
	case ReportJUnit:
		return junitReport(r)
	case ReportCSV:
		return stepsCSV(r)
	case ReportSamples:
		return samplesCSV(r)
	default:
		return nil, fmt.Errorf("unknown report format %q (use json, md, html, junit, csv or samples)", format)
	}
}

func fmtFloat(v float64) string { return strconv.FormatFloat(v, 'f', -1, 64) }

func fmtSigned(v float64) string {
	if v > 0 {
		return "+" + fmtFloat(v)
	}
	return fmtFloat(v)
}

func reportTitle(r Result) string {
	if r.Name != "" {
		return r.Name
	}
	if r.Manifest != nil && r.Manifest.TargetLabel != "" {
		return r.Manifest.TargetLabel
	}
	return "Load test"
}

// verdict is one line: passed, failed (with how many gates) or stopped.
func verdict(r Result) string {
	switch {
	case r.AbortReason != "":
		return "STOPPED: " + r.AbortReason
	case len(r.GateFailures) > 0:
		return fmt.Sprintf("FAILED: %d gate(s) broken", len(r.GateFailures))
	case r.Aborted:
		return "STOPPED before the end"
	default:
		return "PASSED"
	}
}

type metricRow struct{ label, value string }

func summaryRows(r Result) []metricRow {
	rows := []metricRow{
		{"Requests (measured)", strconv.Itoa(r.Successful + r.Failed)},
		{"Failed", strconv.Itoa(r.Failed)},
		{"Error rate", fmt.Sprintf("%.2f%%", r.ErrorRate)},
		{"Throughput", fmt.Sprintf("%.1f req/s", r.Throughput)},
		{"p50 / p95 / p99", fmt.Sprintf("%.1f / %.1f / %.1f ms", r.P50Ms, r.P95Ms, r.P99Ms)},
		{"p99.9 / max", fmt.Sprintf("%.1f / %.1f ms", r.P999Ms, r.MaxMs)},
		{"Peak VUs", strconv.Itoa(r.MaxVUs)},
		{"Duration", fmt.Sprintf("%.1f s", r.TotalTimeMs/1000)},
	}
	if r.WarmupSkipped > 0 {
		rows = append(rows, metricRow{"Warm-up (not measured)", strconv.Itoa(r.WarmupSkipped)})
	}
	if r.DroppedIterations > 0 {
		rows = append(rows, metricRow{"Dropped iterations", strconv.Itoa(r.DroppedIterations)})
	}
	if r.Apdex != nil {
		rows = append(rows, metricRow{"APDEX", fmt.Sprintf("%.3f (T = %.0f ms)", r.Apdex.Score, r.Apdex.ThresholdMs)})
	}
	return rows
}

func manifestRows(m *Manifest) []metricRow {
	if m == nil {
		return nil
	}
	rows := []metricRow{
		{"Target", m.Target + " · " + m.TargetLabel},
		{"Scenario hash", shortHash(m.ScenarioHash)},
		{"Seed", strconv.FormatUint(m.Seed, 10)},
		{"adOmnia", strings.TrimSpace(m.AppVersion + " " + shortHash(m.Commit))},
		{"Generator", fmt.Sprintf("%s/%s, %d CPU, %s", m.OS, m.Arch, m.CPUs, m.GoVersion)},
	}
	if m.DatasetHash != "" {
		rows = append(rows, metricRow{"Dataset", fmt.Sprintf("%d rows, %s", m.DatasetRows, shortHash(m.DatasetHash))})
	}
	if m.Saturated {
		rows = append(rows, metricRow{"Generator saturated", "yes: latencies include the machine's own delay"})
	}
	return rows
}

func shortHash(h string) string {
	if len(h) > 12 {
		return h[:12]
	}
	return h
}

func sortedCodes(r Result) []int {
	codes := make([]int, 0, len(r.StatusCodes))
	for c := range r.StatusCodes {
		codes = append(codes, c)
	}
	slices.Sort(codes)
	return codes
}

func mdCell(s string) string { return strings.ReplaceAll(s, "|", "\\|") }

func markdownReport(r Result) string {
	var b strings.Builder
	fmt.Fprintf(&b, "# %s\n\n**%s** · started %s\n\n", reportTitle(r), verdict(r), r.StartedAt)
	b.WriteString("| Metric | Value |\n|---|---|\n")
	for _, row := range summaryRows(r) {
		fmt.Fprintf(&b, "| %s | %s |\n", row.label, row.value)
	}
	if len(r.GateFailures) > 0 {
		b.WriteString("\n## Gate failures\n\n")
		for _, f := range r.GateFailures {
			fmt.Fprintf(&b, "- %s\n", f)
		}
	}
	if len(r.Steps) > 0 {
		b.WriteString("\n## Steps\n\n| Step | Requests | Errors | p50 | p95 | p99 | max |\n|---|---:|---:|---:|---:|---:|---:|\n")
		for _, s := range r.Steps {
			fmt.Fprintf(&b, "| %s | %d | %d (%.1f%%) | %.1f | %.1f | %.1f | %.1f |\n", mdCell(s.Step), s.Count, s.Errors, s.ErrorPct, s.P50Ms, s.P95Ms, s.P99Ms, s.MaxMs)
		}
	}
	if len(r.ErrorGroups) > 0 {
		b.WriteString("\n## Errors\n\n| Code | Message | Count |\n|---|---|---:|\n")
		for _, g := range r.ErrorGroups {
			fmt.Fprintf(&b, "| %s | %s | %d |\n", g.Code, mdCell(g.Message), g.Count)
		}
	}
	if len(r.StatusCodes) > 0 {
		b.WriteString("\n## Status codes\n\n| Code | Count |\n|---|---:|\n")
		for _, c := range sortedCodes(r) {
			fmt.Fprintf(&b, "| %d | %d |\n", c, r.StatusCodes[c])
		}
	}
	if rows := manifestRows(r.Manifest); len(rows) > 0 {
		b.WriteString("\n## Run conditions\n\n| | |\n|---|---|\n")
		for _, row := range rows {
			fmt.Fprintf(&b, "| %s | %s |\n", row.label, mdCell(row.value))
		}
	}
	b.WriteString("\n---\n*Generated by adOmnia*\n")
	return b.String()
}

func htmlTable(head []string, rows [][]string) string {
	var b strings.Builder
	b.WriteString("<table><thead><tr>")
	for _, h := range head {
		b.WriteString("<th>" + html.EscapeString(h) + "</th>")
	}
	b.WriteString("</tr></thead><tbody>")
	for _, row := range rows {
		b.WriteString("<tr>")
		for _, cell := range row {
			b.WriteString("<td>" + html.EscapeString(cell) + "</td>")
		}
		b.WriteString("</tr>")
	}
	b.WriteString("</tbody></table>")
	return b.String()
}

// throughputSVG draws req/s per second as a self-contained line.
func throughputSVG(buckets []Bucket) string {
	if len(buckets) < 2 {
		return ""
	}
	peak := 1
	for _, b := range buckets {
		peak = max(peak, b.Reqs)
	}
	const w, h = 720.0, 120.0
	var pts strings.Builder
	for i, b := range buckets {
		x := float64(i) / float64(len(buckets)-1) * w
		y := h - float64(b.Reqs)/float64(peak)*(h-8)
		fmt.Fprintf(&pts, "%.1f,%.1f ", x, y)
	}
	return fmt.Sprintf(`<h2>Throughput (req/s, peak %d)</h2><svg viewBox="0 0 %.0f %.0f" width="100%%" height="120" role="img" aria-label="Requests per second"><polyline fill="none" stroke="#7C3AED" stroke-width="2" points="%s"/></svg>`,
		peak, w, h, strings.TrimSpace(pts.String()))
}

func rowsOf(m []metricRow) [][]string {
	out := make([][]string, 0, len(m))
	for _, row := range m {
		out = append(out, []string{row.label, row.value})
	}
	return out
}

const htmlStyle = `<style>:root{color-scheme:light dark;--bg:#fff;--fg:#111827;--muted:#6b7280;--line:#e5e7eb;--head:#f9fafb;--ok:#047857;--bad:#b91c1c}
@media (prefers-color-scheme:dark){:root{--bg:#05070d;--fg:#f5f7fa;--muted:#8b949e;--line:#1f2333;--head:#0e101a;--ok:#34d399;--bad:#f87171}}
body{font-family:system-ui,sans-serif;background:var(--bg);color:var(--fg);margin:0 auto;padding:32px 16px;max-width:900px}
h1{margin:0 0 4px}h2{margin-top:28px;font-size:16px}.muted{color:var(--muted)}.verdict{font-weight:700;color:var(--ok)}.verdict[data-failed=true]{color:var(--bad)}
table{width:100%;border-collapse:collapse;margin-top:8px;font-size:13px}th,td{border:1px solid var(--line);padding:6px 8px;text-align:left}th{background:var(--head)}td{font-variant-numeric:tabular-nums}
footer{margin-top:32px;color:var(--muted);font-size:12px}</style>`

func htmlReport(r Result) string {
	var body strings.Builder
	failed := len(r.GateFailures) > 0 || r.AbortReason != ""
	fmt.Fprintf(&body, `<h1>%s</h1><p class="verdict" data-failed="%t">%s</p><p class="muted">Started %s</p>`,
		html.EscapeString(reportTitle(r)), failed, html.EscapeString(verdict(r)), html.EscapeString(r.StartedAt))
	body.WriteString(htmlTable([]string{"Metric", "Value"}, rowsOf(summaryRows(r))))
	if len(r.GateFailures) > 0 {
		body.WriteString("<h2>Gate failures</h2><ul>")
		for _, f := range r.GateFailures {
			body.WriteString("<li>" + html.EscapeString(f) + "</li>")
		}
		body.WriteString("</ul>")
	}
	body.WriteString(throughputSVG(r.ThroughputTimeline))
	if len(r.Steps) > 0 {
		rows := make([][]string, 0, len(r.Steps))
		for _, s := range r.Steps {
			rows = append(rows, []string{s.Step, strconv.Itoa(s.Count), fmt.Sprintf("%d (%.1f%%)", s.Errors, s.ErrorPct),
				fmt.Sprintf("%.1f", s.P50Ms), fmt.Sprintf("%.1f", s.P95Ms), fmt.Sprintf("%.1f", s.P99Ms), fmt.Sprintf("%.1f", s.MaxMs)})
		}
		body.WriteString("<h2>Steps</h2>" + htmlTable([]string{"Step", "Requests", "Errors", "p50 ms", "p95 ms", "p99 ms", "max ms"}, rows))
	}
	if len(r.ErrorGroups) > 0 {
		rows := make([][]string, 0, len(r.ErrorGroups))
		for _, g := range r.ErrorGroups {
			rows = append(rows, []string{g.Code, g.Message, strconv.Itoa(g.Count)})
		}
		body.WriteString("<h2>Errors</h2>" + htmlTable([]string{"Code", "Message", "Count"}, rows))
	}
	if len(r.StatusCodes) > 0 {
		rows := [][]string{}
		for _, c := range sortedCodes(r) {
			rows = append(rows, []string{strconv.Itoa(c), strconv.Itoa(r.StatusCodes[c])})
		}
		body.WriteString("<h2>Status codes</h2>" + htmlTable([]string{"Code", "Count"}, rows))
	}
	if mrows := manifestRows(r.Manifest); len(mrows) > 0 {
		body.WriteString("<h2>Run conditions</h2>" + htmlTable([]string{"", ""}, rowsOf(mrows)))
	}
	return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>` +
		html.EscapeString(reportTitle(r)) + ` · load test</title>` + htmlStyle + `</head><body>` + body.String() + `<footer>Generated by adOmnia</footer></body></html>`
}

type junitSuite struct {
	XMLName  xml.Name    `xml:"testsuite"`
	Name     string      `xml:"name,attr"`
	Tests    int         `xml:"tests,attr"`
	Failures int         `xml:"failures,attr"`
	Time     string      `xml:"time,attr"`
	Cases    []junitCase `xml:"testcase"`
}

type junitCase struct {
	Name      string        `xml:"name,attr"`
	Classname string        `xml:"classname,attr"`
	Failure   *junitFailure `xml:"failure,omitempty"`
}

type junitFailure struct {
	Message string `xml:"message,attr"`
	Text    string `xml:",chardata"`
}

// Failures are the broken gates plus a live abort: what makes a CI job fail.
func Failures(r Result) []string {
	out := slices.Clone(r.GateFailures)
	if r.AbortReason != "" {
		out = append(out, "stopped during the run: "+r.AbortReason)
	}
	return out
}

// junitReport has one case per failure, or one passing "gates" case.
func junitReport(r Result) ([]byte, error) {
	failures := Failures(r)
	cases := []junitCase{}
	if len(failures) == 0 {
		cases = append(cases, junitCase{Name: "load test gates", Classname: "adomnia.loadtest"})
	}
	for _, f := range failures {
		cases = append(cases, junitCase{Name: f, Classname: "adomnia.loadtest", Failure: &junitFailure{Message: f, Text: f}})
	}
	suite := junitSuite{Name: reportTitle(r) + " load test", Tests: len(cases), Failures: len(failures), Time: fmt.Sprintf("%.3f", r.TotalTimeMs/1000), Cases: cases}
	data, err := xml.MarshalIndent(suite, "", "  ")
	return append([]byte(xml.Header), append(data, '\n')...), err
}

func writeCSV(rows [][]string) ([]byte, error) {
	var buf bytes.Buffer
	w := csv.NewWriter(&buf)
	if err := w.WriteAll(rows); err != nil {
		return nil, fmt.Errorf("write csv: %w", err)
	}
	return buf.Bytes(), nil
}

func stepsCSV(r Result) ([]byte, error) {
	f := func(v float64) string { return strconv.FormatFloat(v, 'f', 2, 64) }
	rows := [][]string{{"step", "requests", "errors", "error_pct", "min_ms", "avg_ms", "p50_ms", "p90_ms", "p95_ms", "p99_ms", "max_ms"}}
	for _, s := range r.Steps {
		rows = append(rows, []string{s.Step, strconv.Itoa(s.Count), strconv.Itoa(s.Errors), f(s.ErrorPct), f(s.MinMs), f(s.AvgMs), f(s.P50Ms), f(s.P90Ms), f(s.P95Ms), f(s.P99Ms), f(s.MaxMs)})
	}
	rows = append(rows, []string{"TOTAL", strconv.Itoa(r.Successful + r.Failed), strconv.Itoa(r.Failed), f(r.ErrorRate), f(r.MinMs), f(r.AvgMs), f(r.P50Ms), f(r.P90Ms), f(r.P95Ms), f(r.P99Ms), f(r.MaxMs)})
	return writeCSV(rows)
}

func samplesCSV(r Result) ([]byte, error) {
	f := func(v float64) string { return strconv.FormatFloat(v, 'f', 3, 64) }
	rows := [][]string{{"start_ms", "end_ms", "latency_ms", "step", "vu", "iteration", "status", "ok", "measured", "bytes", "error"}}
	for _, p := range r.Timeline {
		rows = append(rows, []string{f(p.StartMs), f(p.TimeMs), f(p.LatencyMs), p.Step, strconv.Itoa(p.VU), strconv.Itoa(p.Iteration), strconv.Itoa(p.Status),
			strconv.FormatBool(p.Ok), strconv.FormatBool(p.Measured), strconv.FormatInt(p.Bytes, 10), p.Error})
	}
	return writeCSV(rows)
}
