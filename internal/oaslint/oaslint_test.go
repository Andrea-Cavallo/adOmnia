package oaslint

import (
	"encoding/json"
	"strings"
	"testing"
)

func TestValidSpecPassesWithoutFindings(t *testing.T) {
	findings := LintSpec(validSpec(), Options{})
	if len(findings) != 0 {
		t.Fatalf("expected no findings, got %#v", findings)
	}
	if HasErrors(findings) {
		t.Fatalf("expected no blocking errors")
	}
}

func TestViolatingSpecProducesStableFindings(t *testing.T) {
	raw := []byte(`{
	  "openapi": "3.1.0",
	  "info": {"title": "Broken", "version": "1.0.0"},
	  "components": {
	    "securitySchemes": {
	      "bearer": {"type": "http", "scheme": "bearer"}
	    }
	  },
	  "paths": {
	    "/Users/{id}": {
	      "get": {
	        "operationId": "readThing",
	        "responses": {
	          "200": {
	            "description": "ok",
	            "content": {
	              "application/json": {}
	            }
	          }
	        }
	      }
	    },
	    "/users": {
	      "post": {
	        "operationId": "readThing",
	        "summary": "Create user",
	        "tags": ["Users"],
	        "security": [{"bearer": []}],
	        "responses": {
	          "400": {"description": "bad request"}
	        }
	      }
	    }
	  }
	}`)
	findings, err := LintJSON(raw, Options{})
	if err != nil {
		t.Fatalf("LintJSON returned error: %v", err)
	}
	got := ruleIDs(findings)
	want := []string{
		"path-naming-coherent",
		"json-response-schema-required",
		"operation-security-required",
		"operation-summary-required",
		"operation-tags-required",
		"response-error-required",
		"operation-id-unique",
		"response-2xx-required",
	}
	if strings.Join(got, ",") != strings.Join(want, ",") {
		t.Fatalf("unexpected rule order\nwant: %v\n got: %v\nfindings: %#v", want, got, findings)
	}
	if !HasErrors(findings) {
		t.Fatalf("expected blocking errors")
	}
	text := FormatText(findings)
	if !strings.Contains(text, "[error] operation-id-unique POST /users") {
		t.Fatalf("text reporter should include severity, rule, and target, got:\n%s", text)
	}
	jsonReport, err := FormatJSON(findings)
	if err != nil {
		t.Fatalf("FormatJSON returned error: %v", err)
	}
	var report struct {
		Findings  []Finding `json:"findings"`
		HasErrors bool      `json:"hasErrors"`
	}
	if err := json.Unmarshal(jsonReport, &report); err != nil {
		t.Fatalf("json reporter returned invalid JSON: %v", err)
	}
	if !report.HasErrors || len(report.Findings) != len(findings) {
		t.Fatalf("unexpected JSON report: %s", string(jsonReport))
	}
}

func TestRulesetOverridesSeverityAndDisablesRules(t *testing.T) {
	ruleset, err := RulesetFromJSON([]byte(`{
	  "rules": {
	    "operation-summary-required": "off",
	    "response-2xx-required": {"severity": "warn"},
	    "response-error-required": "info"
	  }
	}`))
	if err != nil {
		t.Fatalf("RulesetFromJSON returned error: %v", err)
	}
	findings := LintSpec(map[string]any{
		"openapi": "3.1.0",
		"info":    map[string]any{"title": "Rules", "version": "1.0.0"},
		"paths": map[string]any{
			"/health": map[string]any{
				"get": map[string]any{
					"operationId": "health",
					"tags":        []any{"System"},
					"responses": map[string]any{
						"400": map[string]any{"description": "bad request"},
					},
				},
			},
		},
	}, Options{Ruleset: ruleset})

	if len(findings) != 1 {
		t.Fatalf("expected only response-2xx-required finding, got %#v", findings)
	}
	if findings[0].RuleID != "response-2xx-required" || findings[0].Severity != SeverityWarn {
		t.Fatalf("expected downgraded response-2xx-required warning, got %#v", findings[0])
	}
	if HasErrors(findings) {
		t.Fatalf("downgraded warning must not fail CLI exit later")
	}
}

func validSpec() map[string]any {
	return map[string]any{
		"openapi": "3.1.0",
		"info": map[string]any{
			"title":   "Valid",
			"version": "1.0.0",
		},
		"components": map[string]any{
			"securitySchemes": map[string]any{
				"bearer": map[string]any{"type": "http", "scheme": "bearer"},
			},
		},
		"security": []any{
			map[string]any{"bearer": []any{}},
		},
		"paths": map[string]any{
			"/users/{id}": map[string]any{
				"get": map[string]any{
					"operationId": "getUser",
					"summary":     "Get a user",
					"tags":        []any{"Users"},
					"responses": map[string]any{
						"200": map[string]any{
							"description": "ok",
							"content": map[string]any{
								"application/json": map[string]any{
									"schema": map[string]any{
										"type": "object",
									},
								},
							},
						},
						"404": map[string]any{"description": "not found"},
					},
				},
			},
		},
	}
}

func ruleIDs(findings []Finding) []string {
	out := make([]string, 0, len(findings))
	for _, item := range findings {
		out = append(out, item.RuleID)
	}
	return out
}
