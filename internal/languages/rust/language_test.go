package rust

import "testing"

func TestDocumentSelectorRecognizesRustFiles(t *testing.T) {
	language := New()
	for _, path := range []string{"src/main.rs", "lib.rs", "tests/integration.rs", "a/b/c.RS"} {
		if id, ok := language.DocumentLanguageID(path); !ok || id != "rust" {
			t.Fatalf("DocumentLanguageID(%q) = %q, %v", path, id, ok)
		}
	}
	for path, want := range map[string]string{"Cargo.toml": "toml", "Cargo.lock": "toml", "crates/x/Cargo.toml": "toml"} {
		if id, ok := language.DocumentLanguageID(path); !ok || id != want {
			t.Fatalf("DocumentLanguageID(%q) = %q, %v; want %q", path, id, ok, want)
		}
	}
	for _, path := range []string{"main.py", "README.md", "go.mod", "Cargo.toml.bak", "src/main.rs.txt"} {
		if _, ok := language.DocumentLanguageID(path); ok {
			t.Fatalf("DocumentLanguageID(%q) must not claim the file", path)
		}
	}
}

func TestIdentity(t *testing.T) {
	language := New()
	if language.ID() != "rust" || language.Name() != "Rust" {
		t.Fatalf("identity = %q %q", language.ID(), language.Name())
	}
}
