package rust

import (
	"os"
	"path/filepath"
	"testing"
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

func TestReadManifestPackage(t *testing.T) {
	root := t.TempDir()
	writeFile(t, root, "Cargo.toml", "[package]\nname = \"orders\"\nversion = \"0.1.0\"\nedition = \"2021\"\ndefault-run = \"server\"\n\n[features]\ndefault = [\"tls\"]\ntls = []\n\n[[bin]]\nname = \"server\"\n\n[[bin]]\nname = \"cli\"\n\n[[example]]\nname = \"demo\"\n")
	manifest := readManifest(root)
	if !manifest.IsPackage || manifest.Name != "orders" || manifest.DefaultRun != "server" {
		t.Fatalf("%+v", manifest)
	}
	if len(manifest.Bins) != 2 || manifest.Bins[0] != "server" || manifest.Bins[1] != "cli" {
		t.Fatalf("bins = %#v", manifest.Bins)
	}
	if len(manifest.Examples) != 1 || manifest.Examples[0] != "demo" {
		t.Fatalf("examples = %#v", manifest.Examples)
	}
	if len(manifest.Features) != 2 || manifest.Features[0] != "default" {
		t.Fatalf("features = %#v", manifest.Features)
	}
}

func TestReadManifestVirtualWorkspace(t *testing.T) {
	root := t.TempDir()
	writeFile(t, root, "Cargo.toml", "[workspace]\nmembers = [\"crates/*\", \"apps/api\"]\nexclude = [\"crates/legacy\"]\ndefault-members = [\"apps/api\"]\n\n[workspace.dependencies]\nserde = { version = \"1\", features = [\"derive\"] }\n")
	manifest := readManifest(root)
	if manifest.IsPackage {
		t.Fatalf("virtual workspace must not be a package: %+v", manifest)
	}
	if !manifest.HasWorkspace || !manifest.WorkspaceDeps {
		t.Fatalf("%+v", manifest)
	}
	if len(manifest.Members) != 2 || manifest.Members[0] != "crates/*" {
		t.Fatalf("members = %#v", manifest.Members)
	}
	if len(manifest.Exclude) != 1 || manifest.Exclude[0] != "crates/legacy" {
		t.Fatalf("exclude = %#v", manifest.Exclude)
	}
}

func TestReadManifestRootPackageIsNotAVirtualWorkspace(t *testing.T) {
	root := t.TempDir()
	writeFile(t, root, "Cargo.toml", "[package]\nname = \"root\"\n\n[workspace]\nmembers = [\"crates/lib\"]\n\n[dependencies]\ntokio = { version = \"1\", features = [\"full\"] }\n")
	manifest := readManifest(root)
	if !manifest.IsPackage || !manifest.HasWorkspace || manifest.Name != "root" {
		t.Fatalf("%+v", manifest)
	}
	if len(manifest.Dependencies) != 1 || manifest.Dependencies[0] != "tokio" {
		t.Fatalf("dependencies = %#v", manifest.Dependencies)
	}
}

func TestReadManifestMissingOrMalformedIsEmpty(t *testing.T) {
	root := t.TempDir()
	if manifest := readManifest(root); manifest.IsPackage || manifest.HasWorkspace {
		t.Fatalf("missing manifest: %+v", manifest)
	}
	writeFile(t, root, "Cargo.toml", "[package\nname = 'rotto'\nquesta riga non va\n")
	manifest := readManifest(root)
	if manifest.IsPackage || manifest.HasWorkspace {
		t.Fatalf("malformed manifest must not claim a package: %+v", manifest)
	}
}
