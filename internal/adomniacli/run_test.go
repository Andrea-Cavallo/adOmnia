package adomniacli

import (
	"bytes"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"adomnia/internal/collectionfs"
	"adomnia/internal/requestcontract"
)

func TestRunExecutesLiteralHTTPCollectionFolder(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Query().Get("mode") != "ok" {
			t.Fatalf("query mode = %q", r.URL.Query().Get("mode"))
		}
		if r.Header.Get("X-Run") != "cli" {
			t.Fatalf("X-Run header = %q", r.Header.Get("X-Run"))
		}
		w.WriteHeader(http.StatusCreated)
		_, _ = w.Write([]byte(`{"ok":true}`))
	}))
	defer server.Close()

	root := exportTestCollection(t, server.URL, "201")
	var stdout, stderr bytes.Buffer
	code := Run([]string{"run", root, "--reporter", "json"}, &stdout, &stderr)
	if code != 0 {
		t.Fatalf("Run code = %d, stderr = %s", code, stderr.String())
	}
	var summary RunSummary
	if err := json.Unmarshal(stdout.Bytes(), &summary); err != nil {
		t.Fatalf("decode summary: %v\n%s", err, stdout.String())
	}
	if summary.Passed != 1 || summary.Failed != 0 || summary.Skipped != 0 {
		t.Fatalf("summary = %#v", summary)
	}
	if summary.Results[0].Status != 201 || summary.Results[0].Outcome != "passed" {
		t.Fatalf("result = %#v", summary.Results[0])
	}
}

func TestRunReturnsFailureForAssertionMismatch(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		w.WriteHeader(http.StatusCreated)
	}))
	defer server.Close()

	root := exportTestCollection(t, server.URL, "200")
	var stdout, stderr bytes.Buffer
	code := Run([]string{"run", root, "--bail"}, &stdout, &stderr)
	if code != 1 {
		t.Fatalf("Run code = %d, stdout = %s, stderr = %s", code, stdout.String(), stderr.String())
	}
	if !strings.Contains(stdout.String(), "statusCode expected 200, got 201") {
		t.Fatalf("stdout missing assertion failure:\n%s", stdout.String())
	}
}

func TestRunSkipsUnresolvedVariables(t *testing.T) {
	root := exportTestCollection(t, "{{baseUrl}}", "200")
	var stdout, stderr bytes.Buffer
	code := Run([]string{"run", root}, &stdout, &stderr)
	if code != 0 {
		t.Fatalf("Run code = %d, stderr = %s", code, stderr.String())
	}
	if !strings.Contains(stdout.String(), "unresolved URL variables") || !strings.Contains(stdout.String(), "1 skipped") {
		t.Fatalf("stdout missing skip reason:\n%s", stdout.String())
	}
}

func TestRunResolvesEnvVarOverrides(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		w.WriteHeader(http.StatusCreated)
	}))
	defer server.Close()

	root := exportTestCollection(t, "{{baseUrl}}", "201")
	var stdout, stderr bytes.Buffer
	code := Run([]string{"run", root, "--env-var", "baseUrl=" + server.URL}, &stdout, &stderr)
	if code != 0 {
		t.Fatalf("Run code = %d, stdout = %s, stderr = %s", code, stdout.String(), stderr.String())
	}
	if !strings.Contains(stdout.String(), "1 passed") {
		t.Fatalf("stdout missing pass summary:\n%s", stdout.String())
	}
}

func TestRunLoadsDotEnvWithExpectedPrecedence(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if got := r.Header.Get("X-Source"); got != "cli" {
			t.Fatalf("X-Source = %q, want cli", got)
		}
		w.WriteHeader(http.StatusCreated)
	}))
	defer server.Close()

	root := exportTestCollection(t, "{{baseUrl}}", "201")
	requestPath := filepath.Join(root, "folders", "001-cli-probe.request.json")
	data, err := os.ReadFile(requestPath)
	if err != nil {
		t.Fatalf("read request: %v", err)
	}
	var request map[string]any
	if err := json.Unmarshal(data, &request); err != nil {
		t.Fatalf("decode request: %v", err)
	}
	request["headers"] = []map[string]any{{"id": "source", "key": "X-Source", "value": "{{source}}", "enabled": true}}
	data, _ = json.MarshalIndent(request, "", "  ")
	if err := os.WriteFile(requestPath, append(data, '\n'), 0644); err != nil {
		t.Fatalf("write request: %v", err)
	}
	if err := os.WriteFile(filepath.Join(root, ".env"), []byte("baseUrl='"+server.URL+"'\nsource=dotenv\n"), 0644); err != nil {
		t.Fatalf("write .env: %v", err)
	}
	if err := os.MkdirAll(filepath.Join(root, "environments"), 0755); err != nil {
		t.Fatalf("create environments: %v", err)
	}
	environment := `{"variables":[{"key":"source","value":"environment","enabled":true}]}`
	if err := os.WriteFile(filepath.Join(root, "environments", "ci.json"), []byte(environment), 0644); err != nil {
		t.Fatalf("write environment: %v", err)
	}

	var stdout, stderr bytes.Buffer
	code := Run([]string{"run", root, "--env", "ci", "--env-var", "source=cli", "--reporter", "json"}, &stdout, &stderr)
	if code != 0 {
		t.Fatalf("Run code = %d, stdout = %s, stderr = %s", code, stdout.String(), stderr.String())
	}
	var summary RunSummary
	if err := json.Unmarshal(stdout.Bytes(), &summary); err != nil {
		t.Fatalf("decode summary: %v", err)
	}
	if summary.VariableSources["baseUrl"] != ".env" || summary.VariableSources["source"] != "cli" {
		t.Fatalf("variable sources = %#v", summary.VariableSources)
	}
}

