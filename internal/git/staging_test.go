package git

import (
	"path/filepath"
	"strings"
	"testing"
)

func stagedPaths(t *testing.T, dir string) []string {
	t.Helper()
	ov, err := GetOverview(dir, 50)
	if err != nil {
		t.Fatalf("GetOverview: %v", err)
	}
	paths := []string{}
	for _, c := range ov.Changes {
		if !c.Conflicted && c.Index != "" && c.Index != "?" {
			paths = append(paths, c.Path)
		}
	}
	return paths
}

func TestCommit_IndexOnly(t *testing.T) {
	gitAvailable(t)
	dir := filepath.Join(t.TempDir(), "repo")
	if err := Init(Config{RepoPath: dir, Branch: "main", AuthorName: "T", AuthorEmail: "t@e.com"}); err != nil {
		t.Fatalf("Init: %v", err)
	}
	writeFile(t, filepath.Join(dir, "a.txt"), "a")
	writeFile(t, filepath.Join(dir, "b.txt"), "b")

	// Stage only a.txt, commit: b.txt must stay out of history.
	if err := StageFile(dir, "a.txt"); err != nil {
		t.Fatalf("StageFile: %v", err)
	}
	if _, err := Commit(dir, "only a"); err != nil {
		t.Fatalf("Commit: %v", err)
	}
	st, err := GetStatus(dir)
	if err != nil {
		t.Fatalf("GetStatus: %v", err)
	}
	if len(st.Untracked) != 1 || st.Untracked[0] != "b.txt" {
		t.Fatalf("expected b.txt still untracked, got %v", st.Untracked)
	}
}

func TestCommit_RejectsEmptyMessageAndNothingStaged(t *testing.T) {
	gitAvailable(t)
	dir := filepath.Join(t.TempDir(), "repo")
	if err := Init(Config{RepoPath: dir, Branch: "main", AuthorName: "T", AuthorEmail: "t@e.com"}); err != nil {
		t.Fatalf("Init: %v", err)
	}
	if _, err := Commit(dir, "  "); err == nil {
		t.Fatalf("expected error for empty message")
	}
	// Nothing staged → git commit fails; Commit must surface the error.
	if _, err := Commit(dir, "msg"); err == nil {
		t.Fatalf("expected error committing with nothing staged")
	}
}

func TestStageAllUnstageAll(t *testing.T) {
	gitAvailable(t)
	dir := filepath.Join(t.TempDir(), "repo")
	if err := Init(Config{RepoPath: dir, Branch: "main", AuthorName: "T", AuthorEmail: "t@e.com"}); err != nil {
		t.Fatalf("Init: %v", err)
	}
	writeFile(t, filepath.Join(dir, "a.txt"), "a")
	if _, err := CommitAll(dir, "init"); err != nil {
		t.Fatalf("CommitAll: %v", err)
	}
	writeFile(t, filepath.Join(dir, "a.txt"), "a2")

	if err := StageAll(dir); err != nil {
		t.Fatalf("StageAll: %v", err)
	}
	if got := stagedPaths(t, dir); len(got) != 1 || got[0] != "a.txt" {
		t.Fatalf("expected a.txt staged after StageAll, got %v", got)
	}
	if err := UnstageAll(dir); err != nil {
		t.Fatalf("UnstageAll: %v", err)
	}
	if got := stagedPaths(t, dir); len(got) != 0 {
		t.Fatalf("expected nothing staged after UnstageAll, got %v", got)
	}
}

func TestApplyHunkToIndex_RoundTrip(t *testing.T) {
	gitAvailable(t)
	dir := filepath.Join(t.TempDir(), "repo")
	if err := Init(Config{RepoPath: dir, Branch: "main", AuthorName: "T", AuthorEmail: "t@e.com"}); err != nil {
		t.Fatalf("Init: %v", err)
	}
	writeFile(t, filepath.Join(dir, "f.txt"), "one\ntwo\nthree\n")
	if _, err := CommitAll(dir, "init"); err != nil {
		t.Fatalf("CommitAll: %v", err)
	}
	writeFile(t, filepath.Join(dir, "f.txt"), "ONE\ntwo\nthree\n")

	patch, err := FileDiff(dir, "f.txt", false)
	if err != nil {
		t.Fatalf("FileDiff: %v", err)
	}
	if !strings.Contains(patch, "@@") {
		t.Fatalf("expected a hunk in the unstaged diff, got %q", patch)
	}

	// Apply to index (stage), then reverse (unstage). Plumbing must round-trip.
	if err := ApplyHunkToIndex(dir, patch, false); err != nil {
		t.Fatalf("ApplyHunkToIndex(stage): %v", err)
	}
	if got := stagedPaths(t, dir); len(got) != 1 || got[0] != "f.txt" {
		t.Fatalf("expected f.txt staged, got %v", got)
	}
	if err := ApplyHunkToIndex(dir, patch, true); err != nil {
		t.Fatalf("ApplyHunkToIndex(unstage): %v", err)
	}
	if got := stagedPaths(t, dir); len(got) != 0 {
		t.Fatalf("expected nothing staged after reverse, got %v", got)
	}
}
