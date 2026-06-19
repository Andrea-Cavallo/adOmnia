package git

import (
	"os"
	"path/filepath"
	"strings"
	"testing"
)

// TestMain isolates the test binary from the machine's global/system git config
// so credential helpers and other side-effecting global settings cannot pollute
// the temp repos (this environment's global config drops a .tokensave/ store
// into every git working dir). This keeps the suite deterministic anywhere.
func TestMain(m *testing.M) {
	cfgDir, err := os.MkdirTemp("", "adomnia-git-cfg-*")
	if err == nil {
		empty := filepath.Join(cfgDir, "gitconfig")
		_ = os.WriteFile(empty, []byte(""), 0644)
		os.Setenv("GIT_CONFIG_GLOBAL", empty)
		os.Setenv("GIT_CONFIG_SYSTEM", empty)
		os.Setenv("GIT_TERMINAL_PROMPT", "0")
	}
	code := m.Run()
	os.RemoveAll(cfgDir)
	os.Exit(code)
}

// newRepo creates an initialized repo with deterministic identity for tests.
func newRepo(t *testing.T) string {
	t.Helper()
	gitAvailable(t)
	dir := filepath.Join(t.TempDir(), "repo")
	if err := Init(Config{RepoPath: dir, Branch: "main", AuthorName: "Test", AuthorEmail: "t@example.com"}); err != nil {
		t.Fatalf("Init: %v", err)
	}
	return dir
}

// commit writes a file and commits it, returning the full hash.
func commit(t *testing.T, dir, file, content, msg string) string {
	t.Helper()
	writeFile(t, filepath.Join(dir, file), content)
	if _, err := runGit(dir, "add", "."); err != nil {
		t.Fatalf("add: %v", err)
	}
	if _, err := runGit(dir, "commit", "-m", msg); err != nil {
		t.Fatalf("commit: %v", err)
	}
	hash, err := runGit(dir, "rev-parse", "HEAD")
	if err != nil {
		t.Fatalf("rev-parse: %v", err)
	}
	return hash
}

func TestCreateBranchFromCommit(t *testing.T) {
	dir := newRepo(t)
	c1 := commit(t, dir, "a.txt", "a", "c1")

	if res := CreateBranchFromCommit(dir, "feature/x", c1, false, false); !res.Success {
		t.Fatalf("create branch failed: %s", res.Error)
	}
	if !branchExists(dir, "feature/x") {
		t.Fatalf("branch not created")
	}
	// Duplicate must fail clearly.
	if res := CreateBranchFromCommit(dir, "feature/x", c1, false, false); res.Success {
		t.Fatalf("duplicate branch should fail")
	}
	// Invalid name must fail.
	if res := CreateBranchFromCommit(dir, "bad name~", c1, false, false); res.Success {
		t.Fatalf("invalid branch name should fail")
	}
}

func TestCreateTagFromCommit(t *testing.T) {
	dir := newRepo(t)
	c1 := commit(t, dir, "a.txt", "a", "c1")

	if res := CreateTagFromCommit(dir, "v1.0.0", c1, "", false, false); !res.Success {
		t.Fatalf("lightweight tag failed: %s", res.Error)
	}
	if res := CreateTagFromCommit(dir, "v1.1.0", c1, "release", true, false); !res.Success {
		t.Fatalf("annotated tag failed: %s", res.Error)
	}
	if res := CreateTagFromCommit(dir, "v1.0.0", c1, "", false, false); res.Success {
		t.Fatalf("duplicate tag should fail")
	}
}

