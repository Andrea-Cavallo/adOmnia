package apicontract

import (
	"os"
	"path/filepath"
	"testing"
)

const spec = `openapi: 3.0.0
paths:
  /orders/{id}:
    get:
      responses:
        "200":
          content:
            application/json:
              schema: { $ref: '#/components/schemas/Order' }
  /orders:
    post:
      requestBody:
        content:
          application/json:
            schema: { $ref: '#/components/schemas/NewOrder' }
      responses:
        "201": { description: created }
  /health:
    get:
      responses: { "200": { description: ok } }
components:
  schemas:
    Order:
      type: object
      properties: { id: { type: string }, total: { type: number }, note: { type: string } }
    NewOrder:
      type: object
      required: [sku]
      properties: { sku: { type: string }, qty: { type: integer } }
`

func code() []Operation {
	return []Operation{
		{Method: "GET", Path: "/orders/{orderID}", Response: &Body{Schema: "Order", Fields: []Field{{Name: "id", Type: "string", Required: true}, {Name: "total", Type: "integer"}, {Name: "status", Type: "string"}}}},
		{Method: "POST", Path: "/orders", Request: &Body{Schema: "NewOrder", Fields: []Field{{Name: "sku", Type: "string", Required: true}, {Name: "qty", Type: "integer", Required: true}}}},
		{Method: "DELETE", Path: "/orders/{id}"},
	}
}

func TestCompareWithContract(t *testing.T) {
	contract, err := ParseContract("openapi.yaml", []byte(spec))
	if err != nil {
		t.Fatal(err)
	}
	kinds := map[string]int{}
	for _, issue := range CompareWithContract(code(), contract) {
		kinds[issue.Kind]++
	}
	want := map[string]int{"undocumented": 1, "unimplemented": 1, "type-mismatch": 1, "field-missing-in-contract": 1, "field-missing-in-code": 1, "required-mismatch": 1}
	for kind, count := range want {
		if kinds[kind] != count {
			t.Fatalf("%s = %d, want %d (all %v)", kind, kinds[kind], count, kinds)
		}
	}
}

func TestCompareRevisions(t *testing.T) {
	base := code()
	head := []Operation{
		{Method: "GET", Path: "/orders/{id}", Response: &Body{Fields: []Field{{Name: "id", Type: "string"}, {Name: "total", Type: "number"}}}},
		{Method: "POST", Path: "/orders", Request: &Body{Fields: []Field{{Name: "sku", Type: "string", Required: true}, {Name: "qty", Type: "integer", Required: true}, {Name: "coupon", Type: "string", Required: true}}}},
		{Method: "GET", Path: "/health"},
	}
	breaking := map[string]bool{}
	for _, issue := range CompareRevisions(base, head) {
		if issue.Breaking {
			breaking[issue.Kind+":"+issue.Field+issue.Operation] = true
		}
	}
	for _, key := range []string{"removed-operation:DELETE /orders/{}", "type-changed:totalGET /orders/{}", "removed-field:statusGET /orders/{}", "added-field:couponPOST /orders"} {
		if !breaking[key] {
			t.Fatalf("missing breaking change %s in %v", key, breaking)
		}
	}
}

func TestFindContract(t *testing.T) {
	root := t.TempDir()
	if err := os.MkdirAll(filepath.Join(root, "api"), 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(root, "api", "openapi.yaml"), []byte(spec), 0o644); err != nil {
		t.Fatal(err)
	}
	if got := FindContract(root); got != "api/openapi.yaml" {
		t.Fatalf("FindContract = %q", got)
	}
}
