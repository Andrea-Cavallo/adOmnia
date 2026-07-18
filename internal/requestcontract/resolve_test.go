package requestcontract

import (
	"io"
	"mime"
	"mime/multipart"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"adomnia/internal/httpexec"
)

func TestBuildHTTPPayloadCreatesMultipartFieldsAndFiles(t *testing.T) {
	filePath := filepath.Join(t.TempDir(), "sample.txt")
	if err := os.WriteFile(filePath, []byte("file-content"), 0600); err != nil {
		t.Fatal(err)
	}
	req := Request{ID: "multipart", Method: "POST", URL: "https://example.test/upload", Bodies: []Body{{Type: "formdata", Form: []KVRow{{Key: "name", Value: "sample", Enabled: true}, {Key: "document", Value: "@file:" + filePath, Enabled: true}}}}}
	payload, skip, err := BuildHTTPPayload(req, Options{})
	if err != nil || skip != "" {
		t.Fatalf("skip = %q, err = %v", skip, err)
	}
	_, params, err := mime.ParseMediaType(payload.Headers["Content-Type"])
	if err != nil {
		t.Fatal(err)
	}
	reader := multipart.NewReader(strings.NewReader(payload.Body), params["boundary"])
	values := map[string]string{}
	for {
		part, err := reader.NextPart()
		if err == io.EOF {
			break
		}
		if err != nil {
			t.Fatal(err)
		}
		data, _ := io.ReadAll(part)
		values[part.FormName()] = string(data)
	}
	if values["name"] != "sample" || values["document"] != "file-content" {
		t.Fatalf("multipart values = %#v", values)
	}
}

func TestBuildHTTPPayloadResolvesVarsPathParamsBodyAndAuth(t *testing.T) {
	req := Request{
		ID:     "req-1",
		Method: "POST",
		URL:    "{{baseUrl}}/users/:userId",
		PathParams: []KVRow{{
			Key: "userId", Value: "{{userId}}", Enabled: true,
		}},
		Params: []KVRow{{
			Key: "mode", Value: "{{mode}}", Enabled: true,
		}},
		Headers: []KVRow{{
			Key: "X-Tenant", Value: "{{tenant}}", Enabled: true,
		}},
		Bodies: []Body{{
			Type: "raw", Raw: `{"name":"{{name}}"}`,
		}},
		ActiveBodyIdx: 0,
		Auth: Auth{
			Type:  "apikey",
			Token: "{{apiKey}}",
		},
	}

	payload, skip, err := BuildHTTPPayload(req, Options{Vars: map[string]string{
		"baseUrl": "https://api.example.test",
		"userId":  "u-123",
		"mode":    "full",
		"tenant":  "acme",
		"name":    "Andrea",
		"apiKey":  "secret",
	}})
	if err != nil {
		t.Fatalf("BuildHTTPPayload err = %v", err)
	}
	if skip != "" {
		t.Fatalf("BuildHTTPPayload skip = %q", skip)
	}
	if payload.URL != "https://api.example.test/users/u-123?mode=full" {
		t.Fatalf("URL = %q", payload.URL)
	}
	if payload.Headers["X-Tenant"] != "acme" || payload.Headers["X-API-Key"] != "secret" {
		t.Fatalf("headers = %#v", payload.Headers)
	}
	if payload.Body != `{"name":"Andrea"}` {
		t.Fatalf("body = %q", payload.Body)
	}
}

func TestBuildHTTPPayloadSkipsUnresolvedVars(t *testing.T) {
	_, skip, err := BuildHTTPPayload(Request{Method: "GET", URL: "{{baseUrl}}/users"}, Options{})
	if err != nil {
		t.Fatalf("BuildHTTPPayload err = %v", err)
	}
	if !strings.Contains(skip, "unresolved URL variables") {
		t.Fatalf("skip = %q", skip)
	}
}

func TestEvaluateAssertions(t *testing.T) {
	message := EvaluateAssertions([]Assertion{
		{Enabled: true, Target: "statusCode", Operator: "eq", Expected: "201"},
		{Enabled: true, Target: "header", Operator: "contains", HeaderName: "Content-Type", Expected: "json"},
		{Enabled: true, Target: "bodyText", Operator: "contains", Expected: "ok"},
	}, httpexec.HTTPExecResponse{
		Status:      201,
		ContentType: "application/json",
		Headers:     map[string]string{"content-type": "application/json"},
		Body:        `{"ok":true}`,
	})
	if message != "" {
		t.Fatalf("EvaluateAssertions = %q", message)
	}

	message = EvaluateAssertions([]Assertion{{Enabled: true, Target: "statusCode", Operator: "eq", Expected: "200"}}, httpexec.HTTPExecResponse{Status: 201})
	if message != "statusCode expected 200, got 201" {
		t.Fatalf("EvaluateAssertions failure = %q", message)
	}
}