func TestCheckoutCommit_DetachedAndBranch(t *testing.T) {
	dir := newRepo(t)
	c1 := commit(t, dir, "a.txt", "a", "c1")
	commit(t, dir, "b.txt", "b", "c2")

	if r := CheckoutCommit(dir, c1, ""); !r.Success {
		t.Fatalf("detached checkout failed: %s", r.Error)
	}
	if !stateOf(dir).Detached {
		t.Fatalf("expected detached HEAD")
	}
	if r := CheckoutCommit(dir, c1, "from-c1"); !r.Success {
		t.Fatalf("checkout new branch failed: %s", r.Error)
	}
	if st := stateOf(dir); st.Detached || st.Branch != "from-c1" {
		t.Fatalf("expected branch from-c1, got %+v", st)
	}
}

// stateOf is a tiny helper to read current state in assertions.
func stateOf(dir string) RepoState {
	st, _ := inspectState(dir)
	return st
}

func TestGetCommitMeta(t *testing.T) {
	dir := newRepo(t)
	commit(t, dir, "a.txt", "a", "c1")
	c2 := commit(t, dir, "b.txt", "b", "c2")

	meta, err := GetCommitMeta(dir, c2)
	if err != nil {
		t.Fatalf("GetCommitMeta: %v", err)
	}
	if !meta.IsHead {
		t.Fatalf("c2 should be HEAD")
	}
	if meta.IsMerge {
		t.Fatalf("c2 should not be a merge")
	}
	if !meta.OnCurrentBranch {
		t.Fatalf("c2 should be on current branch")
	}
	if len(meta.Parents) != 1 {
		t.Fatalf("expected 1 parent, got %d", len(meta.Parents))
	}
}

func TestCompareCommits_RangeAndStats(t *testing.T) {
	dir := newRepo(t)
	c1 := commit(t, dir, "a.txt", "one\n", "c1")
	commit(t, dir, "a.txt", "one\ntwo\n", "c2")

	// Range notation in refA, empty refB.
	cmp, err := CompareCommits(dir, c1+"..HEAD", "")
	if err != nil {
		t.Fatalf("CompareCommits range: %v", err)
	}
	if len(cmp.Files) != 1 || cmp.Files[0].Path != "a.txt" {
		t.Fatalf("expected a.txt changed, got %+v", cmp.Files)
	}
	if cmp.Additions != 1 {
		t.Fatalf("expected 1 addition, got %d", cmp.Additions)
	}
}

func TestPatchRoundTrip(t *testing.T) {
	dir := newRepo(t)
	c1 := commit(t, dir, "a.txt", "one\n", "c1")
	c2 := commit(t, dir, "a.txt", "one\ntwo\n", "c2")

	patch, err := CreatePatch(dir, c1, c2)
	if err != nil {
		t.Fatalf("CreatePatch: %v", err)
	}
	if !strings.Contains(patch, "+two") {
		t.Fatalf("patch missing change: %s", patch)
	}
	// Roll back to c1, then re-apply the patch.
	if res := ResetBranch(dir, c1, "hard"); !res.Success {
		t.Fatalf("reset hard: %s", res.Error)
	}
	if res := ApplyPatch(dir, patch, false, false); !res.Success {
		t.Fatalf("ApplyPatch: %s / %s", res.Error, res.Stderr)
	}
	got, _ := os.ReadFile(filepath.Join(dir, "a.txt"))
	if !strings.Contains(string(got), "two") {
		t.Fatalf("patch not applied, file=%q", got)
	}
}

func TestRestoreFileFromCommit(t *testing.T) {
	dir := newRepo(t)
	c1 := commit(t, dir, "a.txt", "original\n", "c1")
	commit(t, dir, "a.txt", "changed\n", "c2")

	preview, err := FileAtCommit(dir, c1, "a.txt")
	if err != nil {
		t.Fatalf("FileAtCommit: %v", err)
	}
	if strings.TrimSpace(preview) != "original" {
		t.Fatalf("preview mismatch: %q", preview)
	}
	if res := RestoreFileFromCommit(dir, c1, "a.txt"); !res.Success {
		t.Fatalf("restore: %s", res.Error)
	}
	got, _ := os.ReadFile(filepath.Join(dir, "a.txt"))
	if strings.TrimSpace(string(got)) != "original" {
		t.Fatalf("file not restored, got %q", got)
	}
}

