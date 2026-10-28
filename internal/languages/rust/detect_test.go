package rust

import (
	"context"
	"path/filepath"
	"testing"

	"github.com/Andrea-Cavallo/adOmnia/internal/ide/project"
)

func TestDetectSingleBinCrate(t *testing.T) {
	root := t.TempDir()
	writeFile(t, root, "Cargo.toml", "[package]\nname = \"hello\"\nversion = \"0.1.0\"\n")
	writeFile(t, root, "src/main.rs", "fn main() {}\n")
	units, err := New().DetectUnits(context.Background(), root)
	if err != nil {
		t.Fatal(err)
	}
	if len(units) != 1 {
		t.Fatalf("units = %+v", units)
	}
	unit := units[0]
	if unit.Language != "rust" || unit.Kind != "cargo-package" || unit.Name != "hello" || unit.Root != root {
		t.Fatalf("%+v", unit)
	}
	if filepath.Base(unit.Manifest) != "Cargo.toml" {
		t.Fatalf("manifest = %q", unit.Manifest)
	}
}

func TestDetectVirtualWorkspaceWithMembers(t *testing.T) {
	root := t.TempDir()
	writeFile(t, root, "Cargo.toml", "[workspace]\nmembers = [\"crates/a\", \"crates/b\"]\n")
	writeFile(t, root, "crates/a/Cargo.toml", "[package]\nname = \"a\"\n")
	writeFile(t, root, "crates/b/Cargo.toml", "[package]\nname = \"b\"\n")
	units, err := New().DetectUnits(context.Background(), root)
	if err != nil {
		t.Fatal(err)
	}
	if len(units) != 3 {
		t.Fatalf("units = %+v", units)
	}
	kinds := map[string]string{}
	names := map[string]string{}
	for _, unit := range units {
		rel, _ := filepath.Rel(root, unit.Root)
		kinds[rel] = unit.Kind
		names[rel] = unit.Name
	}
	if kinds["."] != "cargo-workspace" {
		t.Fatalf("workspace unit = %+v", units)
	}
	if kinds[filepath.Join("crates", "a")] != "cargo-package" || names[filepath.Join("crates", "a")] != "a" {
		t.Fatalf("member a = %#v", units)
	}
	if kinds[filepath.Join("crates", "b")] != "cargo-package" || names[filepath.Join("crates", "b")] != "b" {
		t.Fatalf("member b = %#v", units)
	}
}

func TestDetectRootPackageWithWorkspaceDoesNotDuplicate(t *testing.T) {
	root := t.TempDir()
	writeFile(t, root, "Cargo.toml", "[package]\nname = \"root\"\n\n[workspace]\nmembers = [\"crates/*\"]\n")
	writeFile(t, root, "crates/lib/Cargo.toml", "[package]\nname = \"lib\"\n")
	units, err := New().DetectUnits(context.Background(), root)
	if err != nil {
		t.Fatal(err)
	}
	if len(units) != 2 {
		t.Fatalf("units = %+v", units)
	}
	for _, unit := range units {
		if unit.Kind == "cargo-workspace" {
			t.Fatalf("a root package must not also become a workspace unit: %+v", units)
		}
	}
}

func TestDetectSkipsTargetAndCargoDirs(t *testing.T) {
	root := t.TempDir()
	writeFile(t, root, "Cargo.toml", "[package]\nname = \"app\"\n")
	writeFile(t, root, "target/debug/Cargo.toml", "[package]\nname = \"ghost\"\n")
	writeFile(t, root, ".cargo/registry/Cargo.toml", "[package]\nname = \"dep\"\n")
	units, err := New().DetectUnits(context.Background(), root)
	if err != nil {
		t.Fatal(err)
	}
	if len(units) != 1 || units[0].Name != "app" {
		t.Fatalf("units = %+v", units)
	}
}

func TestDetectToleratesMalformedManifestAlongsideValidOnes(t *testing.T) {
	root := t.TempDir()
	writeFile(t, root, "Cargo.toml", "[package]\nname = \"app\"\n")
	writeFile(t, root, "broken/Cargo.toml", "questo non è toml valido [\n")
	writeFile(t, root, "good/Cargo.toml", "[package]\nname = \"good\"\n")
	units, err := New().DetectUnits(context.Background(), root)
	if err != nil {
		t.Fatal(err)
	}
	if len(units) != 2 {
		t.Fatalf("units = %+v", units)
	}
	names := map[string]bool{}
	for _, unit := range units {
		names[unit.Name] = true
	}
	if !names["app"] || !names["good"] {
		t.Fatalf("names = %#v", names)
	}
}

func TestDetectMixedMonorepoReturnsOnlyRustUnits(t *testing.T) {
	root := t.TempDir()
	writeFile(t, root, "go.mod", "module example.com/app\n\ngo 1.26\n")
	writeFile(t, root, "services/orders/pyproject.toml", "[project]\nname = 'orders'\n")
	writeFile(t, root, "services/billing/Cargo.toml", "[package]\nname = \"billing\"\n")
	units, err := New().DetectUnits(context.Background(), root)
	if err != nil {
		t.Fatal(err)
	}
	if len(units) != 1 || units[0].Language != "rust" || units[0].Name != "billing" {
		t.Fatalf("units = %+v", units)
	}
}

func TestDetectNoCargoTomlYieldsNoUnits(t *testing.T) {
	root := t.TempDir()
	writeFile(t, root, "src/main.rs", "fn main() {}\n")
	units, err := New().DetectUnits(context.Background(), root)
	if err != nil {
		t.Fatal(err)
	}
	if len(units) != 0 {
		t.Fatalf("a bare .rs file must not become a unit: %+v", units)
	}
}

// TestUnitScannerSharesTheWalk: l'adapter implementa UnitScanner, così il registry usa una sola
// scansione del disco per tutti i linguaggi invece di una walk per adapter.
func TestUnitScannerSharesTheWalk(t *testing.T) {
	root := t.TempDir()
	writeFile(t, root, "Cargo.toml", "[package]\nname = \"app\"\n")
	visitor := New().NewUnitsVisitor(root)
	if err := project.WalkDirectories(context.Background(), root, project.MaxScanDirectories, visitor); err != nil {
		t.Fatal(err)
	}
	units, err := visitor.Units()
	if err != nil {
		t.Fatal(err)
	}
	if len(units) != 1 || units[0].Name != "app" {
		t.Fatalf("units = %+v", units)
	}
}
