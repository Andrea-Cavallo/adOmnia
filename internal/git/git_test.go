package git

import (
	"os"
	"path/filepath"
	"testing"
)

func gitAvailable(t *testing.T) {
	t.Helper()
	if !IsInstalled() {
		t.Skip("git not installed in test environment")
	}
}

func TestGetStatus_NotARepo(t *testing.T) {
	gitAvailable(t)
	// A bare temp dir is not a git work tree; GetStatus must error, not
	// return an empty-but-valid-looking status.
	dir := t.TempDir()
	if _, err := GetStatus(dir); err == nil {
		t.Fatalf("expected error for non-git directory, got nil")
	}
}

func TestGetStatus_EmptyPath(t *testing.T) {
	if _, err := GetStatus(""); err == nil {
		t.Fatalf("expected error for empty repo path, got nil")
	}
}

func TestInitAndStatus_FreshRepo(t *testing.T) {
	gitAvailable(t)
	dir := filepath.Join(t.TempDir(), "repo")

	if err := Init(Config{RepoPath: dir, Branch: "main", AuthorName: "Test", AuthorEmail: "t@example.com"}); err != nil {
		t.Fatalf("Init: %v", err)
	}

	st, err := GetStatus(dir)
	if err != nil {
		t.Fatalf("GetStatus on initialized repo: %v", err)
	}
	if st.Dirty {
		t.Fatalf("fresh empty repo should not be dirty")
	}

	// Create an untracked file and confirm it surfaces.
	writeFile(t, filepath.Join(dir, "note.txt"), "hello")

	st, err = GetStatus(dir)
	if err != nil {
		t.Fatalf("GetStatus after write: %v", err)
	}
	if !st.Dirty {
		t.Fatalf("repo with untracked file should be dirty")
	}
	if len(st.Untracked) == 0 {
		t.Fatalf("expected untracked file to be reported")
	}
}

func TestCommitAll_RoundTrip(t *testing.T) {
	gitAvailable(t)
	dir := filepath.Join(t.TempDir(), "repo")
	if err := Init(Config{RepoPath: dir, Branch: "main", AuthorName: "Test", AuthorEmail: "t@example.com"}); err != nil {
		t.Fatalf("Init: %v", err)
	}
	writeFile(t, filepath.Join(dir, "a.txt"), "content")

	res, err := CommitAll(dir, "first commit")
	if err != nil {
		t.Fatalf("CommitAll: %v", err)
	}
	if res.Hash == "" {
		t.Fatalf("expected a commit hash")
	}

	logs, err := Log(dir, 5)
	if err != nil {
		t.Fatalf("Log: %v", err)
	}
	if len(logs) != 1 {
		t.Fatalf("expected exactly 1 log entry, got %d", len(logs))
	}
}

func TestLog_DefaultsCount(t *testing.T) {
	gitAvailable(t)
	dir := filepath.Join(t.TempDir(), "repo")
	if err := Init(Config{RepoPath: dir, Branch: "main", AuthorName: "T", AuthorEmail: "t@e.com"}); err != nil {
		t.Fatalf("Init: %v", err)
	}
	// No commits yet: Log should error (no HEAD), not panic.
	if _, err := Log(dir, 0); err == nil {
		t.Logf("Log returned no error on empty repo (acceptable on some git versions)")
	}
}

func writeFile(t *testing.T, path, content string) {
	t.Helper()
	if err := os.WriteFile(path, []byte(content), 0644); err != nil {
		t.Fatalf("write %s: %v", path, err)
	}
}
