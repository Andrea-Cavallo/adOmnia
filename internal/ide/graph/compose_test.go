package graph

import (
	"os"
	"path/filepath"
	"testing"
)

func TestComposeServicesRunEntryPoints(t *testing.T) {
	root := t.TempDir()
	compose := "services:\n  api:\n    build: .\n    depends_on: [db]\n  worker:\n    build:\n      context: .\n      dockerfile: cmd/worker/Dockerfile\n  db:\n    image: postgres:16\n"
	if err := os.MkdirAll(filepath.Join(root, "deploy"), 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(root, "docker-compose.yml"), []byte(compose), 0o644); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(root, "deploy", "compose.prod.yaml"), []byte("services: {}\n"), 0o644); err != nil {
		t.Fatal(err)
	}
	b := NewBuilder()
	b.Node(Node{ID: "entry:api", Kind: KindEntry, Label: "main api", File: "cmd/api/main.go", Attrs: map[string]string{"entry": "main"}})
	b.Node(Node{ID: "entry:worker", Kind: KindEntry, Label: "main worker", File: "cmd/worker/main.go", Attrs: map[string]string{"entry": "main"}})
	b.Node(Node{ID: "fn:handle", Kind: KindFunction, Label: "handle"})
	b.Edge("entry:api", "fn:handle", EdgeStarts, "")
	files := FindComposeFiles(root)
	if len(files) != 2 {
		t.Fatalf("compose files: %v", files)
	}
	AddComposeServices(b, root, files)
	g := b.Graph()
	index := NewIndex(&g)
	if runs := index.Out("service:api", EdgeRuns); len(runs) != 1 || runs[0].To != "entry:api" {
		t.Fatalf("api runs %v", runs)
	}
	if runs := index.Out("service:worker", EdgeRuns); len(runs) != 1 || runs[0].To != "entry:worker" {
		t.Fatalf("worker runs %v", runs)
	}
	if len(index.Out("service:api", EdgeDependsOn)) != 1 {
		t.Fatal("depends_on missing")
	}
	impact, _ := index.Impact("fn:handle")
	if len(impact.Services) != 1 || impact.Services[0].Node.Label != "api" {
		t.Fatalf("services: %+v", impact.Services)
	}
	if node, _ := index.Node("service:api"); node.Line != 2 {
		t.Fatalf("api line = %d", node.Line)
	}
}
