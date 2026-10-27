package adomniacli

import (
	"encoding/json/v2"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"github.com/Andrea-Cavallo/adOmnia/internal/collectionfs"
	"github.com/Andrea-Cavallo/adOmnia/internal/collectionresolve"
	"github.com/Andrea-Cavallo/adOmnia/internal/jsonutil"
)

func callMCPTool(t *testing.T, defaultFolder, name string, args map[string]any) (string, bool) {
	t.Helper()
	arguments, err := jsonutil.Marshal(args)
	if err != nil {
		t.Fatal(err)
	}
	line := `{"jsonrpc":"2.0","id":1,"method":"tools/call","params":{"name":` + strconvQuote(name) + `,"arguments":` + string(arguments) + `}}`
	return toolText(t, rpc(t, defaultFolder, line))
}

func strconvQuote(value string) string {
	encoded, _ := jsonutil.Marshal(value)
	return string(encoded)
}

func writeMCPProject(t *testing.T) string {
	t.Helper()
	root := t.TempDir()
	mainGo := `package main
import "net/http"
func routes(mux *http.ServeMux) {
	mux.HandleFunc("GET /users/{id}", getUser)
	mux.HandleFunc("POST /users", createUser)
}
`
	if err := os.WriteFile(filepath.Join(root, "main.go"), []byte(mainGo), 0o644); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(root, ".env"), []byte("API_TOKEN=do-not-expose\n"), 0o644); err != nil {
		t.Fatal(err)
	}
	return root
}

func TestMCPProjectListRoutes(t *testing.T) {
	project := writeMCPProject(t)
	text, isErr := callMCPTool(t, "", "project_list_routes", map[string]any{"project": project})
	if isErr {
		t.Fatalf("project_list_routes: %s", text)
	}
	for _, want := range []string{`"method": "GET"`, `"path": "/users/{id}"`, `"method": "POST"`, `"file": "main.go"`} {
		if !strings.Contains(text, want) {
			t.Errorf("route scan missing %s: %s", want, text)
		}
	}
	if strings.Contains(text, "do-not-expose") || strings.Contains(text, "API_TOKEN") {
		t.Fatalf("route scan exposed dotenv data: %s", text)
	}
	if _, isErr := callMCPTool(t, "", "project_list_routes", map[string]any{}); !isErr {
		t.Fatal("missing project must be a tool error")
	}
}

func TestMCPCollectionFromCodeIsRepeatableAndPreservesCustomRequests(t *testing.T) {
	project := writeMCPProject(t)
	root := filepath.Join(t.TempDir(), "generated")
	args := map[string]any{"project": project, "collection": root, "name": "Users API", "baseUrl": "{{baseUrl}}"}
	text, isErr := callMCPTool(t, "", "collection_create_from_code", args)
	if isErr || !strings.Contains(text, `"requestCount": 2`) {
		t.Fatalf("create from code = %s, error = %v", text, isErr)
	}

	assertGenerated := func(wantCount int) collectionfs.Collection {
		t.Helper()
		collection, err := collectionfs.ImportCollection(root)
		if err != nil {
			t.Fatal(err)
		}
		if got := collectionfs.CountRequests(collection.Children); got != wantCount {
			t.Fatalf("request count = %d, want %d", got, wantCount)
		}
		return collection
	}
	generated := assertGenerated(2)
	resolved, err := collectionresolve.ResolveRequests(generated)
	if err != nil {
		t.Fatal(err)
	}
	ids := map[string]bool{}
	for _, request := range resolved {
		ids[request.Request.ID] = true
		if !strings.HasPrefix(request.Request.URL, "{{baseUrl}}/users") {
			t.Errorf("generated URL = %q", request.Request.URL)
		}
	}

	if _, isErr := callMCPTool(t, root, "collection_upsert_request", map[string]any{
		"folder":  "Custom",
		"request": map[string]any{"id": "custom-request", "name": "Custom", "type": "request", "method": "DELETE", "url": "{{baseUrl}}/custom"},
	}); isErr {
		t.Fatal("custom upsert failed")
	}
	if err := os.MkdirAll(filepath.Join(root, "environments"), 0o755); err != nil {
		t.Fatal(err)
	}
	environment := `{"id":"env-dev","name":"dev","variables":[{"key":"baseUrl","value":"http://localhost:8080","enabled":true}]}`
	if err := os.WriteFile(filepath.Join(root, "environments", "dev.json"), []byte(environment), 0o644); err != nil {
		t.Fatal(err)
	}
	if _, isErr := callMCPTool(t, "", "collection_create_from_code", args); isErr {
		t.Fatal("repeated code sync failed")
	}
	assertGenerated(3)
	list, isErr := callMCPTool(t, root, "collection_list_requests", map[string]any{})
	if isErr || !strings.Contains(list, "custom-request") {
		t.Fatalf("custom request was not preserved: %s", list)
	}
	for id := range ids {
		if !strings.Contains(list, id) {
			t.Errorf("deterministic route id %s disappeared: %s", id, list)
		}
	}
	environments, isErr := callMCPTool(t, root, "collection_list_environments", map[string]any{})
	if isErr || !strings.Contains(environments, "http://localhost:8080") {
		t.Fatalf("environment was not preserved: %s", environments)
	}

	mainGo := `package main
import "net/http"
func routes(mux *http.ServeMux) { mux.HandleFunc("GET /users/{id}", getUser) }
`
	if err := os.WriteFile(filepath.Join(project, "main.go"), []byte(mainGo), 0o644); err != nil {
		t.Fatal(err)
	}
	if _, isErr := callMCPTool(t, "", "collection_create_from_code", args); isErr {
		t.Fatal("sync after route removal failed")
	}
	assertGenerated(2)
	list, _ = callMCPTool(t, root, "collection_list_requests", map[string]any{})
	if strings.Contains(list, "POST") || !strings.Contains(list, "custom-request") {
		t.Fatalf("stale generated route or missing custom request: %s", list)
	}
}

