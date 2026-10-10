package graph

import (
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"
)

func TestFingerprintFollowsSourcesAndStoreRoundTrips(t *testing.T) {
	root := t.TempDir()
	write := func(name, text string) {
		path := filepath.Join(root, filepath.FromSlash(name))
		_ = os.MkdirAll(filepath.Dir(path), 0o755)
		if err := os.WriteFile(path, []byte(text), 0o600); err != nil {
			t.Fatal(err)
		}
	}
	isGo := func(rel string) bool { return strings.HasSuffix(rel, ".go") }
	write("a.go", "package a")
	write("node_modules/x.go", "package x")
	first, _ := Fingerprint(root, isGo)
	write("README.md", "docs")
	write("node_modules/y.go", "package y")
	if second, _ := Fingerprint(root, isGo); second != first {
		t.Fatal("non-source and skipped files must not change the fingerprint")
	}
	write("b.go", "package a")
	if third, _ := Fingerprint(root, isGo); third == first {
		t.Fatal("a new source file must change the fingerprint")
	}

	b := NewBuilder()
	b.Node(Node{ID: "fn:a", Kind: KindFunction, Label: "a"})
	b.Node(Node{ID: "fn:b", Kind: KindTest, Label: "TestB"})
	b.Edge("fn:b", "fn:a", EdgeCalls, "")
	b.Edge("fn:b", "fn:missing", EdgeCalls, "")
	g := b.Graph()
	g.Root, g.Language, g.Fingerprint, g.BuiltAt = root, "go", first, time.Now()
	store := NewStore(t.TempDir())
	if err := store.Save(g); err != nil {
		t.Fatal(err)
	}
	loaded, ok := store.Load(root, "go")
	if !ok || len(loaded.Nodes) != 2 || len(loaded.Edges) != 1 || loaded.Fingerprint != first {
		t.Fatalf("round trip: %+v", loaded)
	}
	if _, ok := store.Load(root, "rust"); ok {
		t.Fatal("graphs are per language")
	}
}
