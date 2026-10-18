package securityintel

import "testing"

func TestGateFailures(t *testing.T) {
	report := ScanReport{Findings: []Finding{
		{ID: "a", Risk: Risk{Band: BandCritical}},
		{ID: "b", Risk: Risk{Band: BandMedium}},
		{ID: "c", Risk: Risk{Band: BandCritical}, Ignored: &Suppression{Reason: "false positive"}},
	}}
	if failures, _ := GateFailures(report, "high"); len(failures) != 1 || failures[0].ID != "a" {
		t.Fatalf("high: only the unsuppressed critical fails: %v", failures)
	}
	if failures, _ := GateFailures(report, "medium"); len(failures) != 2 {
		t.Fatalf("medium: %v", failures)
	}
	if failures, _ := GateFailures(report, "none"); len(failures) != 0 {
		t.Fatal("none never fails")
	}
	if _, err := GateFailures(report, "severe"); err == nil {
		t.Fatal("an unknown threshold must be an error, not a silent pass")
	}
}