func TestMCPCollectionWriteUpdateDeleteAndValidation(t *testing.T) {
	root := exportTestCollection(t, "{{baseUrl}}", "200")
	request := map[string]any{"id": "req-new", "name": "Create user", "type": "request", "method": "post", "url": "{{baseUrl}}/users"}
	text, isErr := callMCPTool(t, root, "collection_upsert_request", map[string]any{"folder": "Admin/Users", "request": request})
	if isErr || !strings.Contains(text, `"created": true`) {
		t.Fatalf("create request = %s, error = %v", text, isErr)
	}
	list, _ := callMCPTool(t, root, "collection_list_requests", map[string]any{})
	if !strings.Contains(list, "Admin/Users") || !strings.Contains(list, `"method": "POST"`) {
		t.Fatalf("created request not listed correctly: %s", list)
	}

	request["method"] = "PUT"
	request["name"] = "Replace user"
	text, isErr = callMCPTool(t, root, "collection_upsert_request", map[string]any{"request": request})
	if isErr || !strings.Contains(text, `"created": false`) {
		t.Fatalf("update request = %s, error = %v", text, isErr)
	}
	list, _ = callMCPTool(t, root, "collection_list_requests", map[string]any{})
	if strings.Count(list, "req-new") != 1 {
		t.Fatalf("update duplicated request: %s", list)
	}

	if text, isErr = callMCPTool(t, root, "collection_delete_request", map[string]any{"id": "req-new"}); isErr || !strings.Contains(text, `"deleted": true`) {
		t.Fatalf("delete request = %s, error = %v", text, isErr)
	}
	if _, isErr := callMCPTool(t, root, "collection_get_request", map[string]any{"id": "req-new"}); !isErr {
		t.Fatal("deleted request is still readable")
	}

	invalid := []map[string]any{
		{"request": map[string]any{"name": "No id", "method": "GET", "url": "/ok"}},
		{"request": map[string]any{"id": "bad-method", "method": "TELEPORT", "url": "/ok"}},
		{"request": map[string]any{"id": "bad-url", "method": "GET", "url": "file:///etc/passwd"}},
		{"request": map[string]any{"id": "other", "method": "GET", "url": "{{baseUrl}}/probe"}},
	}
	for _, args := range invalid {
		if _, isErr := callMCPTool(t, root, "collection_upsert_request", args); !isErr {
			t.Errorf("invalid request accepted: %v", args)
		}
	}
	if _, isErr := callMCPTool(t, root, "collection_delete_request", map[string]any{"id": "missing"}); !isErr {
		t.Fatal("deleting a missing request must fail")
	}
}

func TestMCPWriteRejectsTraversalAndInvalidProject(t *testing.T) {
	root := exportTestCollection(t, "{{baseUrl}}", "200")
	_, isErr := callMCPTool(t, root, "collection_upsert_request", map[string]any{
		"folder":  "../outside",
		"request": map[string]any{"id": "req-new", "method": "GET", "url": "/ok"},
	})
	if !isErr {
		t.Fatal("folder traversal must fail")
	}
	missing := filepath.Join(t.TempDir(), "missing")
	if _, isErr := callMCPTool(t, "", "project_list_routes", map[string]any{"project": missing}); !isErr {
		t.Fatal("missing project must fail")
	}
}

func TestMCPCollectionFromCodeResponseIsJSON(t *testing.T) {
	project := writeMCPProject(t)
	root := filepath.Join(t.TempDir(), "generated")
	text, isErr := callMCPTool(t, "", "collection_create_from_code", map[string]any{"project": project, "collection": root})
	if isErr {
		t.Fatal(text)
	}
	var response map[string]any
	if err := json.Unmarshal([]byte(text), &response); err != nil {
		t.Fatalf("response is not JSON: %v", err)
	}
}
