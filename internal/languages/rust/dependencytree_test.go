package rust

import "testing"

const sampleLock = `
version = 3

[[package]]
name = "myapp"
version = "0.1.0"
dependencies = ["serde", "serde_json"]

[[package]]
name = "serde"
version = "1.0.219"
source = "registry+https://github.com/rust-lang/crates.io-index"
dependencies = ["serde_core"]

[[package]]
name = "serde_core"
version = "0.1.0"
source = "registry+https://github.com/rust-lang/crates.io-index"

[[package]]
name = "serde_json"
version = "1.0.140"
source = "registry+https://github.com/rust-lang/crates.io-index"
dependencies = ["serde", "itoa"]

[[package]]
name = "serde"
version = "1.0.100"
source = "registry+https://github.com/rust-lang/crates.io-index"

[[package]]
name = "itoa"
version = "1.0.15"
source = "registry+https://github.com/rust-lang/crates.io-index"
`

func TestParseCargoLockTree(t *testing.T) {
	tree := parseCargoLockTree([]byte(sampleLock))
	if len(tree) == 0 {
		t.Fatal("empty tree")
	}
	root := tree[0]
	if root.Depth != 0 || root.Name != "myapp" || root.Status != CargoTreeResolved {
		t.Fatalf("root = %+v", root)
	}
	// `serde` ha due versioni: ogni occorrenza è marcata duplicate.
	serde := 0
	for _, node := range tree {
		if node.Name == "serde" {
			if node.Status != CargoTreeDuplicate {
				t.Fatalf("serde node not marked duplicate: %+v", node)
			}
			serde++
		}
	}
	if serde == 0 {
		t.Fatal("serde not present")
	}
	// La prima occorrenza di serde (da myapp) è a profondità 1.
	var serdeDepth int
	for _, node := range tree {
		if node.Name == "serde" {
			serdeDepth = node.Depth
			break
		}
	}
	if serdeDepth != 1 {
		t.Fatalf("first serde depth = %d", serdeDepth)
	}
	// Le crate a versione singola restano resolved.
	for _, node := range tree {
		if node.Name == "serde_core" || node.Name == "itoa" {
			if node.Status != CargoTreeResolved {
				t.Fatalf("%s not resolved: %+v", node.Name, node)
			}
		}
	}
}

func TestCargoLockTreeMissingFile(t *testing.T) {
	if _, err := CargoLockTree(t.TempDir()); err == nil {
		t.Fatal("missing Cargo.lock must fail")
	}
}

func TestParseCargoLockTreeSingleCrate(t *testing.T) {
	tree := parseCargoLockTree([]byte("[[package]]\nname = \"solo\"\nversion = \"0.1.0\"\n"))
	if len(tree) != 1 || tree[0].Name != "solo" || tree[0].Depth != 0 {
		t.Fatalf("tree = %+v", tree)
	}
}
