package requestcontract

import (
	"strings"
	"testing"

	"adomnia/internal/httpexec"
)

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
