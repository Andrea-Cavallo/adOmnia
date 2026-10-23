package devcontext

import (
	"os"
	"path/filepath"
	"testing"
)

// Il detector Rust non deve alterare ciò che Go e Python producono: in un monorepo misto ognuno
// continua a produrre le proprie entità, e Rust si aggiunge (RS-7.12, non regressione).
func TestMixedMonorepoYieldsAllLanguageEntities(t *testing.T) {
	root := t.TempDir()
	files := map[string]string{
		"go.mod":            "module example.com/orders\n\ngo 1.22\n",
		"main.go":           "package main\n\nimport \"net/http\"\n\nfunc main() { http.HandleFunc(\"GET /health\", func(w http.ResponseWriter, r *http.Request) {}) }\n",
		"svc/Cargo.toml":    "[package]\nname = \"billing\"\nversion = \"0.1.0\"\n",
		"svc/src/main.rs":   "use axum::{Router, routing::get};\nlet app = Router::new().route(\"/users\", get(list_users));\n",
		"ml/pyproject.toml": "[project]\nname = 'ml'\n",
		"ml/app.py":         "from fastapi import FastAPI\napp = FastAPI()\n\n@app.get(\"/items\")\nasync def items():\n    return []\n",
	}
	for name, content := range files {
		path := filepath.Join(root, filepath.FromSlash(name))
		if err := os.MkdirAll(filepath.Dir(path), 0o755); err != nil {
			t.Fatal(err)
		}
		if err := os.WriteFile(path, []byte(content), 0o644); err != nil {
			t.Fatal(err)
		}
	}
	m, _ := newTestManager(root)
	snap, err := m.Get("s1")
	if err != nil {
		t.Fatal(err)
	}
	ids := byID(snap.Entities)
	for _, id := range []string{
		"module:example.com/orders", // Go
		"route:GET /health",         // Go
		"module:billing",            // Rust
		"route:GET /users",          // Rust (axum)
		"route:GET /items",          // Python (FastAPI)
	} {
		if _, ok := ids[id]; !ok {
			t.Errorf("missing %s (have: %v)", id, keys(ids))
		}
	}
}
