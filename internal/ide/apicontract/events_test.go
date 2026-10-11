package apicontract

import (
	"os"
	"path/filepath"
	"testing"
)

func shapes() []EventShape {
	return []EventShape{
		{Topic: "orders.created", Broker: "kafka", Role: "producer", Function: "Publish", Schema: "OrderCreated", Fields: []Field{{Name: "id", Type: "string"}, {Name: "total", Type: "number"}}},
		{Topic: "orders.created", Broker: "kafka", Role: "consumer", Function: "Bill", Schema: "OrderEvent", Fields: []Field{{Name: "id", Type: "string"}, {Name: "total", Type: "integer"}, {Name: "currency", Type: "string"}}},
	}
}

func TestCompareEvents(t *testing.T) {
	kinds := map[string]int{}
	for _, issue := range CompareEvents(shapes()) {
		kinds[issue.Kind]++
	}
	if kinds["event-missing-field"] != 1 || kinds["event-type-mismatch"] != 1 {
		t.Fatalf("issues: %v", kinds)
	}
}

func TestEventSchemasAndRevisions(t *testing.T) {
	root := t.TempDir()
	avsc := `{"type":"record","name":"OrderCreated","fields":[{"name":"id","type":"string"},{"name":"total","type":"double"},{"name":"customer","type":"string"},{"name":"note","type":["null","string"]}]}`
	if err := os.WriteFile(filepath.Join(root, "order_created.avsc"), []byte(avsc), 0o644); err != nil {
		t.Fatal(err)
	}
	schemas := FindEventSchemas(root)
	if len(schemas) != 1 || schemas[0].Fields[1].Type != "number" || schemas[0].Fields[3].Required {
		t.Fatalf("schemas: %+v", schemas)
	}
	kinds := map[string]int{}
	for _, issue := range CompareEventSchemas(shapes()[:1], schemas) {
		kinds[issue.Kind]++
	}
	if kinds["schema-missing-in-code"] != 1 || len(kinds) != 1 { // customer is required and missing; note is optional
		t.Fatalf("schema issues: %v", kinds)
	}
	head := []EventShape{{Topic: "orders.created", Broker: "kafka", Role: "producer", Function: "Publish", Fields: []Field{{Name: "id", Type: "integer"}, {Name: "sku", Type: "string"}}}}
	breaking := map[string]bool{}
	for _, issue := range CompareEventRevisions(shapes()[:1], head) {
		breaking[issue.Kind+":"+issue.Field] = issue.Breaking
	}
	if !breaking["type-changed:id"] || !breaking["removed-field:total"] || breaking["added-field:sku"] {
		t.Fatalf("revisions: %v", breaking)
	}
}
