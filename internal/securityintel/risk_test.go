package securityintel

import "testing"

// Il risk model deve produrre priorità spiegabili: ogni asserzione qui documenta una
// regola che l'utente leggerà fra i "reasons" del finding.
func TestAssessRiskKEVWinsOverEverything(t *testing.T) {
	severity := Severity{CVSS31Score: 3.1, BaseSeverity: "LOW", KEV: true}
	risk := AssessRisk(severity, ReachabilityRequired, ExposureTest, false, true)
	if risk.Priority != "P0" {
		t.Errorf("KEV finding priority = %s, want P0: it is exploited in the wild", risk.Priority)
	}
	if !risk.Signals.KEV {
		t.Error("KEV signal lost")
	}
	if len(risk.Reasons) == 0 {
		t.Error("a priority without a stated reason is not reviewable")
	}
}

func TestAssessRiskEPSSRaisesSeverity(t *testing.T) {
	lowEPSS := AssessRisk(Severity{CVSS31Score: 7.5, BaseSeverity: "HIGH", EPSS: 0.001}, ReachabilityCalled, ExposureRuntime, true, true)
	highEPSS := AssessRisk(Severity{CVSS31Score: 7.5, BaseSeverity: "HIGH", EPSS: 0.42}, ReachabilityCalled, ExposureRuntime, true, true)
	if highEPSS.Priority == lowEPSS.Priority {
		t.Errorf("EPSS 42%% did not raise priority: both are %s", lowEPSS.Priority)
	}
	if highEPSS.Priority != "P0" {
		t.Errorf("high EPSS priority = %s, want P0", highEPSS.Priority)
	}
}

// L'EPSS è una probabilità, non una gravità: deve comparire nei signals separata dal CVSS.
func TestAssessRiskKeepsSignalsSeparate(t *testing.T) {
	risk := AssessRisk(Severity{CVSS31Score: 6.8, BaseSeverity: "MEDIUM", EPSS: 0.71}, ReachabilityUnknown, ExposureRuntime, true, true)
	if risk.Signals.CVSSScore != 6.8 {
		t.Errorf("CVSS signal = %v, want 6.8", risk.Signals.CVSSScore)
	}
	if risk.Signals.EPSS != 0.71 {
		t.Errorf("EPSS signal = %v, want 0.71", risk.Signals.EPSS)
	}
	if risk.Signals.CVSSScore == risk.Signals.EPSS {
		t.Error("CVSS and EPSS collapsed into one number: they measure different things")
	}
}

func TestAssessRiskReachabilityRaisesPriority(t *testing.T) {
	severity := Severity{CVSS31Score: 8.0, BaseSeverity: "HIGH"}
	notAnalyzed := AssessRisk(severity, ReachabilityUnknown, ExposureRuntime, true, true)
	called := AssessRisk(severity, ReachabilityCalled, ExposureRuntime, true, true)
	if called.Priority == notAnalyzed.Priority {
		t.Errorf("reachability did not raise priority: both %s", called.Priority)
	}
	if called.Priority != "P1" && called.Priority != "P0" {
		t.Errorf("reachable HIGH priority = %s, want P0 or P1", called.Priority)
	}
}

// "Non raggiungibile" e "non analizzato" non sono la stessa cosa, e nessuna delle due
// è una garanzia di sicurezza.
func TestAssessRiskUnknownIsNotSafe(t *testing.T) {
	severity := Severity{CVSS31Score: 9.5, BaseSeverity: "CRITICAL"}
	unknown := AssessRisk(severity, ReachabilityUnknown, ExposureRuntime, true, true)
	notReachable := AssessRisk(severity, ReachabilityNotReachable, ExposureRuntime, true, true)
	if unknown.Priority != notReachable.Priority {
		// Possono differire di un gradino, ma nessuno dei due può essere "non urgente".
		t.Logf("unknown=%s notReachable=%s", unknown.Priority, notReachable.Priority)
	}
	if unknown.Priority == "P3" || notReachable.Priority == "P3" {
		t.Errorf("a CRITICAL severity must never be P3: unknown=%s notReachable=%s", unknown.Priority, notReachable.Priority)
	}
}

