package adomniacli

import (
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func TestMCPEnvironmentLifecyclePersistsSecretsAndSupportsMerge(t *testing.T) {
	root := exportTestCollection(t, "{{baseUrl}}", "200")
	environment := map[string]any{
		"name": "dev",
		"variables": []map[string]any{
			{"key": "baseUrl", "value": "http://localhost:8080", "enabled": true},
			{"key": "harmlessName", "value": "top-secret", "enabled": true, "secret": true},
		},
	}
	text, isErr := callMCPTool(t, root, "collection_upsert_environment", map[string]any{"environment": environment})
	if isErr || !strings.Contains(text, `"created": true`) || !strings.Contains(text, `"variableCount": 2`) {
		t.Fatalf("create environment = %s, error = %v", text, isErr)
	}
	list, isErr := callMCPTool(t, root, "collection_list_environments", map[string]any{})
	if isErr || !strings.Contains(list, "http://localhost:8080") || !strings.Contains(list, maskedValue) {
		t.Fatalf("environment list = %s, error = %v", list, isErr)
	}
	if strings.Contains(list, "top-secret") {
		t.Fatalf("secret-marked variable leaked: %s", list)
	}
	data, err := os.ReadFile(filepath.Join(root, "environments", "dev.json"))
	if err != nil || !strings.Contains(string(data), "top-secret") {
		t.Fatalf("secret was not persisted for local runs: %s, %v", data, err)
	}
	vars, _, err := loadRunVars(root, "dev", nil)
	if err != nil || vars["baseUrl"] != "http://localhost:8080" || vars["harmlessName"] != "top-secret" {
		t.Fatalf("saved environment is not usable by collection_run: %#v, %v", vars, err)
	}

	text, isErr = callMCPTool(t, root, "collection_upsert_environment", map[string]any{
		"merge": true,
		"environment": map[string]any{
			"name":      "dev",
			"variables": []map[string]any{{"key": "baseUrl", "value": "http://127.0.0.1:9000", "enabled": true}},
		},
	})
	if isErr || !strings.Contains(text, `"created": false`) {
		t.Fatalf("merge environment = %s, error = %v", text, isErr)
	}
	vars, _, err = loadRunVars(root, "dev", nil)
	if err != nil || vars["baseUrl"] != "http://127.0.0.1:9000" || vars["harmlessName"] != "top-secret" {
		t.Fatalf("merge lost existing variables: %#v, %v", vars, err)
	}

	// A later request write must not strip secret values from the environment.
	if _, isErr := callMCPTool(t, root, "collection_upsert_request", map[string]any{
		"request": map[string]any{"id": "after-env", "method": "GET", "url": "{{baseUrl}}/after"},
	}); isErr {
		t.Fatal("request write after environment update failed")
	}
	vars, _, err = loadRunVars(root, "dev", nil)
	if err != nil || vars["harmlessName"] != "top-secret" {
		t.Fatalf("request write stripped environment secrets: %#v, %v", vars, err)
	}

	if text, isErr = callMCPTool(t, root, "collection_delete_environment", map[string]any{"name": "dev"}); isErr || !strings.Contains(text, `"deleted": true`) {
		t.Fatalf("delete environment = %s, error = %v", text, isErr)
	}
	if _, err := os.Stat(filepath.Join(root, "environments", "dev.json")); !os.IsNotExist(err) {
		t.Fatalf("environment file still exists: %v", err)
	}
	if _, isErr := callMCPTool(t, root, "collection_delete_environment", map[string]any{"name": "dev"}); !isErr {
		t.Fatal("deleting a missing environment must fail")
	}
}

func TestMCPEnvironmentValidation(t *testing.T) {
	root := exportTestCollection(t, "{{baseUrl}}", "200")
	invalid := []map[string]any{
		{"environment": map[string]any{"variables": []map[string]any{}}},
		{"environment": map[string]any{"name": "../dev", "variables": []map[string]any{}}},
		{"environment": map[string]any{"name": "dev", "private": true, "variables": []map[string]any{}}},
		{"environment": map[string]any{"name": "dev", "variables": []map[string]any{{"key": "", "value": "x"}}}},
		{"environment": map[string]any{"name": "dev", "variables": []map[string]any{{"key": "same"}, {"key": "same"}}}},
	}
	for _, args := range invalid {
		if _, isErr := callMCPTool(t, root, "collection_upsert_environment", args); !isErr {
			t.Errorf("invalid environment accepted: %v", args)
		}
	}
	if _, isErr := callMCPTool(t, root, "collection_upsert_environment", map[string]any{}); !isErr {
		t.Fatal("missing environment must fail")
	}
	if _, isErr := callMCPTool(t, root, "collection_delete_environment", map[string]any{}); !isErr {
		t.Fatal("missing environment name must fail")
	}
}
