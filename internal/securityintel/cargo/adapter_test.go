package cargo

import (
	"context"
	"os"
	"path/filepath"
	"testing"

	"adomnia/internal/securityintel"
)

func writeFile(t *testing.T, root, name, content string) string {
	t.Helper()
	path := filepath.Join(root, filepath.FromSlash(name))
	if err := os.MkdirAll(filepath.Dir(path), 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(path, []byte(content), 0o644); err != nil {
		t.Fatal(err)
	}
	return path
}

func TestDiscoverFindsCargoLockOwners(t *testing.T) {
	root := t.TempDir()
	writeFile(t, root, "Cargo.toml", "[package]\nname = \"app\"\n")
	writeFile(t, root, "Cargo.lock", "version = 3\n")
	writeFile(t, root, "crates/a/Cargo.toml", "[package]\nname = \"a\"\n") // membro senza lock: non target
	writeFile(t, root, "target/debug/Cargo.toml", "[package]\nname = \"ghost\"\n")
	writeFile(t, root, "target/debug/Cargo.lock", "version = 3\n")

	targets, err := New().Discover(context.Background(), root)
	if err != nil {
		t.Fatal(err)
	}
	if len(targets) != 1 || targets[0].Name != "app" {
		t.Fatalf("targets = %+v", targets)
	}
}

func TestResolveParsesCargoLockRegistryPackages(t *testing.T) {
	root := t.TempDir()
	writeFile(t, root, "Cargo.toml", "[package]\nname = \"app\"\n\n[dependencies]\nserde = \"1\"\n")
	writeFile(t, root, "Cargo.lock", `version = 3

[[package]]
name = "serde"
version = "1.0.219"
source = "registry+https://github.com/rust-lang/crates.io-index"

[[package]]
name = "serde_core"
version = "0.1.0"
source = "registry+https://github.com/rust-lang/crates.io-index"

[[package]]
name = "app"
version = "0.1.0"
`)
	target := securityintel.Target{Ecosystem: securityintel.EcosystemCargo, Root: root, Manifest: filepath.Join(root, "Cargo.toml")}
	resolution, err := New().Resolve(context.Background(), target, securityintel.DefaultResolveOptions())
	if err != nil {
		t.Fatal(err)
	}
	byName := map[string]securityintel.Component{}
	for _, c := range resolution.Components {
		byName[c.Name] = c
	}
	if len(resolution.Components) != 2 {
		t.Fatalf("components = %+v", resolution.Components)
	}
	if byName["serde"].Version != "1.0.219" || !byName["serde"].Direct || byName["serde"].Origin != securityintel.OriginDeclared {
		t.Fatalf("serde = %+v", byName["serde"])
	}
	if byName["serde_core"].Direct || byName["serde_core"].Origin != securityintel.OriginTransitive {
		t.Fatalf("serde_core = %+v", byName["serde_core"])
	}
	// Il workspace member "app" (senza source) non è un pacchetto crates.io.
	if _, ok := byName["app"]; ok {
		t.Fatalf("workspace member must not be a component: %+v", byName)
	}
}
