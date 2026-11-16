package adomniacli

import (
	jsonv1 "encoding/json"
	"strings"
	"testing"
)

func TestIDEMutationsRequireExplicitWrite(t *testing.T) {
	server := &mcpServer{}
	for _, name := range []string{"ide_test_start", "ide_debug_start", "ide_debug", "ide_database_query", "ide_review_begin", "ide_review_end"} {
		if _, err := server.callIDETool(name, jsonv1.RawMessage(`{}`)); err == nil || !strings.Contains(err.Error(), "requires --write") {
			t.Fatalf("%s: %v", name, err)
		}
	}
	for _, tool := range mcpIDETools() {
		if !mcpKnownTool(tool.Name) {
			t.Fatal(tool.Name)
		}
	}
}
