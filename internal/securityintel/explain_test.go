package securityintel

import "testing"

func TestExplainUnanalyzedGivesAReasonForEveryUnknownFinding(t *testing.T) {
	cases := []struct {
		name                string
		hasAnalyzer, failed bool
		allowProcesses      bool
		wantWhy             string
	}{
		{"no analyzer", false, false, true, "No reachability analysis for this ecosystem yet"},
		{"failed", true, true, true, "The analysis failed: see the warning above"},
		{"deep off", true, false, false, "Deep analysis is off"},
		{"inconclusive", true, false, true, "The analysis did not reach a conclusion"},
	}
	for _, c := range cases {
		findings := []Finding{{Reachability: ReachabilityUnknown}, {Reachability: ReachabilityCalled}, {Reachability: ReachabilityUnknown, Evidence: Evidence{Why: "from adapter"}}}
		explainUnanalyzed(findings, c.hasAnalyzer, c.failed, c.allowProcesses)
		if findings[0].Evidence.Why != c.wantWhy {
			t.Errorf("%s: got %q, want %q", c.name, findings[0].Evidence.Why, c.wantWhy)
		}
		if findings[1].Evidence.Why != "" || findings[2].Evidence.Why != "from adapter" {
			t.Errorf("%s: analyzed findings and adapter reasons must stay untouched: %+v", c.name, findings)
		}
	}
}
