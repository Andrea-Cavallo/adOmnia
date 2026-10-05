package golang

import (
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func TestPackageDocs(t *testing.T) {
	root := t.TempDir()
	write := func(name, content string) {
		path := filepath.Join(root, filepath.FromSlash(name))
		if err := os.MkdirAll(filepath.Dir(path), 0o755); err != nil {
			t.Fatal(err)
		}
		if err := os.WriteFile(path, []byte(content), 0o644); err != nil {
			t.Fatal(err)
		}
	}
	write("shop/shop.go", `// Package shop sells things.
package shop

// Store keeps orders.
type Store struct{}

// NewStore creates a store.
func NewStore() *Store { return &Store{} }

func (s *Store) Save() error { return nil }

// this comment does not start with the name
func Load() {}

type (
	// Order is an order.
	Order struct{}
	Item  struct{}
)

// BUG(andrea): totals ignore taxes.
const Limit = 3
`)
	write("shop/shop_test.go", "package shop\n\nfunc TestHelper() {}\n")
	write("tools/gen.go", "//go:build ignore\n\npackage main\n\nfunc main() {}\n")
	write("internal/util/util.go", "package util\n\nfunc Helper() {}\n")

	docs := PackageDocs(root, func(dir string) string {
		rel, _ := filepath.Rel(root, dir)
		return "example.com/" + filepath.ToSlash(rel)
	})
	if len(docs) != 2 || docs[0].ImportPath != "example.com/internal/util" || docs[1].Name != "shop" {
		t.Fatalf("packages: %+v", docs)
	}
	shop := docs[1]
	if shop.Synopsis != "Package shop sells things." || len(shop.Types) != 3 || len(shop.Funcs) != 1 || len(shop.Consts) != 1 {
		t.Fatalf("shop docs: synopsis %q types %d funcs %d consts %d", shop.Synopsis, len(shop.Types), len(shop.Funcs), len(shop.Consts))
	}
	if !strings.Contains(shop.Types[2].Decl, "type Store struct{}") || len(shop.Types[2].Funcs) != 1 || len(shop.Types[2].Methods) != 1 {
		t.Fatalf("store: %+v", shop.Types[2])
	}
	if len(shop.Notes["BUG"]) != 1 {
		t.Fatalf("notes: %+v", shop.Notes)
	}
	problems := []string{}
	for _, problem := range shop.Problems {
		problems = append(problems, problem.Kind+" "+problem.Name+": "+problem.Problem)
	}
	want := "func Load: The comment should start with Load|type Item: Missing documentation|method Store.Save: Missing documentation"
	if strings.Join(problems, "|") != want {
		t.Fatalf("problems:\n%s", strings.Join(problems, "\n"))
	}
	source, _ := os.ReadFile(filepath.Join(root, "shop", "shop.go"))
	for _, problem := range shop.Problems {
		if problem.Name == "Item" {
			edit := problem.Fix.Edits[0]
			fixed := string(source[:edit.Offset]) + edit.Text + string(source[edit.End:])
			if !strings.Contains(fixed, "\t// Order is an order.\n\tOrder struct{}\n\t// Item \n\tItem  struct{}") {
				t.Fatalf("stub not placed above the spec:\n%s", fixed)
			}
		}
	}
	util := docs[0]
	if len(util.Problems) != 2 || util.Problems[0].Kind != "package" {
		t.Fatalf("util problems: %+v", util.Problems)
	}
}
