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
