package main

import (
	"adomnia/internal/oaslint"
	"encoding/json"
	"fmt"
	"strings"
)

type OASLint struct{}

func NewOASLint() *OASLint { return &OASLint{} }

func (o *OASLint) Lint(specText string, rulesetJSON string) (string, error) {
	if strings.TrimSpace(specText) == "" {
		return "", fmt.Errorf("OpenAPI document required")
	}
	ruleset := oaslint.Ruleset{}
	if strings.TrimSpace(rulesetJSON) != "" {
		parsed, err := oaslint.RulesetFromJSON([]byte(rulesetJSON))
		if err != nil {
			return "", err
		}
		ruleset = parsed
	}
	var findings []oaslint.Finding
	var err error
	if strings.HasPrefix(strings.TrimSpace(specText), "{") {
		findings, err = oaslint.LintJSON([]byte(specText), oaslint.Options{Ruleset: ruleset})
	} else {
		findings, err = oaslint.LintYAML([]byte(specText), oaslint.Options{Ruleset: ruleset})
	}
	if err != nil {
		return "", err
	}
	report, err := json.Marshal(struct {
		Findings []oaslint.Finding `json:"findings"`
	}{Findings: findings})
	if err != nil {
		return "", fmt.Errorf("marshal lint report: %w", err)
	}
	return string(report), nil
}
