package mock

import (
	"encoding/json"
	"strings"
	"testing"
)

func TestGenerateFromSchemaEmail(t *testing.T) {
	result, err := GenerateFromSchema(map[string]interface{}{"type": "string", "format": "email"})
	if err != nil {
		t.Fatal(err)
	}
	if !strings.Contains(result, "@") {
		t.Fatalf("expected email-like string, got %s", result)
	}
}

func TestGenerateFromSchemaObject(t *testing.T) {
	result, err := GenerateFromSchema(map[string]interface{}{
		"type": "object",
		"properties": map[string]interface{}{
			"id":    map[string]interface{}{"type": "string", "format": "uuid"},
			"email": map[string]interface{}{"type": "string", "format": "email"},
			"age":   map[string]interface{}{"type": "integer", "minimum": float64(18), "maximum": float64(99)},
		},
		"required": []interface{}{"id", "email"},
	})
	if err != nil {
		t.Fatal(err)
	}
	var obj map[string]interface{}
	if err := json.Unmarshal([]byte(result), &obj); err != nil {
		t.Fatalf("result is not valid JSON: %v, got %s", err, result)
	}
	if obj["id"] == nil || obj["email"] == nil {
		t.Fatalf("expected required fields, got %#v", obj)
	}
	if age, ok := obj["age"].(float64); ok && (age < 18 || age > 99) {
		t.Fatalf("expected bounded age, got %v", age)
	}
}

func TestGenerateFromSchemaEnum(t *testing.T) {
	result, err := GenerateFromSchema(map[string]interface{}{"enum": []interface{}{"active", "inactive", "pending"}})
	if err != nil {
		t.Fatal(err)
	}
	if result != `"active"` && result != `"inactive"` && result != `"pending"` {
		t.Fatalf("unexpected enum value: %s", result)
	}
}
