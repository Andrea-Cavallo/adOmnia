package git

import (
	"os"
	"path/filepath"
	"testing"
)

func TestAddWorktreeFromStartsAtTheChosenCommitAndFingerprintTracksContent(t *testing.T) {
	gitAvailable(t)
	dir := filepath.Join(t.TempDir(), "repo")
	if err := Init(Config{RepoPath: dir, Branch: "main", AuthorName: "T", AuthorEmail: "t@e.com"}); err != nil {
		t.Fatal(err)
	}
	writeFile(t, filepath.Join(dir, "f.txt"), "one")
	if _, err := CommitAll(dir, "first"); err != nil {
		t.Fatal(err)
	}
	base, err := GetCommitMeta(dir, "HEAD")
	if err != nil {
		t.Fatal(err)
	}
	// Un commit successivo nel repository principale non deve entrare nel worktree.
	writeFile(t, filepath.Join(dir, "f.txt"), "two")
	if _, err := CommitAll(dir, "second"); err != nil {
		t.Fatal(err)
	}
	worktree := filepath.Join(t.TempDir(), "agent-tree")
	if err := AddWorktreeFrom(dir, worktree, "adomnia/task-abc", base.FullHash); err != nil {
		t.Fatalf("AddWorktreeFrom: %v", err)
	}
	t.Cleanup(func() { _ = RemoveWorktree(dir, worktree, true) })
	raw, err := os.ReadFile(filepath.Join(worktree, "f.txt"))
	if err != nil || string(raw) != "one" {
		t.Fatalf("worktree content = %q (%v), want the chosen commit", raw, err)
	}

	clean, changed, err := WorkingTreeFingerprint(worktree, base.FullHash)
	if err != nil || changed != 0 {
		t.Fatalf("clean fingerprint: %v %d", err, changed)
	}
	writeFile(t, filepath.Join(worktree, "f.txt"), "three")
	writeFile(t, filepath.Join(worktree, "new.txt"), "new")
	dirty, changed, err := WorkingTreeFingerprint(worktree, base.FullHash)
	if err != nil || changed != 2 {
		t.Fatalf("dirty fingerprint: %v %d", err, changed)
	}
	if dirty == clean {
		t.Fatal("fingerprint did not change with the content")
	}
}
