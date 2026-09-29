package devcontext

import "testing"

func TestNormalizePath(t *testing.T) {
	cases := map[string]string{
		"/users/:id":          "/users/{id}",
		"/users/{id}":         "/users/{id}",
		"/users/{id:[0-9]+}/": "/users/{id}",
		"/files/{path...}":    "/files/{path...}",
		"/":                   "/",
		"":                    "/",
		"/static/*filepath":   "/static/*filepath",
	}
	for in, want := range cases {
		if got := normalizePath(in); got != want {
			t.Errorf("normalizePath(%q) = %q, want %q", in, got, want)
		}
	}
}

func TestDetectOpenAPIYAML(t *testing.T) {
	data := []byte(`openapi: 3.0.3
info: {title: Payments, version: "1"}
paths:
  /payments:
    get: {}
    post: {}
    parameters: []
  /payments/{id}:
    get: {}
`)
	got, err := detectOpenAPI("api/openapi.yaml", data)
	if err != nil {
		t.Fatal(err)
	}
	ids := byID(got)
	if ids["contract:api/openapi.yaml"].Attrs["type"] != "oas" {
		t.Fatalf("contract missing: %+v", ids)
	}
	post := ids["route:POST /payments"]
	if post.Confidence != ConfidenceCertain || post.Attrs["contract"] != "api/openapi.yaml" || post.Sources[0].Line != 6 {
		t.Fatalf("POST route: %+v", post)
	}
	if _, ok := ids["route:GET /payments/{id}"]; !ok {
		t.Fatalf("GET /payments/{id} missing: %+v", ids)
	}
	if len(got) != 4 {
		t.Fatalf("'parameters' is not an operation; want 4 entities, got %d", len(got))
	}
}

func TestDetectOpenAPIJSONAndNonSpecs(t *testing.T) {
	spec := []byte("{\n  \"swagger\": \"2.0\",\n  \"paths\": {\"/ping\": {\"get\": {}}}\n}")
	got, err := detectOpenAPI("swagger.json", spec)
	if err != nil || len(byID(got)) != 2 {
		t.Fatalf("swagger json: %v %+v", err, got)
	}
	for name, data := range map[string]string{
		"package.json": `{"name": "x", "dependencies": {}}`,
		"k8s.yaml":     "spec:\n  openapi: nested-not-root\n",
	} {
		if got, _ := detectOpenAPI(name, []byte(data)); len(got) != 0 {
			t.Errorf("%s must not be detected as OpenAPI: %+v", name, got)
		}
	}
}

func TestDetectContractFile(t *testing.T) {
	got, _ := detectContractFile("proto/payments.proto", nil)
	if byID(got)["contract:proto/payments.proto"].Attrs["type"] != "proto" {
		t.Fatalf("proto: %+v", got)
	}
	got, _ = detectContractFile("legacy/ledger.wsdl", nil)
	if byID(got)["contract:legacy/ledger.wsdl"].Attrs["type"] != "wsdl" {
		t.Fatalf("wsdl: %+v", got)
	}
}
