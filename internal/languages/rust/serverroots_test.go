package rust

import (
	"context"
	"path/filepath"
	"reflect"
	"testing"
)

// Un workspace Cargo con 37 membri è UN language server, non 37: rust-analyzer carica il grafo del
// workspace intero, quindi un processo per crate moltiplicava per 37 memoria, CPU e cargo metadata.
func TestServerRootsCollapseWorkspaceMembers(t *testing.T) {
	root := t.TempDir()
	writeFile(t, root, "Cargo.toml", "[workspace]\nmembers = [\"crates/*\", \"apps/*\"]\n")
	writeFile(t, root, "crates/alpha/Cargo.toml", "[package]\nname = \"alpha\"\n")
	writeFile(t, root, "crates/beta/Cargo.toml", "[package]\nname = \"beta\"\n")
	writeFile(t, root, "apps/cli/Cargo.toml", "[package]\nname = \"cli\"\n")

	units, err := New().DetectUnits(context.Background(), root)
	if err != nil {
		t.Fatal(err)
	}
	if len(units) != 4 {
		t.Fatalf("units = %+v", units)
	}
	roots := New().ServerRoots(root, units)
	if want := []string{filepath.Clean(root)}; !reflect.DeepEqual(roots, want) {
		t.Fatalf("server roots = %v, want %v", roots, want)
	}
}

// Un package che è anche radice del workspace (stesso Cargo.toml con [package] e [workspace]) copre i
// membri: non deve restare un server per membro.
func TestServerRootsRootPackageWorkspace(t *testing.T) {
	root := t.TempDir()
	writeFile(t, root, "Cargo.toml", "[package]\nname = \"root\"\n\n[workspace]\nmembers = [\"crates/*\"]\n")
	writeFile(t, root, "crates/lib/Cargo.toml", "[package]\nname = \"lib\"\n")

	units, err := New().DetectUnits(context.Background(), root)
	if err != nil {
		t.Fatal(err)
	}
	roots := New().ServerRoots(root, units)
	if want := []string{filepath.Clean(root)}; !reflect.DeepEqual(roots, want) {
		t.Fatalf("server roots = %v, want %v", roots, want)
	}
}

// Crate indipendenti (senza workspace in nessun antenato) restano radici proprie: ognuno ha il suo
// grafo e nessun server li copre insieme.
func TestServerRootsKeepIndependentCrates(t *testing.T) {
	root := t.TempDir()
	writeFile(t, root, "standalone/Cargo.toml", "[package]\nname = \"standalone\"\n")
	writeFile(t, root, "mono/Cargo.toml", "[workspace]\nmembers = [\"member\"]\n")
	writeFile(t, root, "mono/member/Cargo.toml", "[package]\nname = \"member\"\n")
	writeFile(t, root, "crates/fuzz/Cargo.toml", "[package]\nname = \"fuzz\"\n\n[workspace]\n")
	writeFile(t, root, "crates/fuzz/target/Cargo.toml", "[package]\nname = \"ghost\"\n")

	units, err := New().DetectUnits(context.Background(), root)
	if err != nil {
		t.Fatal(err)
	}
	roots := New().ServerRoots(root, units)
	want := []string{
		filepath.Join(root, "crates", "fuzz"),
		filepath.Join(root, "mono"),
		filepath.Join(root, "standalone"),
	}
	if !reflect.DeepEqual(roots, want) {
		t.Fatalf("server roots = %v, want %v", roots, want)
	}
}

// Un Cargo.toml con il proprio [workspace] dentro un altro workspace (una fuzz target, un esempio di
// plugin) non è un progetto indipendente: lo serve il server del workspace esterno, altrimenti ogni
// sotto-cartella ricarica lo stesso grafo.
func TestServerRootsNestedWorkspaceUsesOuterWorkspace(t *testing.T) {
	root := t.TempDir()
	writeFile(t, root, "Cargo.toml", "[workspace]\nmembers = [\"crates/*\"]\n")
	writeFile(t, root, "crates/alpha/Cargo.toml", "[package]\nname = \"alpha\"\n")
	writeFile(t, root, "crates/alpha/fuzz/Cargo.toml", "[package]\nname = \"alpha-fuzz\"\n\n[workspace]\n")
	writeFile(t, root, "examples/plugin/Cargo.toml", "[package]\nname = \"plugin\"\n")

	units, err := New().DetectUnits(context.Background(), root)
	if err != nil {
		t.Fatal(err)
	}
	roots := New().ServerRoots(root, units)
	if want := []string{filepath.Clean(root)}; !reflect.DeepEqual(roots, want) {
		t.Fatalf("server roots = %v, want %v", roots, want)
	}
}

// Senza unità il linguaggio non ha server da raggruppare: il core resta con la radice del progetto.
func TestServerRootsWithoutUnits(t *testing.T) {
	if roots := New().ServerRoots(t.TempDir(), nil); len(roots) != 0 {
		t.Fatalf("server roots = %v, want none", roots)
	}
}
