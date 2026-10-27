package mock

import (
	"encoding/json/v2"
	"strings"
	"testing"
)

func TestGenerateFromSchemaEmail(t *testing.T) {
	result, err := GenerateFromSchema(map[string]any{"type": "string", "format": "email"})
	if err != nil {
		t.Fatal(err)
	}
	if !strings.Contains(result, "@") {
		t.Fatalf("expected email-like string, got %s", result)
	}
}

func TestGenerateFromSchemaObject(t *testing.T) {
	result, err := GenerateFromSchema(map[string]any{
		"type": "object",
		"properties": map[string]any{
			"id":    map[string]any{"type": "string", "format": "uuid"},
			"email": map[string]any{"type": "string", "format": "email"},
			"age":   map[string]any{"type": "integer", "minimum": float64(18), "maximum": float64(99)},
		},
		"required": []any{"id", "email"},
	})
	if err != nil {
		t.Fatal(err)
	}
	var obj map[string]any
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
	result, err := GenerateFromSchema(map[string]any{"enum": []any{"active", "inactive", "pending"}})
	if err != nil {
		t.Fatal(err)
	}
	if result != `"active"` && result != `"inactive"` && result != `"pending"` {
		t.Fatalf("unexpected enum value: %s", result)
	}
}
