package goide

import (
	"os"
	"path/filepath"
	"testing"
)

func TestFuzzCorpusListReadPromoteDelete(t *testing.T) {
	root := t.TempDir()
	cache := t.TempDir()
	t.Setenv("GOCACHE", cache)
	writeFixtureFile(t, root, "go.mod", "module example.com/fz\n\ngo 1.22\n")
	writeFixtureFile(t, root, "parse/parse_test.go", "package parse\n\nimport \"testing\"\n\nfunc FuzzParse(f *testing.F) {\n\tf.Fuzz(func(t *testing.T, s string, n int) {})\n}\n")
	crash := "go test fuzz v1\nstring(\"\\xff\")\nint(-1)\n"
	writeFixtureFile(t, root, "parse/testdata/fuzz/FuzzParse/0123abcd", crash)
	generated := filepath.Join(cache, "fuzz", "example.com", "fz", "parse", "FuzzParse")
	if err := os.MkdirAll(generated, 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(generated, "feedbeef"), []byte("go test fuzz v1\nstring(\"a\")\nint(2)\n"), 0o644); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(generated, "dup"), []byte(crash), 0o644); err != nil {
		t.Fatal(err)
	}

	service := NewService(&memoryStore{}, nil)
	t.Cleanup(service.Shutdown)
	session, err := service.OpenProject(root)
	if err != nil {
		t.Fatal(err)
	}
	id := string(session.ID)
	targets, err := service.ListFuzzTargets(id)
	if err != nil || len(targets) != 1 {
		t.Fatalf("targets %+v, err %v", targets, err)
	}
	target := targets[0]
	if target.Name != "FuzzParse" || target.PackageDir != "parse" || target.ImportPath != "example.com/fz/parse" || target.Line != 5 {
		t.Fatalf("unexpected target %+v", target)
	}
	if len(target.Seeds) != 1 || target.CachedTotal != 2 {
		t.Fatalf("corpus: seeds %+v cached %+v", target.Seeds, target.Cached)
	}
	duplicates := 0
	for _, input := range target.Cached {
		if input.Duplicate != "" {
			duplicates++
		}
	}
	if duplicates != 1 {
		t.Fatalf("expected the cached copy of the crash to be a duplicate: %+v", target.Cached)
	}

	content, err := service.ReadFuzzInput(id, "parse", "FuzzParse", "testdata", "0123abcd")
	if err != nil || content.Error != "" || len(content.Values) != 2 || content.Values[0].Expression != `string("\xff")` || content.Values[1].Type != "int" {
		t.Fatalf("read %+v err %v", content, err)
	}
	for _, bad := range []string{"../go.mod", `..\go.mod`, ""} {
		if _, err := service.ReadFuzzInput(id, "parse", "FuzzParse", "testdata", bad); err == nil {
			t.Fatalf("accepted input name %q", bad)
		}
	}
	if _, err := service.ReadFuzzInput(id, "../..", "FuzzParse", "testdata", "x"); err == nil {
		t.Fatal("accepted a package outside the project")
	}

	if _, err := service.PromoteFuzzInput(id, "parse", "FuzzParse", "feedbeef"); err == nil {
		t.Fatal("promoted without tool authorization")
	}
	if _, err := service.SetToolAuthorization(id, true); err != nil {
		t.Fatal(err)
	}
	promoted, err := service.PromoteFuzzInput(id, "parse", "FuzzParse", "feedbeef")
	if err != nil || promoted != "parse/testdata/fuzz/FuzzParse/feedbeef" {
		t.Fatalf("promote %q err %v", promoted, err)
	}
	if err := service.DeleteFuzzInput(id, "parse", "FuzzParse", "cache", "feedbeef"); err != nil {
		t.Fatal(err)
	}
	targets, _ = service.ListFuzzTargets(id)
	if len(targets[0].Seeds) != 2 || targets[0].CachedTotal != 1 {
		t.Fatalf("after promote/delete: %+v", targets[0])
	}
}
