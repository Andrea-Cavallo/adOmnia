package main

import (
	"encoding/json"
	"testing"
)

func TestOASLintBindingAppliesLocalRuleset(t *testing.T) {
	spec := `{"openapi":"3.1.0","info":{"title":"Test","version":"1"},"paths":{"/health":{"get":{"operationId":"health","tags":["System"],"responses":{"400":{"description":"bad"}}}}}}`
	raw, err := NewOASLint().Lint(spec, `{"rules":{"response-2xx-required":"warn","operation-summary-required":"off","response-error-required":"off"}}`)
	if err != nil {
		t.Fatalf("Lint returned error: %v", err)
	}
	var report struct {
		Findings []struct {
			RuleID   string `json:"ruleId"`
			Severity string `json:"severity"`
		} `json:"findings"`
	}
	if err := json.Unmarshal([]byte(raw), &report); err != nil {
		t.Fatalf("decode report: %v", err)
	}
	if len(report.Findings) != 1 || report.Findings[0].RuleID != "response-2xx-required" || report.Findings[0].Severity != "warn" {
		t.Fatalf("unexpected findings: %#v", report.Findings)
	}
}
