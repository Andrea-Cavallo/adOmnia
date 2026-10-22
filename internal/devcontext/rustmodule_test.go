package devcontext

import "testing"

// Ogni crate con [package] deve diventare un'entità module come un go.mod; un workspace virtuale
// (senza [package]) non è un modulo.
func TestDetectCargoTomlModule(t *testing.T) {
	src := []byte("[package]\nname = \"orders\"\nversion = \"0.1.0\"\n")
	entities, err := detectCargoToml("crates/orders/Cargo.toml", src)
	if err != nil {
		t.Fatal(err)
	}
	if len(entities) != 1 || entities[0].Kind != "module" || entities[0].ID != "module:orders" {
		t.Fatalf("entities = %+v", entities)
	}
	if entities[0].Attrs["dir"] != "crates/orders" || entities[0].Attrs["language"] != "rust" {
		t.Fatalf("attrs = %+v", entities[0].Attrs)
	}
}

func TestDetectCargoTomlVirtualWorkspaceIsNotAModule(t *testing.T) {
	src := []byte("[workspace]\nmembers = [\"crates/*\"]\n")
	entities, err := detectCargoToml("Cargo.toml", src)
	if err != nil {
		t.Fatal(err)
	}
	if len(entities) != 0 {
		t.Fatalf("a virtual workspace must not be a module: %+v", entities)
	}
}

func TestDetectFileRoutesCargoTomlToModule(t *testing.T) {
	entities, warnings := detectFile("Cargo.toml", []byte("[package]\nname = \"app\"\n"), nil, AdapterHints{})
	if len(warnings) != 0 {
		t.Fatalf("warnings: %v", warnings)
	}
	if len(entities) != 1 || entities[0].Kind != "module" || entities[0].ID != "module:app" {
		t.Fatalf("entities = %+v", entities)
	}
}

func TestInterestingReadsCargoToml(t *testing.T) {
	if !interesting("Cargo.toml") || !interesting("crates/a/Cargo.toml") {
		t.Fatal("Cargo.toml must be readable")
	}
	if interesting("target/debug/Cargo.toml") {
		t.Fatal("Cargo.toml under target/ must be skipped")
	}
}
