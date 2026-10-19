package securityintel

import (
	"strings"
	"testing"
)

func TestVEXStatesAreConservative(t *testing.T) {
	component := Component{Ecosystem: EcosystemMaven, Name: "g:a", Version: "1"}
	report := ScanReport{Findings: []Finding{
		{Advisory: Advisory{ID: "CVE-1"}, Component: component, Reachability: ReachabilityCalled, Remediation: Remediation{FixedVersion: "2"}},
		{Advisory: Advisory{ID: "CVE-2"}, Component: component, Reachability: ReachabilityNotReachable},
		{Advisory: Advisory{ID: "CVE-3"}, Component: component, Reachability: ReachabilityUnknown, Ignored: &Suppression{Reason: "only used in tests"}},
	}}
	bom := VEXOf(report)
	if len(bom.Vulnerabilities) != 3 {
		t.Fatalf("one vulnerability per finding: %d", len(bom.Vulnerabilities))
	}
	states := []string{}
	for _, vulnerability := range bom.Vulnerabilities {
		states = append(states, vulnerability.Analysis.State)
	}
	if strings.Join(states, ",") != "exploitable,in_triage,not_affected" {
		t.Fatalf("not reachable must stay in triage, only a written suppression is not_affected: %v", states)
	}
	if bom.Vulnerabilities[0].Analysis.Response[0] != "update" || bom.Vulnerabilities[1].Analysis.Response[0] != "can_not_fix" {
		t.Fatalf("responses: %+v %+v", bom.Vulnerabilities[0].Analysis, bom.Vulnerabilities[1].Analysis)
	}
	if !strings.Contains(bom.Vulnerabilities[2].Analysis.Detail, "only used in tests") {
		t.Fatal("the suppression reason must travel with the VEX statement")
	}
	if _, err := Export(report, FormatVEX); err != nil {
		t.Fatal(err)
	}
}

func TestMarkdownReportListsFindingsWithFix(t *testing.T) {
	report := ScanReport{Workspace: "C:/p", ScannedAt: "2026-10-19", Summary: Summary{Findings: 1, High: 1}, Findings: []Finding{{
		ID: "x", Advisory: Advisory{ID: "GHSA-1", Summary: "RCE in lib"}, Component: Component{Name: "g:a", Version: "1.0", Direct: true},
		Risk: Risk{Band: "high"}, Reachability: ReachabilityCalled, Remediation: Remediation{FixedVersion: "1.2"},
	}}}
	markdown := MarkdownReport(report)
	for _, want := range []string{"# Dependency security report", "| high | GHSA-1 | g:a 1.0 |", "### GHSA-1 — RCE in lib", "upgrade to 1.2"} {
		if !strings.Contains(markdown, want) {
			t.Errorf("missing %q in:\n%s", want, markdown)
		}
	}
	if out, err := Export(report, FormatMarkdown); err != nil || len(out) == 0 || FileExtension(FormatMarkdown) != ".md" {
		t.Fatalf("export: %v", err)
	}
	if !strings.Contains(MarkdownReport(ScanReport{}), "No known vulnerabilities") {
		t.Fatal("empty report")
	}
}
