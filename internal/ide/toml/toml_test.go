package toml

import (
	"testing"
)

// TestParsePyProjectShapes verifica le forme usate da pyproject.toml: tabelle, chiavi punteggiate,
// array, commenti in coda e array di tabelle ([[...]]). Il parser è condiviso con l'adapter Rust.
func TestParsePyProjectShapes(t *testing.T) {
	document := Parse([]byte(`
# commento
[project]
name = "orders-api"
requires-python = ">=3.11"
dependencies = [
  "fastapi>=0.110", # commento in coda
  "uvicorn[standard]",
]

[project.scripts]
orders = "orders.cli:main"

[tool.pytest.ini_options]
testpaths = ["tests", "integration"]

[tool.uv.workspace]
members = ["packages/*"]

[[tool.example]]
name = "primo"

[[tool.example]]
name = "secondo"
`))
	if got := String(document, "project", "name"); got != "orders-api" {
		t.Fatalf("name = %q", got)
	}
	if got := Strings(document, "project", "dependencies"); len(got) != 2 || got[0] != "fastapi>=0.110" {
		t.Fatalf("dependencies = %#v", got)
	}
	if got := Strings(document, "tool", "pytest", "ini_options", "testpaths"); len(got) != 2 {
		t.Fatalf("testpaths = %#v", got)
	}
	if got := String(document, "project", "scripts", "orders"); got != "orders.cli:main" {
		t.Fatalf("scripts = %q", got)
	}
	if entries := Tables(document, "tool", "example"); len(entries) != 2 {
		t.Fatalf("array tables = %#v", document["tool"])
	}
}

func TestParseSurvivesMalformedLines(t *testing.T) {
	document := Parse([]byte("[project]\nname = 'ok'\nquesta riga non ha senso\nbroken = [1, 2\nrequires-python = \">=3.10\"\n"))
	if String(document, "project", "name") != "ok" || String(document, "project", "requires-python") != ">=3.10" {
		t.Fatalf("%#v", document)
	}
}

// TestParseCargoShapes verifica le forme specifiche di Cargo.toml: tabelle [package]/[workspace],
// array di tabelle [[bin]]/[[example]], tabelle inline nelle dipendenze e valori ereditati.
func TestParseCargoShapes(t *testing.T) {
	document := Parse([]byte(`
[package]
name = "orders"
version = "0.1.0"
edition = "2021"
default-run = "server"

[workspace]
members = ["crates/*", "apps/api"]
default-members = ["apps/api"]

[workspace.dependencies]
serde = { version = "1.0", features = ["derive"] }

[features]
default = ["tls"]
tls = []

[lib]
name = "orders_lib"

[[bin]]
name = "server"
path = "src/main.rs"

[[bin]]
name = "cli"

[[example]]
name = "demo"

[dependencies]
tokio = { version = "1", features = ["full"] }
serde = { workspace = true }

[patch.crates-io]
foo = { path = "../foo" }
`))
	if got := String(document, "package", "name"); got != "orders" {
		t.Fatalf("package.name = %q", got)
	}
	if got := String(document, "package", "default-run"); got != "server" {
		t.Fatalf("package.default-run = %q", got)
	}
	if members := Strings(document, "workspace", "members"); len(members) != 2 || members[0] != "crates/*" {
		t.Fatalf("workspace.members = %#v", members)
	}
	if deps := Table(document, "workspace", "dependencies"); deps == nil {
		t.Fatal("workspace.dependencies not parsed")
	}
	if features := Table(document, "features"); len(features) != 2 {
		t.Fatalf("features = %#v", features)
	}
	if bins := Tables(document, "bin"); len(bins) != 2 || String(bins[0], "name") != "server" {
		t.Fatalf("bins = %#v", bins)
	}
	if examples := Tables(document, "example"); len(examples) != 1 || String(examples[0], "name") != "demo" {
		t.Fatalf("examples = %#v", examples)
	}
	if deps := Table(document, "dependencies"); deps == nil || Table(deps, "tokio") == nil || Table(deps, "serde") == nil {
		t.Fatalf("dependencies = %#v", deps)
	}
	if patch := Table(document, "patch"); patch == nil || Table(patch, "crates-io") == nil {
		t.Fatalf("patch = %#v", patch)
	}
}
