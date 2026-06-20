package git

import (
	"path/filepath"
	"strings"
	"testing"
)

func TestStashApplyAndShow(t *testing.T) {
	gitAvailable(t)
	dir := filepath.Join(t.TempDir(), "repo")
	if err := Init(Config{RepoPath: dir, Branch: "main", AuthorName: "T", AuthorEmail: "t@e.com"}); err != nil {
		t.Fatalf("Init: %v", err)
	}
	writeFile(t, filepath.Join(dir, "f.txt"), "one\n")
	if _, err := CommitAll(dir, "init"); err != nil {
		t.Fatalf("CommitAll: %v", err)
	}
	writeFile(t, filepath.Join(dir, "f.txt"), "one\ntwo\n")

	if err := Stash(dir); err != nil {
		t.Fatalf("Stash: %v", err)
	}
	st, err := GetStatus(dir)
	if err != nil {
		t.Fatalf("GetStatus: %v", err)
	}
	if st.Dirty {
		t.Fatalf("working tree should be clean after stash")
	}

	patch, err := StashShow(dir, "stash@{0}")
	if err != nil {
		t.Fatalf("StashShow: %v", err)
	}
	if !strings.Contains(patch, "two") {
		t.Fatalf("stash patch should contain the stashed change, got %q", patch)
	}

	// Apply (not pop): change comes back, stash stays.
	if err := StashApply(dir, "stash@{0}"); err != nil {
		t.Fatalf("StashApply: %v", err)
	}
	st, _ = GetStatus(dir)
	if !st.Dirty {
		t.Fatalf("working tree should be dirty after apply")
	}
	if out, _ := runGit(dir, "stash", "list"); !strings.Contains(out, "stash@{0}") {
		t.Fatalf("apply must keep the stash, list=%q", out)
	}
}

func TestStashPaths_LeavesUnselectedChanges(t *testing.T) {
	gitAvailable(t)
	dir := filepath.Join(t.TempDir(), "repo")
	if err := Init(Config{RepoPath: dir, Branch: "main", AuthorName: "T", AuthorEmail: "t@e.com"}); err != nil {
		t.Fatalf("Init: %v", err)
	}
	writeFile(t, filepath.Join(dir, "a.txt"), "a1\n")
	writeFile(t, filepath.Join(dir, "b.txt"), "b1\n")
	if _, err := CommitAll(dir, "init"); err != nil {
		t.Fatalf("CommitAll: %v", err)
	}
	writeFile(t, filepath.Join(dir, "a.txt"), "a2\n")
	writeFile(t, filepath.Join(dir, "b.txt"), "b2\n")

	if err := StashPaths(dir, []string{"a.txt"}); err != nil {
		t.Fatalf("StashPaths: %v", err)
	}
	st, err := GetStatus(dir)
	if err != nil {
		t.Fatalf("GetStatus: %v", err)
	}
	if len(st.Modified) != 1 || st.Modified[0] != "b.txt" {
		t.Fatalf("expected only b.txt to remain modified, got %v", st.Modified)
	}
	patch, err := StashShow(dir, "stash@{0}")
	if err != nil || !strings.Contains(patch, "a2") || strings.Contains(patch, "b2") {
		t.Fatalf("selected stash contains wrong changes: err=%v patch=%q", err, patch)
	}
}

func TestDeleteLocalBranch(t *testing.T) {
	gitAvailable(t)
	dir := filepath.Join(t.TempDir(), "repo")
	if err := Init(Config{RepoPath: dir, Branch: "main", AuthorName: "T", AuthorEmail: "t@e.com"}); err != nil {
		t.Fatalf("Init: %v", err)
	}
	writeFile(t, filepath.Join(dir, "f.txt"), "x")
	if _, err := CommitAll(dir, "init"); err != nil {
		t.Fatalf("CommitAll: %v", err)
	}
	if err := CreateBranch(dir, "tmp"); err != nil {
		t.Fatalf("CreateBranch: %v", err)
	}
	if err := DeleteLocalBranch(dir, "tmp", false); err != nil {
		t.Fatalf("DeleteLocalBranch: %v", err)
	}
	if out, _ := runGit(dir, "branch", "--list", "tmp"); strings.TrimSpace(out) != "" {
		t.Fatalf("branch tmp should be gone, got %q", out)
	}
}

func TestRemoteBranchLifecycle(t *testing.T) {
	gitAvailable(t)
	remote := filepath.Join(t.TempDir(), "remote.git")
	if _, err := runGit(t.TempDir(), "init", "--bare", remote); err != nil {
		t.Fatalf("init bare: %v", err)
	}
	dir := filepath.Join(t.TempDir(), "repo")
	if err := Init(Config{RepoPath: dir, Branch: "main", AuthorName: "T", AuthorEmail: "t@e.com"}); err != nil {
		t.Fatalf("Init: %v", err)
	}
	if err := AddRemote(dir, "origin", remote); err != nil {
		t.Fatalf("AddRemote: %v", err)
	}
	writeFile(t, filepath.Join(dir, "f.txt"), "x")
	if _, err := CommitAll(dir, "init"); err != nil {
		t.Fatalf("CommitAll: %v", err)
	}
	if err := Push(dir, "main"); err != nil {
		t.Fatalf("Push main: %v", err)
	}
	// Upstream tracking can now point at origin/main.
	if err := SetUpstream(dir, "main", "origin/main"); err != nil {
		t.Fatalf("SetUpstream: %v", err)
	}

	// Push a feature branch, then delete it on the remote.
	if err := CreateAndCheckoutBranch(dir, "feature"); err != nil {
		t.Fatalf("CreateAndCheckoutBranch: %v", err)
	}
	if err := Push(dir, "feature"); err != nil {
		t.Fatalf("Push feature: %v", err)
	}
	if out, _ := runGit(dir, "ls-remote", "--heads", "origin", "feature"); !strings.Contains(out, "feature") {
		t.Fatalf("feature should exist on remote, got %q", out)
	}
	if err := DeleteRemoteBranch(dir, "origin", "feature"); err != nil {
		t.Fatalf("DeleteRemoteBranch: %v", err)
	}
	if out, _ := runGit(dir, "ls-remote", "--heads", "origin", "feature"); strings.TrimSpace(out) != "" {
		t.Fatalf("feature should be deleted on remote, got %q", out)
	}
}
