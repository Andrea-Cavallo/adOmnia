package git

import (
	"os"
	"path/filepath"
	"sync"
	"testing"
)

// newCachedRepo creates a repository with one commit so branch and HEAD exist.
func newCachedRepo(t *testing.T) string {
	t.Helper()
	gitAvailable(t)
	dir := filepath.Join(t.TempDir(), "repo")
	if err := Init(Config{RepoPath: dir, Branch: "main", AuthorName: "T", AuthorEmail: "t@e.com"}); err != nil {
		t.Fatalf("Init: %v", err)
	}
	writeFile(t, filepath.Join(dir, "a.txt"), "one\n")
	if _, err := CommitAll(dir, "init"); err != nil {
		t.Fatalf("CommitAll: %v", err)
	}
	resetRepositoryCache()
	return dir
}

func TestGetStatusCachesRepeatedReads(t *testing.T) {
	dir := newCachedRepo(t)
	before := workingTreeReads.Load()

	for range 3 {
		if _, err := GetStatus(dir); err != nil {
			t.Fatalf("GetStatus: %v", err)
		}
	}
	if reads := workingTreeReads.Load() - before; reads != 1 {
		t.Fatalf("git reads = %d, want 1 (cached while unchanged)", reads)
	}
}

func TestConcurrentReadsShareOneBuild(t *testing.T) {
	dir := newCachedRepo(t)
	before := workingTreeReads.Load()

	var group sync.WaitGroup
	for range 8 {
		group.Go(func() {
			if _, err := GetStatus(dir); err != nil {
				t.Errorf("GetStatus: %v", err)
			}
		})
	}
	group.Wait()
	if reads := workingTreeReads.Load() - before; reads != 1 {
		t.Fatalf("git reads = %d, want 1 (concurrent callers coalesced)", reads)
	}
}

func TestMutatingCommandDropsTheCache(t *testing.T) {
	dir := newCachedRepo(t)
	if status, err := GetStatus(dir); err != nil || status.Dirty {
		t.Fatalf("status before the change: %+v err=%v", status, err)
	}

	writeFile(t, filepath.Join(dir, "b.txt"), "two\n")
	// git add is a write: it must drop the cached working tree before the next read.
	if err := StageFile(dir, "b.txt"); err != nil {
		t.Fatalf("StageFile: %v", err)
	}
	status, err := GetStatus(dir)
	if err != nil {
		t.Fatalf("GetStatus: %v", err)
	}
	if !status.Dirty {
		t.Fatalf("staged file should be reported as dirty")
	}
}

func TestInvalidateRepositoryMatchesProjectSubfolder(t *testing.T) {
	dir := newCachedRepo(t)
	sub := filepath.Join(dir, "sub")
	if err := os.MkdirAll(sub, 0o755); err != nil {
		t.Fatal(err)
	}
	before := workingTreeReads.Load()
	if _, err := GetStatus(dir); err != nil {
		t.Fatalf("GetStatus: %v", err)
	}
	// The watcher passes the project folder, which can sit inside the repository.
	InvalidateRepository(sub)
	if _, err := GetStatus(dir); err != nil {
		t.Fatalf("GetStatus: %v", err)
	}
	if reads := workingTreeReads.Load() - before; reads != 2 {
		t.Fatalf("git reads = %d, want 2 (invalidated by a subfolder)", reads)
	}
}

func TestGetOverviewReadsStatusOnce(t *testing.T) {
	dir := newCachedRepo(t)
	before := porcelainReads.Load()
	if _, err := GetOverview(dir, 10); err != nil {
		t.Fatalf("GetOverview: %v", err)
	}
	if reads := porcelainReads.Load() - before; reads != 1 {
		t.Fatalf("porcelain reads = %d, want 1 (overview reuses the working tree)", reads)
	}
}

func TestBranchStateListsLocalBranchesAndHead(t *testing.T) {
	dir := newCachedRepo(t)
	if err := CreateBranch(dir, "feature"); err != nil {
		t.Fatalf("CreateBranch: %v", err)
	}
	state, err := BranchState(dir)
	if err != nil {
		t.Fatalf("BranchState: %v", err)
	}
	if state.Head == "" {
		t.Fatalf("HEAD hash is empty")
	}
	if len(state.Branches) != 2 || state.Branches[0] != "feature" || state.Branches[1] != "main" {
		t.Fatalf("branches = %v, want the two local branches", state.Branches)
	}
	if state.Status.Branch != "main" {
		t.Fatalf("branch = %q, want main", state.Status.Branch)
	}
}

func TestBranchStateReadsNoHistory(t *testing.T) {
	dir := newCachedRepo(t)
	before := historyReads.Load()
	if _, err := BranchState(dir); err != nil {
		t.Fatalf("BranchState: %v", err)
	}
	GetStatus(dir)
	if reads := historyReads.Load() - before; reads != 0 {
		t.Fatalf("git log runs = %d, want 0 (the VCS bar shows no history)", reads)
	}
}

func TestParseBranchLinesSeparatesRemoteBranches(t *testing.T) {
	out := "refs/heads/main|refs/remotes/origin/main|abc123|2 days ago\n" +
		"refs/remotes/origin/main||abc123|2 days ago\n" +
		"refs/remotes/origin/HEAD||abc123|2 days ago\n" +
		"refs/heads/topic|refs/remotes/kb/topic|def456|1 hour ago\n"

	branches := parseBranchLines(out, "main")
	if len(branches) != 3 {
		t.Fatalf("branches = %+v, want local main, remote main and local topic", branches)
	}
	if !branches[0].Current || branches[0].Remote || branches[0].Name != "main" {
		t.Fatalf("local branch misread: %+v", branches[0])
	}
	if !branches[1].Remote || branches[1].Name != "origin/main" {
		t.Fatalf("remote branch misread: %+v", branches[1])
	}
	if branches[2].Upstream != "refs/remotes/kb/topic" || branches[2].Remote {
		t.Fatalf("topic branch misread: %+v", branches[2])
	}
}

func TestReadOnlyGit(t *testing.T) {
	readOnly := [][]string{
		{"status", "--porcelain"},
		{"rev-parse", "--is-inside-work-tree"},
		{"rev-list", "--left-right", "--count", "HEAD...@{upstream}"},
		{"log", "--max-count=5"},
		{"branch"},
		{"branch", "--all", "--format=%(refname)"},
		{"branch", "-v"},
		{"remote", "-v"},
		{"remote", "get-url", "origin"},
		{"stash", "list"},
		{"tag", "-l"},
		{"config", "--get", "user.name"},
		{"worktree", "list"},
	}
	for _, args := range readOnly {
		if !readOnlyGit(args) {
			t.Errorf("readOnlyGit(%v) = false, want true", args)
		}
	}

	writes := [][]string{
		nil,
		{"add", "."},
		{"commit", "-m", "x"},
		{"checkout", "main"},
		{"branch", "-d", "old"},
		{"branch", "--set-upstream-to=origin/main"},
		{"remote", "add", "origin", "url"},
		{"stash", "push"},
		{"tag", "-d", "v1"},
		{"config", "user.name", "T"},
		{"worktree", "add", "../w"},
		{"push", "origin", "main"},
	}
	for _, args := range writes {
		if readOnlyGit(args) {
			t.Errorf("readOnlyGit(%v) = true, want false", args)
		}
	}
}
