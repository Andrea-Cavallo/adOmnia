package rust

import (
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func TestLooseCrateBuildsAGhostManifest(t *testing.T) {
	cache := t.TempDir()
	looseCacheRoot = func() string { return cache }
	t.Cleanup(func() { looseCacheRoot = func() string { return filepath.Join(os.TempDir(), "adomnia", "rust-scripts") } })

	root := t.TempDir()
	directory := filepath.Join(root, "fibonacci")
	if err := os.MkdirAll(directory, 0o700); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(directory, "fibonacci.rs"), []byte("fn main() {}\n"), 0o600); err != nil {
		t.Fatal(err)
	}

	manifest, bin, err := looseCrate(root, directory, "fibonacci.rs")
	if err != nil {
		t.Fatal(err)
	}
	if bin != "fibonacci" {
		t.Fatalf("bin = %q", bin)
	}
	content, err := os.ReadFile(manifest)
	if err != nil {
		t.Fatal(err)
	}
	for _, want := range []string{`name = "fibonacci"`, "[workspace]", "fibonacci.rs'"} {
		if !strings.Contains(string(content), want) {
			t.Fatalf("manifest misses %q:\n%s", want, content)
		}
	}
	args := cargoArguments("bin", Options{Bin: bin, manifest: manifest})
	if strings.Join(args[2:5], " ") != "--manifest-path "+manifest+" --bin" {
		t.Fatalf("args = %v", args)
	}
}

func TestLooseCrateRejectsEscapesAndBadNames(t *testing.T) {
	root := t.TempDir()
	outside := t.TempDir()
	if err := os.WriteFile(filepath.Join(outside, "x.rs"), []byte("fn main() {}"), 0o600); err != nil {
		t.Fatal(err)
	}
	if _, _, err := looseCrate(root, root, filepath.Join(outside, "x.rs")); err == nil {
		t.Fatal("a source outside the project must be refused")
	}
	for _, source := range []string{"", "--version.rs", "a.txt", "a'b.rs"} {
		if err := validSource(source); err == nil {
			t.Fatalf("%q must be refused", source)
		}
	}
	if got := looseBinName("p/1st try.rs"); got != "s_1st_try" {
		t.Fatalf("looseBinName = %q", got)
	}
}