// Una dipendenza di test non espone un servizio: la banda scende di un gradino.
func TestAssessRiskTestExposureDemotesOneBand(t *testing.T) {
	severity := Severity{CVSS31Score: 7.5, BaseSeverity: "HIGH"}
	runtime := AssessRisk(severity, ReachabilityCalled, ExposureRuntime, true, true)
	test := AssessRisk(severity, ReachabilityCalled, ExposureTest, true, true)
	if test.Band == runtime.Band {
		t.Errorf("test-only exposure did not demote: both %s", runtime.Band)
	}
	if test.Priority == "P0" {
		t.Errorf("test-only dependency priority = %s, want lower than P0", test.Priority)
	}
}

// La disponibilità della correzione non abbassa il rischio: cambia l'azione.
func TestAssessRiskFixAvailabilityChangesActionNotRisk(t *testing.T) {
	severity := Severity{CVSS31Score: 8.5, BaseSeverity: "HIGH"}
	withFix := AssessRisk(severity, ReachabilityCalled, ExposureRuntime, true, true)
	withoutFix := AssessRisk(severity, ReachabilityCalled, ExposureRuntime, true, false)
	if withFix.Priority != withoutFix.Priority {
		t.Errorf("no-fix finding was demoted (%s -> %s): the risk is the same, only the action differs", withFix.Priority, withoutFix.Priority)
	}
	found := false
	for _, reason := range withoutFix.Reasons {
		if reason == "No fixed version is published yet: plan a mitigation or a replacement, not an upgrade." {
			found = true
		}
	}
	if !found {
		t.Errorf("missing mitigation reason, got %v", withoutFix.Reasons)
	}
}

// Una dipendenza transitive richiede un intervento diverso, e lo dice.
func TestAssessRiskFlagsTransitiveDependencies(t *testing.T) {
	risk := AssessRisk(Severity{CVSS31Score: 8.5, BaseSeverity: "HIGH"}, ReachabilityCalled, ExposureRuntime, false, true)
	found := false
	for _, reason := range risk.Reasons {
		if reason == "Transitive dependency: the fix may need a change in the component that pulls it in." {
			found = true
		}
	}
	if !found {
		t.Errorf("missing transitive reason, got %v", risk.Reasons)
	}
}

// L'ordinamento deve rispettare le regole esplicite: un P0 non può finire dopo un P1.
func TestSortFindingsRespectsPriorityBands(t *testing.T) {
	findings := []Finding{
		{ID: "low", Risk: Risk{Band: BandLow, Score: 900}},
		{ID: "critical", Risk: Risk{Band: BandCritical, Score: 1}},
		{ID: "high", Risk: Risk{Band: BandHigh, Score: 500}},
	}
	SortFindings(findings)
	if findings[0].ID != "critical" || findings[1].ID != "high" || findings[2].ID != "low" {
		t.Errorf("order = %s,%s,%s want critical,high,low", findings[0].ID, findings[1].ID, findings[2].ID)
	}
}

func TestSummarizeCountsPerFindingNotPerAdvisory(t *testing.T) {
	advisory := Advisory{ID: "CVE-2027-0001", Severity: Severity{CVSS31Score: 9.8, BaseSeverity: "CRITICAL", KEV: true}}
	findings := []Finding{
		{Advisory: advisory, Component: Component{Name: "a"}, Risk: Risk{Band: BandCritical, Signals: RiskSignals{KEV: true, FixAvailable: true}}, Reachability: ReachabilityCalled},
		{Advisory: advisory, Component: Component{Name: "b"}, Risk: Risk{Band: BandCritical, Signals: RiskSignals{KEV: true}}, Reachability: ReachabilityCalled},
	}
	summary := Summarize(findings)
	if summary.Findings != 2 || summary.Critical != 2 {
		t.Errorf("summary = %+v, want 2 findings and 2 critical", summary)
	}
	if summary.ActivelyExploited != 2 {
		t.Errorf("actively exploited = %d, want 2", summary.ActivelyExploited)
	}
	if summary.Reachable != 2 {
		t.Errorf("reachable = %d, want 2", summary.Reachable)
	}
}

func TestSummarizeKeepsIgnoredFindingsOutOfActiveCount(t *testing.T) {
	suppressed := Suppression{Reason: "no runtime exposure in our deployment", ExpiresAt: "2099-01-01"}
	findings := []Finding{
		{Risk: Risk{Band: BandCritical}, Ignored: &suppressed},
		{Risk: Risk{Band: BandHigh}},
	}
	summary := Summarize(findings)
	if summary.Findings != 1 || summary.Ignored != 1 {
		t.Errorf("summary = %+v, want 1 active and 1 ignored", summary)
	}
}