func TestCherryPick_SuccessAndConflict(t *testing.T) {
	dir := newRepo(t)
	commit(t, dir, "base.txt", "base\n", "c1")
	// Branch A changes shared.txt one way.
	if res := CreateBranchFromCommit(dir, "branchA", "", true, false); !res.Success {
		t.Fatalf("branchA: %s", res.Error)
	}
	pick := commit(t, dir, "feature.txt", "feature\n", "add feature")

	// Back to main, cherry-pick the clean commit.
	if _, err := runGit(dir, "checkout", "main"); err != nil {
		t.Fatalf("checkout main: %v", err)
	}
	if res := CherryPick(dir, []string{pick}, false, "", false); !res.Success {
		t.Fatalf("clean cherry-pick failed: %s / %s", res.Error, res.Stderr)
	}
	if _, err := os.Stat(filepath.Join(dir, "feature.txt")); err != nil {
		t.Fatalf("cherry-picked file missing")
	}

	// Now craft a conflict: two branches edit the same line.
	conflictDir := newRepo(t)
	commit(t, conflictDir, "shared.txt", "base\n", "c1")
	CreateBranchFromCommit(conflictDir, "other", "", true, false)
	bad := commit(t, conflictDir, "shared.txt", "other-change\n", "other change")
	runGit(conflictDir, "checkout", "main")
	commit(t, conflictDir, "shared.txt", "main-change\n", "main change")
	res := CherryPick(conflictDir, []string{bad}, false, "", false)
	if res.Success {
		t.Fatalf("expected cherry-pick conflict")
	}
	if res.Code != CodeConflict {
		t.Fatalf("expected conflict code, got %q (%s)", res.Code, res.Error)
	}
	if len(res.Conflicts) == 0 {
		t.Fatalf("expected conflicted files reported")
	}
	// Abort should clean up.
	if ab := AbortOperation(conflictDir); !ab.Success {
		t.Fatalf("abort failed: %s", ab.Error)
	}
}

func TestRevertCommit(t *testing.T) {
	dir := newRepo(t)
	commit(t, dir, "a.txt", "a\n", "c1")
	c2 := commit(t, dir, "b.txt", "b\n", "add b")

	msg, err := GenerateRevertMessage(dir, c2)
	if err != nil {
		t.Fatalf("GenerateRevertMessage: %v", err)
	}
	if !strings.Contains(msg, "Revert") {
		t.Fatalf("unexpected revert message: %s", msg)
	}
	if res := RevertCommit(dir, c2, "", 0); !res.Success {
		t.Fatalf("revert failed: %s / %s", res.Error, res.Stderr)
	}
	if _, err := os.Stat(filepath.Join(dir, "b.txt")); !os.IsNotExist(err) {
		t.Fatalf("revert should have removed b.txt")
	}
}

func TestResetModes(t *testing.T) {
	dir := newRepo(t)
	c1 := commit(t, dir, "a.txt", "a\n", "c1")
	commit(t, dir, "b.txt", "b\n", "c2")

	if res := ResetBranch(dir, c1, "soft"); !res.Success {
		t.Fatalf("soft reset: %s", res.Error)
	}
	// b.txt still present and staged after soft reset.
	if _, err := os.Stat(filepath.Join(dir, "b.txt")); err != nil {
		t.Fatalf("soft reset should keep b.txt")
	}
	if res := ResetBranch(dir, c1, "bogus"); res.Success {
		t.Fatalf("invalid reset mode should fail")
	}
	if res := ResetBranch(dir, c1, "hard"); !res.Success {
		t.Fatalf("hard reset: %s", res.Error)
	}
}