func TestRunAppliesCollectionAndFolderInheritance(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if got := r.Header.Get("Authorization"); got != "Bearer inherited-token" {
			t.Fatalf("Authorization = %q", got)
		}
		if got := r.Header.Get("X-Tenant"); got != "acme" {
			t.Fatalf("X-Tenant = %q", got)
		}
		w.WriteHeader(http.StatusOK)
	}))
	defer server.Close()

	root := exportInheritedCollection(t, server.URL)
	var stdout, stderr bytes.Buffer
	code := Run([]string{"run", root}, &stdout, &stderr)
	if code != 0 {
		t.Fatalf("Run code = %d, stdout = %s, stderr = %s", code, stdout.String(), stderr.String())
	}
	if !strings.Contains(stdout.String(), "1 passed") {
		t.Fatalf("stdout missing pass summary:\n%s", stdout.String())
	}
}

func TestRunFiltersByFolder(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != "/admin/probe" {
			t.Fatalf("unexpected path %s", r.URL.Path)
		}
		w.WriteHeader(http.StatusNoContent)
	}))
	defer server.Close()

	root := exportFolderFilterCollection(t, server.URL)
	var stdout, stderr bytes.Buffer
	code := Run([]string{"run", root, "--folder", "Admin", "--reporter", "json"}, &stdout, &stderr)
	if code != 0 {
		t.Fatalf("Run code = %d, stdout = %s, stderr = %s", code, stdout.String(), stderr.String())
	}
	var summary RunSummary
	if err := json.Unmarshal(stdout.Bytes(), &summary); err != nil {
		t.Fatalf("decode summary: %v\n%s", err, stdout.String())
	}
	if summary.Total != 1 || summary.Passed != 1 || summary.Results[0].Name != "Admin Probe" {
		t.Fatalf("summary = %#v", summary)
	}
}

func exportInheritedCollection(t *testing.T, baseURL string) string {
	t.Helper()
	raw := map[string]any{
		"id":            "req-inherited",
		"name":          "Inherited Probe",
		"type":          "request",
		"method":        "GET",
		"url":           baseURL + "/probe",
		"params":        []map[string]any{},
		"headers":       []map[string]any{},
		"bodies":        []map[string]any{},
		"activeBodyIdx": 0,
		"auth":          map[string]any{"type": "none"},
		"assertions": []map[string]any{{
			"id": "assert-status", "enabled": true, "target": "statusCode", "operator": "eq", "expected": "200",
		}},
	}
	rawJSON, err := json.Marshal(raw)
	if err != nil {
		t.Fatalf("marshal request: %v", err)
	}
	collection := collectionfs.Collection{
		ID:   "col-inherited",
		Name: "Inherited Collection",
		Auth: requestcontract.Auth{Type: "bearer", Token: "{{token}}"},
		Variables: []requestcontract.Variable{
			{Key: "token", Value: "inherited-token", Enabled: true},
			{Key: "tenant", Value: "acme", Enabled: true},
		},
		Children: []collectionfs.Node{{
			ID:   "folder-shared",
			Name: "Shared",
			Type: "folder",
			Headers: []requestcontract.KVRow{{
				Key: "X-Tenant", Value: "{{tenant}}", Enabled: true,
			}},
			Children: []collectionfs.Node{{
				ID:   "req-inherited",
				Name: "Inherited Probe",
				Type: "request",
				Raw:  rawJSON,
			}},
		}},
	}
	root := filepath.Join(t.TempDir(), "collection")
	if err := collectionfs.ExportCollection(root, collection, collectionfs.ExportOptions{}); err != nil {
		t.Fatalf("export collection: %v", err)
	}
	return root
}

