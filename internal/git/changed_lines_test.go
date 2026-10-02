package git

import (
	"path/filepath"
	"reflect"
	"testing"
)

func TestChangedLinesSinceMergeBaseIncludesWorkingTree(t *testing.T) {
	gitAvailable(t)
	dir := filepath.Join(t.TempDir(), "repo")
	if err := Init(Config{RepoPath: dir, Branch: "main", AuthorName: "Alice", AuthorEmail: "alice@example.com"}); err != nil {
		t.Fatal(err)
	}
	writeFile(t, filepath.Join(dir, "a.go"), "package a\n\nfunc A() {}\n\nfunc B() {}\n")
	writeFile(t, filepath.Join(dir, "notes.txt"), "x\n")
	if _, err := CommitAll(dir, "initial"); err != nil {
		t.Fatal(err)
	}
	if _, err := runGit(dir, "checkout", "-q", "-b", "feature"); err != nil {
		t.Fatal(err)
	}
	// Commit sul branch: riga 3 cambiata; poi una modifica non committata in un file nuovo.
	writeFile(t, filepath.Join(dir, "a.go"), "package a\n\nfunc A() { println() }\n\nfunc B() {}\n")
	writeFile(t, filepath.Join(dir, "notes.txt"), "y\n")
	if _, err := CommitAll(dir, "change A"); err != nil {
		t.Fatal(err)
	}
	writeFile(t, filepath.Join(dir, "b.go"), "package sub\n\nfunc C() {}\n")
	if _, err := runGit(dir, "add", "b.go"); err != nil {
		t.Fatal(err)
	}
	got, err := ChangedLinesSince(dir, "main")
	if err != nil {
		t.Fatal(err)
	}
	want := map[string][]LineRange{"a.go": {{Start: 3, End: 3}}, "b.go": {{Start: 1, End: 3}}}
	if !reflect.DeepEqual(got, want) {
		t.Fatalf("righe cambiate: %+v, attese %+v", got, want)
	}
	if _, err := ChangedLinesSince(dir, "--output=x"); err == nil {
		t.Fatal("base che sembra un'opzione accettata")
	}
}
