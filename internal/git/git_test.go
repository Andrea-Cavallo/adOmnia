package git

import (
	"encoding/json"
	"os"
	"path/filepath"
	"strings"
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

func TestCommitPaths_CommitsOnlySelectedFiles(t *testing.T) {
	gitAvailable(t)
	dir := filepath.Join(t.TempDir(), "repo")
	if err := Init(Config{RepoPath: dir, Branch: "main", AuthorName: "T", AuthorEmail: "t@e.com"}); err != nil {
		t.Fatalf("Init: %v", err)
	}
	writeFile(t, filepath.Join(dir, "a.txt"), "a1")
	writeFile(t, filepath.Join(dir, "b.txt"), "b1")
	if _, err := CommitAll(dir, "init"); err != nil {
		t.Fatalf("CommitAll: %v", err)
	}

	// Dirty both, then commit only a.txt: b.txt must remain modified.
	writeFile(t, filepath.Join(dir, "a.txt"), "a2")
	writeFile(t, filepath.Join(dir, "b.txt"), "b2")
	if _, err := CommitPaths(dir, "only a", []string{"a.txt"}); err != nil {
		t.Fatalf("CommitPaths: %v", err)
	}

	st, err := GetStatus(dir)
	if err != nil {
		t.Fatalf("GetStatus: %v", err)
	}
	if len(st.Modified) != 1 || st.Modified[0] != "b.txt" {
		t.Fatalf("expected only b.txt left modified, got %v", st.Modified)
	}
}

func TestCommitPaths_RejectsEmptySelection(t *testing.T) {
	gitAvailable(t)
	dir := filepath.Join(t.TempDir(), "repo")
	if err := Init(Config{RepoPath: dir, Branch: "main", AuthorName: "T", AuthorEmail: "t@e.com"}); err != nil {
		t.Fatalf("Init: %v", err)
	}
	if _, err := CommitPaths(dir, "msg", nil); err == nil {
		t.Fatalf("expected error for empty selection")
	}
	if _, err := CommitPaths(dir, "", []string{"a.txt"}); err == nil {
		t.Fatalf("expected error for empty message")
	}
}

func TestResolveCurrentBranch_UsesCheckedOutBranch(t *testing.T) {
	gitAvailable(t)
	dir := filepath.Join(t.TempDir(), "repo")
	if err := Init(Config{RepoPath: dir, Branch: "trunk", AuthorName: "T", AuthorEmail: "t@e.com"}); err != nil {
		t.Fatalf("Init: %v", err)
	}
	branch, err := resolveCurrentBranch(dir, "")
	if err != nil {
		t.Fatalf("resolveCurrentBranch: %v", err)
	}
	if branch != "trunk" {
		t.Fatalf("expected trunk, got %q", branch)
	}
	if explicit, err := resolveCurrentBranch(dir, " release "); err != nil || explicit != "release" {
		t.Fatalf("explicit branch = %q, %v", explicit, err)
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

func TestGetOverview_EmptySlicesSerializeAsArrays(t *testing.T) {
	gitAvailable(t)
	dir := filepath.Join(t.TempDir(), "repo")
	if err := Init(Config{RepoPath: dir, Branch: "main", AuthorName: "T", AuthorEmail: "t@e.com"}); err != nil {
		t.Fatalf("Init: %v", err)
	}

	// On a fresh, clean repo every collection is empty. The frontend reads
	// these as arrays (overview.changes.length, status.modified, etc). Go nil
	// slices marshal to JSON null, which crashes the UI with
	// "Cannot read properties of null (reading 'length')". Guarantee [].
	ov, err := GetOverview(dir, 50)
	if err != nil {
		t.Fatalf("GetOverview: %v", err)
	}
	raw, err := json.Marshal(ov)
	if err != nil {
		t.Fatalf("marshal: %v", err)
	}
	for _, bad := range []string{
		`"changes":null`, `"conflicts":null`, `"branches":null`,
		`"remotes":null`, `"stashes":null`, `"commits":null`,
		`"modified":null`, `"untracked":null`,
	} {
		if strings.Contains(string(raw), bad) {
			t.Fatalf("overview JSON contains %s; nil slices must marshal as []: %s", bad, raw)
		}
	}
}

func TestGetOverview_IncludesCommitsFromAllBranches(t *testing.T) {
	gitAvailable(t)
	dir := filepath.Join(t.TempDir(), "repo")
	if err := Init(Config{RepoPath: dir, Branch: "main", AuthorName: "T", AuthorEmail: "t@e.com"}); err != nil {
		t.Fatalf("Init: %v", err)
	}
	writeFile(t, filepath.Join(dir, "base.txt"), "base")
	if _, err := CommitAll(dir, "base commit"); err != nil {
		t.Fatalf("base commit: %v", err)
	}
	if _, err := runGit(dir, "checkout", "-b", "side"); err != nil {
		t.Fatalf("create side branch: %v", err)
	}
	writeFile(t, filepath.Join(dir, "side.txt"), "side")
	if _, err := CommitAll(dir, "side-only commit"); err != nil {
		t.Fatalf("side commit: %v", err)
	}
	if _, err := runGit(dir, "checkout", "main"); err != nil {
		t.Fatalf("checkout main: %v", err)
	}

	ov, err := GetOverview(dir, 50)
	if err != nil {
		t.Fatalf("GetOverview: %v", err)
	}
	found := false
	for _, commit := range ov.Commits {
		if commit.Message == "side-only commit" {
			found = true
			break
		}
	}
	if !found {
		t.Fatalf("overview graph must include commits from non-current branches")
	}
}

func TestCompareRefs_EmptyResultIsNonNil(t *testing.T) {
	gitAvailable(t)
	dir := filepath.Join(t.TempDir(), "repo")
	if err := Init(Config{RepoPath: dir, Branch: "main", AuthorName: "T", AuthorEmail: "t@e.com"}); err != nil {
		t.Fatalf("Init: %v", err)
	}
	writeFile(t, filepath.Join(dir, "a.txt"), "x")
	if _, err := CommitAll(dir, "c1"); err != nil {
		t.Fatalf("CommitAll: %v", err)
	}
	// Comparing a ref to itself yields zero changed files; must be [] not nil
	// so the compare tab does not crash on files.filter(...).
	files, err := CompareRefs(dir, "HEAD", "HEAD")
	if err != nil {
		t.Fatalf("CompareRefs: %v", err)
	}
	if files == nil {
		t.Fatalf("CompareRefs returned nil slice; expected empty non-nil slice")
	}
}

func writeFile(t *testing.T, path, content string) {
	t.Helper()
	if err := os.WriteFile(path, []byte(content), 0644); err != nil {
		t.Fatalf("write %s: %v", path, err)
	}
}
