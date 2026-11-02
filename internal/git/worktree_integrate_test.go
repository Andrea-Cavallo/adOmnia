package git

import (
	"os"
	"path/filepath"
	"slices"
	"strings"
	"testing"
)

func newAgentWorktree(t *testing.T) (repo, worktree, base string) {
	t.Helper()
	gitAvailable(t)
	repo = filepath.Join(t.TempDir(), "repo")
	if err := Init(Config{RepoPath: repo, Branch: "main", AuthorName: "T", AuthorEmail: "t@e.com"}); err != nil {
		t.Fatal(err)
	}
	writeFile(t, filepath.Join(repo, "a.txt"), "one\ntwo\nthree\n")
	writeFile(t, filepath.Join(repo, "b.txt"), "b\n")
	if _, err := CommitAll(repo, "first"); err != nil {
		t.Fatal(err)
	}
	meta, err := GetCommitMeta(repo, "HEAD")
	if err != nil {
		t.Fatal(err)
	}
	worktree = filepath.Join(t.TempDir(), "agent")
	if err := AddWorktreeFrom(repo, worktree, "adomnia/task-int", meta.FullHash); err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = RemoveWorktree(repo, worktree, true) })
	return repo, worktree, meta.FullHash
}

func TestWorkspacePatchIntegratesIntoTheProjectWithoutCommitting(t *testing.T) {
	repo, worktree, base := newAgentWorktree(t)
	writeFile(t, filepath.Join(worktree, "a.txt"), "one\nTWO\nthree\n")
	writeFile(t, filepath.Join(worktree, "new.txt"), "created by the agent\n")
	if err := os.MkdirAll(filepath.Join(worktree, ".adomnia"), 0o700); err != nil {
		t.Fatal(err)
	}
	writeFile(t, filepath.Join(worktree, ".adomnia", "ai-policy.json"), `{"ai":"off"}`)
	before, _, err := WorkingTreeFingerprint(worktree, base)
	if err != nil {
		t.Fatal(err)
	}
	patch, files, err := WorkspacePatch(worktree, base)
	if err != nil {
		t.Fatal(err)
	}
	if !slices.Equal(files, []string{"a.txt", "new.txt"}) {
		t.Fatalf("changed files = %v (the mirrored policy must not travel)", files)
	}
	after, _, _ := WorkingTreeFingerprint(worktree, base)
	if before != after {
		t.Fatal("building the patch changed the worktree fingerprint")
	}
	// Il progetto ha ricevuto un commit su un altro file: l'integrazione deve comunque applicarsi.
	writeFile(t, filepath.Join(repo, "b.txt"), "b changed on main\n")
	if _, err := CommitAll(repo, "second"); err != nil {
		t.Fatal(err)
	}
	target, err := CompareTarget(repo, base)
	if err != nil || target.Branch != "main" || target.CommitsSinceBase != 1 || !slices.Equal(target.ChangedSinceBase, []string{"b.txt"}) {
		t.Fatalf("target comparison = %+v, %v", target, err)
	}
	head := target.Head
	check, err := IntegratePatch(repo, patch, true)
	if err != nil || !check.Applied {
		t.Fatalf("check = %+v, %v", check, err)
	}
	if raw, _ := os.ReadFile(filepath.Join(repo, "a.txt")); strings.Contains(string(raw), "TWO") {
		t.Fatal("the check modified the project")
	}
	result, err := IntegratePatch(repo, patch, false)
	if err != nil || !result.Applied || len(result.Conflicts) != 0 {
		t.Fatalf("integration = %+v, %v", result, err)
	}
	if raw, _ := os.ReadFile(filepath.Join(repo, "new.txt")); string(raw) != "created by the agent\n" {
		t.Fatalf("new file not integrated: %q", raw)
	}
	if now, _ := GetCommitMeta(repo, "HEAD"); now.FullHash != head {
		t.Fatal("integration must not commit")
	}
}

func TestIntegratePatchReportsConflicts(t *testing.T) {
	repo, worktree, base := newAgentWorktree(t)
	writeFile(t, filepath.Join(worktree, "a.txt"), "one\nagent\nthree\n")
	patch, _, err := WorkspacePatch(worktree, base)
	if err != nil {
		t.Fatal(err)
	}
	writeFile(t, filepath.Join(repo, "a.txt"), "one\nmain\nthree\n")
	if _, err := CommitAll(repo, "conflicting"); err != nil {
		t.Fatal(err)
	}
	result, err := IntegratePatch(repo, patch, false)
	if err != nil {
		t.Fatal(err)
	}
	if !slices.Equal(result.Conflicts, []string{"a.txt"}) {
		t.Fatalf("conflicts = %+v", result)
	}
}

func TestMainRepositoryOfAWorktree(t *testing.T) {
	repo, worktree, _ := newAgentWorktree(t)
	got, err := MainRepository(worktree)
	if err != nil {
		t.Fatal(err)
	}
	if !strings.EqualFold(filepath.Clean(got), filepath.Clean(repo)) {
		t.Fatalf("main repository = %s, want %s", got, repo)
	}
}

func TestFingerprintDependsOnContentNotOnCommits(t *testing.T) {
	_, worktree, base := newAgentWorktree(t)
	writeFile(t, filepath.Join(worktree, "a.txt"), "one\nchanged\nthree\n")
	writeFile(t, filepath.Join(worktree, "new.txt"), "new\n")
	before, changed, err := WorkingTreeFingerprint(worktree, base)
	if err != nil || changed != 2 {
		t.Fatalf("fingerprint: %v, %d files", err, changed)
	}
	sha, files, err := CommitWorktree(worktree, "step one")
	if err != nil || sha == "" || !slices.Equal(files, []string{"a.txt", "new.txt"}) {
		t.Fatalf("commit = %s %v %v", sha, files, err)
	}
	after, _, err := WorkingTreeFingerprint(worktree, base)
	if err != nil || after != before {
		t.Fatal("committing the same content must keep the fingerprint")
	}
	if pending, err := PendingFiles(worktree); err != nil || len(pending) != 0 {
		t.Fatalf("pending after commit = %v, %v", pending, err)
	}
}
