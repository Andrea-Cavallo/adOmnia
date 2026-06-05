package generator

import (
	"encoding/json"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func TestGenerateWritesRunnableServerScaffold(t *testing.T) {
	dir := t.TempDir()
	input := GenerateInput{
		ServerName: "Payments API",
		Requests: []RawRequest{{
			Name:   "Get Payment",
			Method: "GET",
			URL:    "https://api.example.test/payments/:id",
			Auth: RawAuth{
				Type: "bearer",
			},
		}},
	}
	raw, err := json.Marshal(input)
	if err != nil {
		t.Fatal(err)
	}

	if err := Generate(string(raw), dir); err != nil {
		t.Fatal(err)
	}

	for _, name := range []string{"index.ts", "package.json", ".env.example", "README.md"} {
		if _, err := os.Stat(filepath.Join(dir, name)); err != nil {
			t.Fatalf("expected generated %s: %v", name, err)
		}
	}

	indexRaw, err := os.ReadFile(filepath.Join(dir, "index.ts"))
	if err != nil {
		t.Fatal(err)
	}
	index := string(indexRaw)
	for _, expected := range []string{
		`name: "get_payment"`,
		`required: ["id"]`,
		"StdioServerTransport",
		"await server.connect(transport)",
	} {
		if !strings.Contains(index, expected) {
			t.Fatalf("generated index.ts missing %q:\n%s", expected, index)
		}
	}

	pkgRaw, err := os.ReadFile(filepath.Join(dir, "package.json"))
	if err != nil {
		t.Fatal(err)
	}
	if !strings.Contains(string(pkgRaw), `"start": "ts-node index.ts"`) {
		t.Fatalf("package.json missing start script:\n%s", string(pkgRaw))
	}
}
