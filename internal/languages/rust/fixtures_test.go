package rust

import (
	"context"
	"path/filepath"
	"testing"
)

// RS-0.5: il corpus di fixture copre le forme di progetto che gli altri blocchi riusano. Qui le
// due forme rimaste scoperte: il workspace a 3 membri (lib + bin + examples/) e il crate con
// build.rs + proc-macro. La detection resta statica: build.rs e proc-macro non vengono eseguiti.

func TestDetectWorkspaceWithThreeMembers(t *testing.T) {
	root := t.TempDir()
	writeFile(t, root, "Cargo.toml", "[workspace]\nmembers = [\"core\", \"cli\", \"examples/demo\"]\n")
	writeFile(t, root, "core/Cargo.toml", "[package]\nname = \"core\"\n\n[lib]\nname = \"core\"\n")
	writeFile(t, root, "core/src/lib.rs", "pub fn add(a: i32, b: i32) -> i32 { a + b }\n")
	writeFile(t, root, "cli/Cargo.toml", "[package]\nname = \"cli\"\n\n[[bin]]\nname = \"cli\"\n")
	writeFile(t, root, "cli/src/main.rs", "fn main() {}\n")
	writeFile(t, root, "examples/demo/Cargo.toml", "[package]\nname = \"demo\"\n\n[[example]]\nname = \"demo\"\n")
	writeFile(t, root, "examples/demo/examples/demo.rs", "fn main() {}\n")

	units, err := New().DetectUnits(context.Background(), root)
	if err != nil {
		t.Fatal(err)
	}
	byRoot := map[string]string{}
	byName := map[string]string{}
	for _, unit := range units {
		rel, _ := filepath.Rel(root, unit.Root)
		byRoot[filepath.ToSlash(rel)] = unit.Kind
		byName[filepath.ToSlash(rel)] = unit.Name
	}
	if len(units) != 4 {
		t.Fatalf("units = %+v", units)
	}
	if byRoot["."] != "cargo-workspace" {
		t.Fatalf("root must be the workspace: %+v", units)
	}
	for member, name := range map[string]string{"core": "core", "cli": "cli", "examples/demo": "demo"} {
		if byRoot[member] != "cargo-package" || byName[member] != name {
			t.Fatalf("member %s = kind %q name %q", member, byRoot[member], byName[member])
		}
	}
}

func TestDetectCrateWithBuildScriptAndProcMacroStaysStatic(t *testing.T) {
	root := t.TempDir()
	// build.rs eseguirebbe `rustc --version`; la detection non deve eseguirlo.
	writeFile(t, root, "Cargo.toml", "[package]\nname = \"proc\"\n\n[lib]\nproc-macro = true\n")
	writeFile(t, root, "build.rs", "fn main() { panic!(\"build.rs must not run during detection\") }\n")
	writeFile(t, root, "src/lib.rs", "#[proc_macro]\npub fn make(item: proc_macro::TokenStream) -> proc_macro::TokenStream { item }\n")

	units, err := New().DetectUnits(context.Background(), root)
	if err != nil {
		t.Fatal(err)
	}
	if len(units) != 1 || units[0].Name != "proc" {
		t.Fatalf("units = %+v", units)
	}
	// readManifest legge [lib] proc-macro senza eseguire build.rs.
	manifest := readManifest(root)
	if !manifest.IsPackage || !manifest.Lib {
		t.Fatalf("manifest = %+v", manifest)
	}
}
