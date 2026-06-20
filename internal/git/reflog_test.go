package git

import (
	"path/filepath"
	"testing"
)

func TestUndoToReflog_RestoresStateBeforeReset(t *testing.T) {
	gitAvailable(t)
	dir := filepath.Join(t.TempDir(), "repo")
	if err := Init(Config{RepoPath: dir, Branch: "main", AuthorName: "T", AuthorEmail: "t@e.com"}); err != nil {
		t.Fatal(err)
	}
	writeFile(t, filepath.Join(dir, "f.txt"), "one")
	if _, err := CommitAll(dir, "one"); err != nil {
		t.Fatal(err)
	}
	writeFile(t, filepath.Join(dir, "f.txt"), "two")
	second, err := CommitAll(dir, "two")
	if err != nil {
		t.Fatal(err)
	}
	if _, err := runGit(dir, "reset", "--hard", "HEAD~1"); err != nil {
		t.Fatal(err)
	}

	entries, err := Reflog(dir, 10)
	if err != nil || len(entries) < 2 {
		t.Fatalf("Reflog: %v entries=%v", err, entries)
	}
	if entries[1].Hash[:7] != second.Hash {
		t.Fatalf("expected previous HEAD %s, got %+v", second.Hash, entries[1])
	}
	res := UndoToReflog(dir, "HEAD@{1}", "hard")
	if !res.Success {
		t.Fatalf("UndoToReflog: %+v", res)
	}
	head, _ := runGit(dir, "rev-parse", "--short", "HEAD")
	if head != second.Hash {
		t.Fatalf("expected restored HEAD %s, got %s", second.Hash, head)
	}
}
