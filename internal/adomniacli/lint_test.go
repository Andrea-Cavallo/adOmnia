package adomniacli

import (
	"bytes"
	"encoding/json"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"adomnia/internal/collectionfs"
)

func TestLintPassesValidYAMLSpec(t *testing.T) {
	specPath := filepath.Join(t.TempDir(), "openapi.yaml")
	if err := os.WriteFile(specPath, []byte(validOpenAPIYAML()), 0644); err != nil {
		t.Fatalf("write spec: %v", err)
	}
	var stdout, stderr bytes.Buffer
	code := Run([]string{"lint", specPath}, &stdout, &stderr)
	if code != 0 {
		t.Fatalf("Lint code = %d, stdout = %s, stderr = %s", code, stdout.String(), stderr.String())
	}
	if !strings.Contains(stdout.String(), "OpenAPI lint passed") {
		t.Fatalf("stdout missing pass message:\n%s", stdout.String())
	}
}

func TestLintFailsOnBlockingErrorsAndReportsJSON(t *testing.T) {
	specPath := filepath.Join(t.TempDir(), "openapi.json")
	if err := os.WriteFile(specPath, []byte(`{
	  "openapi": "3.1.0",
	  "info": {"title": "Broken", "version": "1.0.0"},
	  "paths": {
	    "/users": {
	      "get": {
	        "operationId": "listUsers",
	        "summary": "List users",
	        "tags": ["Users"],
	        "responses": {
	          "400": {"description": "bad request"}
	        }
	      }
	    }
	  }
	}`), 0644); err != nil {
		t.Fatalf("write spec: %v", err)
	}
	var stdout, stderr bytes.Buffer
	code := Run([]string{"lint", specPath, "--reporter", "json"}, &stdout, &stderr)
	if code != 1 {
		t.Fatalf("Lint code = %d, stdout = %s, stderr = %s", code, stdout.String(), stderr.String())
	}
	var report struct {
		HasErrors bool `json:"hasErrors"`
		Findings  []struct {
			RuleID   string `json:"ruleId"`
			Severity string `json:"severity"`
		} `json:"findings"`
	}
	if err := json.Unmarshal(stdout.Bytes(), &report); err != nil {
		t.Fatalf("decode report: %v\n%s", err, stdout.String())
	}
	if !report.HasErrors || report.Findings[0].RuleID != "response-2xx-required" || report.Findings[0].Severity != "error" {
		t.Fatalf("unexpected report: %#v", report)
	}
}

func TestLintFailOnWarn(t *testing.T) {
	specPath := filepath.Join(t.TempDir(), "openapi.json")
	if err := os.WriteFile(specPath, []byte(warnOnlyOpenAPIJSON()), 0644); err != nil {
		t.Fatalf("write spec: %v", err)
	}
	var stdout, stderr bytes.Buffer
	code := Run([]string{"lint", specPath}, &stdout, &stderr)
	if code != 0 {
		t.Fatalf("warnings should not fail by default: code = %d, stdout = %s, stderr = %s", code, stdout.String(), stderr.String())
	}
	stdout.Reset()
	stderr.Reset()
	code = Run([]string{"lint", specPath, "--fail-on-warn"}, &stdout, &stderr)
	if code != 1 {
		t.Fatalf("fail-on-warn should fail: code = %d, stdout = %s, stderr = %s", code, stdout.String(), stderr.String())
	}
}

func TestLintUsesLocalRulesetOverrides(t *testing.T) {
	dir := t.TempDir()
	specPath := filepath.Join(dir, "openapi.json")
	rulesetPath := filepath.Join(dir, "adomnia.oaslint.json")
	if err := os.WriteFile(specPath, []byte(`{
	  "openapi": "3.1.0",
	  "info": {"title": "Rules", "version": "1.0.0"},
	  "paths": {
	    "/users": {
	      "get": {
	        "operationId": "listUsers",
	        "summary": "List users",
	        "tags": ["Users"],
	        "responses": {
	          "400": {"description": "bad request"}
	        }
	      }
	    }
	  }
	}`), 0644); err != nil {
		t.Fatalf("write spec: %v", err)
	}
	if err := os.WriteFile(rulesetPath, []byte(`{"rules":{"response-2xx-required":"warn"}}`), 0644); err != nil {
		t.Fatalf("write ruleset: %v", err)
	}
	var stdout, stderr bytes.Buffer
	code := Run([]string{"lint", specPath, "--ruleset", rulesetPath}, &stdout, &stderr)
	if code != 0 {
		t.Fatalf("downgraded errors should not fail: code = %d, stdout = %s, stderr = %s", code, stdout.String(), stderr.String())
	}
	if !strings.Contains(stdout.String(), "[warn] response-2xx-required") {
		t.Fatalf("stdout missing downgraded warning:\n%s", stdout.String())
	}
}

func TestLintReadsCollectionFolderOpenAPISpec(t *testing.T) {
	root := filepath.Join(t.TempDir(), "collection")
	collection := collectionfs.Collection{
		ID:          "col-lint",
		Name:        "Lint Collection",
		OpenAPISpec: validOpenAPIYAML(),
		Children:    []collectionfs.Node{},
	}
	if err := collectionfs.ExportCollection(root, collection, collectionfs.ExportOptions{}); err != nil {
		t.Fatalf("export collection: %v", err)
	}
	outPath := filepath.Join(t.TempDir(), "lint.json")
	var stdout, stderr bytes.Buffer
	code := Run([]string{"lint", root, "--reporter", "json", "--out", outPath}, &stdout, &stderr)
	if code != 0 {
		t.Fatalf("Lint code = %d, stdout = %s, stderr = %s", code, stdout.String(), stderr.String())
	}
	data, err := os.ReadFile(outPath)
	if err != nil {
		t.Fatalf("read lint report: %v", err)
	}
	if !strings.Contains(string(data), `"hasErrors": false`) {
		t.Fatalf("unexpected collection lint report:\n%s", string(data))
	}
}

func validOpenAPIYAML() string {
	return `openapi: 3.1.0
info:
  title: Valid
  version: 1.0.0
security:
  - bearer: []
components:
  securitySchemes:
    bearer:
      type: http
      scheme: bearer
paths:
  /users/{id}:
    get:
      operationId: getUser
      summary: Get a user
      tags:
        - Users
      responses:
        "200":
          description: ok
          content:
            application/json:
              schema:
                type: object
        "404":
          description: not found
`
}

func warnOnlyOpenAPIJSON() string {
	return `{
	  "openapi": "3.1.0",
	  "info": {"title": "Warn", "version": "1.0.0"},
	  "paths": {
	    "/health": {
	      "get": {
	        "operationId": "health",
	        "summary": "Health",
	        "tags": ["System"],
	        "responses": {
	          "200": {
	            "description": "ok",
	            "content": {
	              "application/json": {
	                "schema": {"type": "object"}
	              }
	            }
	          }
	        }
	      }
	    }
	  }
	}`
}
