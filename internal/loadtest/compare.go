package loadtest

import "math"

// DefaultTolerancePct is how much worse p95 or the error rate may get before a comparison
// calls it a regression.
const DefaultTolerancePct = 10

// Delta is one metric of two runs: Pct is the relative change (0 when the base is 0), Worse
// says whether the change goes the wrong way beyond the tolerance.
type Delta struct {
	Metric string  `json:"metric"`
	Base   float64 `json:"base"`
	Head   float64 `json:"head"`
	Diff   float64 `json:"diff"`
	Pct    float64 `json:"pct"`
	Worse  bool    `json:"worse,omitzero"`
}

// StepDelta compares one step present in both runs (by node id).
type StepDelta struct {
	ID     string  `json:"id"`
	Step   string  `json:"step"`
	Deltas []Delta `json:"deltas"`
}

// Comparison is base → head: the global metrics, the steps both runs have, and a verdict.
type Comparison struct {
	Deltas       []Delta     `json:"deltas"`
	Steps        []StepDelta `json:"steps,omitempty"`
	OnlyInBase   []string    `json:"onlyInBase,omitempty"`
	OnlyInHead   []string    `json:"onlyInHead,omitempty"`
	Regression   bool        `json:"regression"`
	Reasons      []string    `json:"reasons,omitempty"`
	SameScenario bool        `json:"sameScenario"`
	Warnings     []string    `json:"warnings,omitempty"`
	TolerancePct float64     `json:"tolerancePct"`
}

// metricDelta builds a Delta; lowerIsBetter says which way is worse.
func metricDelta(name string, base, head float64, lowerIsBetter bool, tolerancePct float64) Delta {
	d := Delta{Metric: name, Base: base, Head: head, Diff: round2(head - base)}
	if base != 0 {
		d.Pct = round2((head - base) / math.Abs(base) * 100)
	}
	worsening := d.Pct
	if !lowerIsBetter {
		worsening = -d.Pct
	}
	d.Worse = worsening > tolerancePct || (base == 0 && lowerIsBetter && head > 0 && name == "errorRate")
	return d
}

// Compare tells what changed from base to head.
func Compare(base, head Result, tolerancePct float64) Comparison {
	if tolerancePct <= 0 {
		tolerancePct = DefaultTolerancePct
	}
	c := Comparison{TolerancePct: tolerancePct}
	c.Deltas = []Delta{
		metricDelta("p50Ms", base.P50Ms, head.P50Ms, true, tolerancePct),
		metricDelta("p95Ms", base.P95Ms, head.P95Ms, true, tolerancePct),
		metricDelta("p99Ms", base.P99Ms, head.P99Ms, true, tolerancePct),
		metricDelta("avgMs", base.AvgMs, head.AvgMs, true, tolerancePct),
		metricDelta("errorRate", base.ErrorRate, head.ErrorRate, true, tolerancePct),
		metricDelta("throughput", base.Throughput, head.Throughput, false, tolerancePct),
	}
	for _, d := range c.Deltas {
		if d.Worse && (d.Metric == "p95Ms" || d.Metric == "errorRate") {
			c.Regression = true
			c.Reasons = append(c.Reasons, regressionReason(d))
		}
	}
	baseSteps := map[string]StepResult{}
	for _, s := range base.Steps {
		baseSteps[s.ID] = s
	}
	seen := map[string]bool{}
	for _, h := range head.Steps {
		b, ok := baseSteps[h.ID]
		if !ok {
			c.OnlyInHead = append(c.OnlyInHead, h.Step)
			continue
		}
		seen[h.ID] = true
		c.Steps = append(c.Steps, StepDelta{ID: h.ID, Step: h.Step, Deltas: []Delta{
			metricDelta("p95Ms", b.P95Ms, h.P95Ms, true, tolerancePct),
			metricDelta("p99Ms", b.P99Ms, h.P99Ms, true, tolerancePct),
			metricDelta("errorPct", b.ErrorPct, h.ErrorPct, true, tolerancePct),
		}})
	}
	for _, b := range base.Steps {
		if !seen[b.ID] {
			c.OnlyInBase = append(c.OnlyInBase, b.Step)
		}
	}
	c.SameScenario = base.Manifest != nil && head.Manifest != nil && base.Manifest.ScenarioHash == head.Manifest.ScenarioHash
	if !c.SameScenario {
		c.Warnings = append(c.Warnings, "the two runs did not use the same scenario (target, workload or gates differ): the deltas compare different tests")
	}
	if (base.Manifest != nil && base.Manifest.Saturated) || (head.Manifest != nil && head.Manifest.Saturated) {
		c.Warnings = append(c.Warnings, "one of the runs had a saturated generator: its latencies include the machine's own delay")
	}
	if base.Aborted || head.Aborted {
		c.Warnings = append(c.Warnings, "one of the runs was stopped before the end")
	}
	return c
}

func regressionReason(d Delta) string {
	if d.Metric == "errorRate" {
		return "error rate went from " + fmtFloat(d.Base) + "% to " + fmtFloat(d.Head) + "%"
	}
	return "p95 went from " + fmtFloat(d.Base) + " ms to " + fmtFloat(d.Head) + " ms (" + fmtSigned(d.Pct) + "%)"
}