func TestRunWritesJUnitReport(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		w.WriteHeader(http.StatusCreated)
	}))
	defer server.Close()

	root := exportTestCollection(t, server.URL, "200")
	outPath := filepath.Join(t.TempDir(), "report.xml")
	var stdout, stderr bytes.Buffer
	code := Run([]string{"run", root, "--reporter", "junit", "--out", outPath}, &stdout, &stderr)
	if code != 1 {
		t.Fatalf("Run code = %d, stdout = %s, stderr = %s", code, stdout.String(), stderr.String())
	}
	data, err := os.ReadFile(outPath)
	if err != nil {
		t.Fatalf("read report: %v", err)
	}
	text := string(data)
	if !strings.Contains(text, `tests="1"`) || !strings.Contains(text, `failures="1"`) || !strings.Contains(text, "<failure") {
		t.Fatalf("unexpected junit report:\n%s", text)
	}
}

func exportTestCollection(t *testing.T, baseURL string, expectedStatus string) string {
	t.Helper()
	raw := map[string]any{
		"id":     "req-cli",
		"name":   "CLI Probe",
		"type":   "request",
		"method": "GET",
		"url":    baseURL + "/probe",
		"params": []map[string]any{{
			"id": "param-mode", "key": "mode", "value": "ok", "enabled": true,
		}},
		"headers": []map[string]any{{
			"id": "header-run", "key": "X-Run", "value": "cli", "enabled": true,
		}},
		"bodies":        []map[string]any{},
		"activeBodyIdx": 0,
		"auth":          map[string]any{"type": "none"},
		"assertions": []map[string]any{{
			"id": "assert-status", "enabled": true, "target": "statusCode", "operator": "eq", "expected": expectedStatus,
		}},
	}
	rawJSON, err := json.Marshal(raw)
	if err != nil {
		t.Fatalf("marshal request: %v", err)
	}
	collection := collectionfs.Collection{
		ID:   "col-cli",
		Name: "CLI Collection",
		Children: []collectionfs.Node{{
			ID:   "req-cli",
			Name: "CLI Probe",
			Type: "request",
			Raw:  rawJSON,
		}},
	}
	root := filepath.Join(t.TempDir(), "collection")
	if err := collectionfs.ExportCollection(root, collection, collectionfs.ExportOptions{}); err != nil {
		t.Fatalf("export collection: %v", err)
	}
	return root
}

func exportFolderFilterCollection(t *testing.T, baseURL string) string {
	t.Helper()
	adminRaw := map[string]any{
		"id":            "req-admin",
		"name":          "Admin Probe",
		"type":          "request",
		"method":        "GET",
		"url":           baseURL + "/admin/probe",
		"params":        []map[string]any{},
		"headers":       []map[string]any{},
		"bodies":        []map[string]any{},
		"activeBodyIdx": 0,
		"auth":          map[string]any{"type": "none"},
		"assertions": []map[string]any{{
			"id": "assert-status", "enabled": true, "target": "statusCode", "operator": "eq", "expected": "204",
		}},
	}
	publicRaw := map[string]any{
		"id":            "req-public",
		"name":          "Public Probe",
		"type":          "request",
		"method":        "GET",
		"url":           baseURL + "/public/probe",
		"params":        []map[string]any{},
		"headers":       []map[string]any{},
		"bodies":        []map[string]any{},
		"activeBodyIdx": 0,
		"auth":          map[string]any{"type": "none"},
	}
	adminJSON, err := json.Marshal(adminRaw)
	if err != nil {
		t.Fatalf("marshal admin request: %v", err)
	}
	publicJSON, err := json.Marshal(publicRaw)
	if err != nil {
		t.Fatalf("marshal public request: %v", err)
	}
	collection := collectionfs.Collection{
		ID:   "col-cli-folders",
		Name: "CLI Folder Collection",
		Children: []collectionfs.Node{
			{
				ID:   "folder-admin",
				Name: "Admin",
				Type: "folder",
				Children: []collectionfs.Node{{
					ID:   "req-admin",
					Name: "Admin Probe",
					Type: "request",
					Raw:  adminJSON,
				}},
			},
			{
				ID:   "folder-public",
				Name: "Public",
				Type: "folder",
				Children: []collectionfs.Node{{
					ID:   "req-public",
					Name: "Public Probe",
					Type: "request",
					Raw:  publicJSON,
				}},
			},
		},
	}
	root := filepath.Join(t.TempDir(), "collection")
	if err := collectionfs.ExportCollection(root, collection, collectionfs.ExportOptions{}); err != nil {
		t.Fatalf("export collection: %v", err)
	}
	return root
}