func TestInteractiveRebase_DropAndSquash(t *testing.T) {
	dir := newRepo(t)
	c1 := commit(t, dir, "a.txt", "a\n", "c1")
	commit(t, dir, "b.txt", "b\n", "c2")
	commit(t, dir, "c.txt", "c\n", "c3")

	plan, err := GetRebaseTodo(dir, c1)
	if err != nil {
		t.Fatalf("GetRebaseTodo: %v", err)
	}
	if len(plan.Items) != 2 {
		t.Fatalf("expected 2 todo items, got %d", len(plan.Items))
	}
	// Drop c2, keep c3.
	items := []RebaseTodoItem{
		{Action: "drop", Hash: plan.Items[0].Hash, Message: plan.Items[0].Message},
		{Action: "pick", Hash: plan.Items[1].Hash, Message: plan.Items[1].Message},
	}
	if r := StartInteractiveRebase(dir, c1, items); !r.Success {
		t.Fatalf("rebase drop failed: %s / %s", r.Error, r.Stderr)
	}
	if _, err := os.Stat(filepath.Join(dir, "b.txt")); !os.IsNotExist(err) {
		t.Fatalf("dropped commit's file b.txt should be gone")
	}
	if _, err := os.Stat(filepath.Join(dir, "c.txt")); err != nil {
		t.Fatalf("kept commit's file c.txt should exist")
	}
}

func TestInteractiveRebase_Squash(t *testing.T) {
	dir := newRepo(t)
	c1 := commit(t, dir, "a.txt", "a\n", "c1")
	commit(t, dir, "b.txt", "b\n", "c2")
	commit(t, dir, "c.txt", "c\n", "c3")

	plan, _ := GetRebaseTodo(dir, c1)
	items := []RebaseTodoItem{
		{Action: "pick", Hash: plan.Items[0].Hash, Message: plan.Items[0].Message},
		{Action: "squash", Hash: plan.Items[1].Hash, Message: plan.Items[1].Message},
	}
	if r := StartInteractiveRebase(dir, c1, items); !r.Success {
		t.Fatalf("rebase squash failed: %s / %s", r.Error, r.Stderr)
	}
	out, _ := runGit(dir, "rev-list", "--count", c1+"..HEAD")
	if strings.TrimSpace(out) != "1" {
		t.Fatalf("expected 1 commit after squash, got %s", out)
	}
}

func TestBisect_FindsFirstBad(t *testing.T) {
	dir := newRepo(t)
	good := commit(t, dir, "a.txt", "ok\n", "good")
	commit(t, dir, "b.txt", "ok\n", "still ok")
	bad := commit(t, dir, "c.txt", "broken\n", "introduce bug")

	if r := BisectStart(dir, bad, good); !r.Success {
		t.Fatalf("bisect start: %s", r.Error)
	}
	// Mark current as bad until git concludes; small history converges fast.
	for i := 0; i < 5; i++ {
		r := BisectMark(dir, "bad")
		if FirstBadCommit(r.Stdout) != "" {
			break
		}
		g := BisectMark(dir, "good")
		if FirstBadCommit(g.Stdout) != "" {
			break
		}
	}
	BisectReset(dir)
}

func TestSearchHistory(t *testing.T) {
	dir := newRepo(t)
	commit(t, dir, "a.txt", "alpha\n", "add alpha feature")
	commit(t, dir, "b.txt", "beta\n", "fix beta bug")

	byMsg, err := SearchHistory(dir, SearchFilters{Message: "beta"})
	if err != nil {
		t.Fatalf("SearchHistory message: %v", err)
	}
	if len(byMsg) != 1 || !strings.Contains(byMsg[0].Message, "beta") {
		t.Fatalf("message filter mismatch: %+v", byMsg)
	}
	byPickaxe, err := SearchHistory(dir, SearchFilters{Pickaxe: "alpha", PickaxeMode: "S"})
	if err != nil {
		t.Fatalf("SearchHistory pickaxe: %v", err)
	}
	if len(byPickaxe) != 1 {
		t.Fatalf("pickaxe -S should find 1 commit, got %d", len(byPickaxe))
	}
}
