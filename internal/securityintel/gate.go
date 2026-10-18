package securityintel

import "fmt"

var bandRank = map[string]int{BandInformational: 1, BandLow: 2, BandMedium: 3, BandHigh: 4, BandCritical: 5}

// GateFailures are the findings that make a CI gate fail: not suppressed, in a band at or above failOn.
// failOn is a band name (critical, high, medium, low, informational) or "none" to never fail.
func GateFailures(report ScanReport, failOn string) ([]Finding, error) {
	if failOn == "none" {
		return nil, nil
	}
	threshold, ok := bandRank[failOn]
	if !ok {
		return nil, fmt.Errorf("unknown severity %q: use critical, high, medium, low, informational or none", failOn)
	}
	var failures []Finding
	for _, finding := range report.Findings {
		if finding.Ignored == nil && bandRank[finding.Risk.Band] >= threshold {
			failures = append(failures, finding)
		}
	}
	return failures, nil
}
