package git

import (
	"path/filepath"
	"strings"
	"testing"
)

func TestChangesDiff_Scopes(t *testing.T) {
	gitAvailable(t)
	dir := filepath.Join(t.TempDir(), "repo")
	if err := Init(Config{RepoPath: dir, Branch: "main", AuthorName: "T", AuthorEmail: "t@e.com"}); err != nil {
		t.Fatal(err)
	}
	file := filepath.Join(dir, "f.txt")
	writeFile(t, file, "base\n")
	if _, err := CommitAll(dir, "base"); err != nil {
		t.Fatal(err)
	}
	if _, err := runGit(dir, "checkout", "-b", "feature"); err != nil {
		t.Fatal(err)
	}
	writeFile(t, file, "staged\n")
	if err := StageFile(dir, "f.txt"); err != nil {
		t.Fatal(err)
	}

	staged, err := ChangesDiff(dir, "staged", "")
	if err != nil || !strings.Contains(staged, "+staged") {
		t.Fatalf("staged diff: err=%v diff=%q", err, staged)
	}
	working, err := ChangesDiff(dir, "working", "")
	if err != nil || !strings.Contains(working, "+staged") {
		t.Fatalf("working diff: err=%v diff=%q", err, working)
	}
	if _, err := Commit(dir, "feature change"); err != nil {
		t.Fatal(err)
	}
	branch, err := ChangesDiff(dir, "branch", "main")
	if err != nil || !strings.Contains(branch, "+staged") {
		t.Fatalf("branch diff: err=%v diff=%q", err, branch)
	}
}
