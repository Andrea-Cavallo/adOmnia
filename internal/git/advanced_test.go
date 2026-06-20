package git

import (
	"os"
	"path/filepath"
	"testing"
)

func TestWorktreeLifecycle(t *testing.T) {
	gitAvailable(t)
	dir := filepath.Join(t.TempDir(), "repo")
	if err := Init(Config{RepoPath: dir, Branch: "main", AuthorName: "T", AuthorEmail: "t@e.com"}); err != nil {
		t.Fatal(err)
	}
	writeFile(t, filepath.Join(dir, "f.txt"), "x")
	if _, err := CommitAll(dir, "init"); err != nil {
		t.Fatal(err)
	}
	worktree := filepath.Join(t.TempDir(), "feature-tree")
	if err := AddWorktree(dir, worktree, "feature", true); err != nil {
		t.Fatalf("AddWorktree: %v", err)
	}
	items, err := ListWorktrees(dir)
	if err != nil || len(items) != 2 {
		t.Fatalf("ListWorktrees: %v %+v", err, items)
	}
	if err := RemoveWorktree(dir, worktree, false); err != nil {
		t.Fatalf("RemoveWorktree: %v", err)
	}
}

func TestSparseCheckoutLifecycle(t *testing.T) {
	gitAvailable(t)
	dir := filepath.Join(t.TempDir(), "repo")
	if err := Init(Config{RepoPath: dir, Branch: "main", AuthorName: "T", AuthorEmail: "t@e.com"}); err != nil {
		t.Fatal(err)
	}
	if err := os.MkdirAll(filepath.Join(dir, "one"), 0755); err != nil {
		t.Fatal(err)
	}
	if err := os.MkdirAll(filepath.Join(dir, "two"), 0755); err != nil {
		t.Fatal(err)
	}
	writeFile(t, filepath.Join(dir, "one", "a.txt"), "a")
	writeFile(t, filepath.Join(dir, "two", "b.txt"), "b")
	if _, err := CommitAll(dir, "init"); err != nil {
		t.Fatal(err)
	}
	if err := SetSparseCheckout(dir, []string{"one"}, true); err != nil {
		t.Fatalf("SetSparseCheckout: %v", err)
	}
	paths, err := SparseCheckoutList(dir)
	if err != nil || len(paths) != 1 || paths[0] != "one" {
		t.Fatalf("SparseCheckoutList: %v %v", err, paths)
	}
	if err := DisableSparseCheckout(dir); err != nil {
		t.Fatalf("DisableSparseCheckout: %v", err)
	}
}

func TestSubmoduleLifecycle(t *testing.T) {
	gitAvailable(t)
	source := filepath.Join(t.TempDir(), "module")
	if err := Init(Config{RepoPath: source, Branch: "main", AuthorName: "T", AuthorEmail: "t@e.com"}); err != nil {
		t.Fatal(err)
	}
	writeFile(t, filepath.Join(source, "module.txt"), "module")
	if _, err := CommitAll(source, "module init"); err != nil {
		t.Fatal(err)
	}
	host := filepath.Join(t.TempDir(), "host")
	if err := Init(Config{RepoPath: host, Branch: "main", AuthorName: "T", AuthorEmail: "t@e.com"}); err != nil {
		t.Fatal(err)
	}
	writeFile(t, filepath.Join(host, "host.txt"), "host")
	if _, err := CommitAll(host, "host init"); err != nil {
		t.Fatal(err)
	}
	if err := AddSubmodule(host, source, "vendor/module", ""); err != nil {
		t.Fatalf("AddSubmodule: %v", err)
	}
	items, err := ListSubmodules(host)
	if err != nil || len(items) != 1 || items[0].Path != "vendor/module" {
		t.Fatalf("ListSubmodules: %v %+v", err, items)
	}
	if err := UpdateSubmodules(host, "vendor/module"); err != nil {
		t.Fatalf("UpdateSubmodules: %v", err)
	}
	if err := RemoveSubmodule(host, "vendor/module"); err != nil {
		t.Fatalf("RemoveSubmodule: %v", err)
	}
}
