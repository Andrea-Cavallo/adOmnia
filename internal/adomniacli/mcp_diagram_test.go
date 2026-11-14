package adomniacli

import (
	"encoding/json/v2"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func TestMCPDiagramFromMarkdownWritesABlueprint(t *testing.T) {
	root := t.TempDir()
	if err := os.WriteFile(filepath.Join(root, "arch.md"), []byte("# Payments\n## Services\n- Payment API\n- Ledger DB\nPayment API -> Ledger DB: write\n"), 0o644); err != nil {
		t.Fatal(err)
	}
	server := &mcpServer{workspace: root}
	text, err := server.callDiagramTool("diagram_from_markdown", []byte(`{"path":"arch.md","output":"default"}`))
	if err == nil || !strings.Contains(err.Error(), "--write") {
		t.Fatalf("writing without --write must be refused, got %q %v", text, err)
	}
	server.allowWrite = true
	text, err = server.callDiagramTool("diagram_from_markdown", []byte(`{"path":"arch.md","output":"default"}`))
	if err != nil {
		t.Fatal(err)
	}
	saved, err := os.ReadFile(filepath.Join(root, "diagrams", "payments.adomnia-diagram.json"))
	if err != nil {
		t.Fatalf("file not written (%s): %v", text, err)
	}
	var file struct {
		Format string `json:"format"`
		Nodes  []any  `json:"nodes"`
		Links  []any  `json:"links"`
	}
	if err := json.Unmarshal(saved, &file); err != nil || file.Format != "adomnia-diagram-blueprint" || len(file.Nodes) != 3 || len(file.Links) != 1 {
		t.Fatalf("unexpected file %s (%v)", saved, err)
	}
}

func TestMCPDiagramCreateValidatesAndRefusesEscapes(t *testing.T) {
	server := &mcpServer{workspace: t.TempDir(), allowWrite: true}
	if _, err := server.callDiagramTool("diagram_create", []byte(`{"diagram":{"nodes":[{"key":"a","shape":"service","label":"A"}],"links":[{"from":"a","to":"missing"}]}}`)); err == nil {
		t.Error("a link to a missing node must be refused")
	}
	if _, err := server.callDiagramTool("diagram_create", []byte(`{"diagram":{"nodes":[{"key":"a","label":"A"}]},"output":"../outside.json"}`)); err == nil {
		t.Error("an output outside the workspace must be refused")
	}
	text, err := server.callDiagramTool("diagram_shapes", nil)
	if err != nil || !strings.Contains(text, "kafka-topic") {
		t.Fatalf("shapes: %v %s", err, text)
	}
}
