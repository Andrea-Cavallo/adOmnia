package securityintel

import "fmt"

// cycloneAnalysis è la sezione VEX di una vulnerabilità CycloneDX: lo stato di sfruttabilità nel prodotto.
type cycloneAnalysis struct {
	State    string   `json:"state"`
	Response []string `json:"response,omitempty"`
	Detail   string   `json:"detail,omitempty"`
}

// VEXOf produce il documento VEX (CycloneDX 1.5) del report: gli stessi componenti e le stesse vulnerabilità
// dell'SBOM, ciascuna con il suo stato.
//
// Lo stato è prudente: `not_affected` solo per una soppressione scritta dall'utente (con il suo motivo),
// `exploitable` solo se il codice del progetto chiama il simbolo vulnerabile, tutto il resto `in_triage`.
// "Non raggiungibile" è un risultato dell'analisi statica, non una garanzia (riflessione, class loading,
// framework): non basta per dichiarare un prodotto non affetto.
func VEXOf(report ScanReport) CycloneDXBOM {
	bom := CycloneDXOf(report)
	for index, finding := range report.Findings {
		if index >= len(bom.Vulnerabilities) {
			break
		}
		bom.Vulnerabilities[index].Analysis = analysisOf(finding)
	}
	return bom
}

func analysisOf(finding Finding) *cycloneAnalysis {
	analysis := &cycloneAnalysis{State: "in_triage"}
	switch {
	case finding.Ignored != nil:
		analysis.State = "not_affected"
		analysis.Detail = "Suppressed by the project: " + finding.Ignored.Reason
		if finding.Ignored.ExpiresAt != "" {
			analysis.Detail += " (until " + finding.Ignored.ExpiresAt + ")"
		}
	case finding.Reachability == ReachabilityCalled:
		analysis.State = "exploitable"
		analysis.Detail = "The project's code calls the vulnerable symbol."
	default:
		analysis.Detail = fmt.Sprintf("Reachability: %s.", finding.Reachability.Label())
		if finding.Evidence.Note != "" {
			analysis.Detail += " " + finding.Evidence.Note
		}
	}
	if finding.Remediation.FixedVersion != "" {
		analysis.Response = []string{"update"}
	} else {
		analysis.Response = []string{"can_not_fix"}
	}
	return analysis
}
