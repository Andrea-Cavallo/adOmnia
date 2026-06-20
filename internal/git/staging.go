package git

import (
	"bytes"
	"fmt"
	"os"
	"os/exec"
	"strings"
)

// Commit records the staged index only — no implicit `git add`. This is the
// professional "commit what you staged" model the Staged/Unstaged panel relies
// on; CommitAll/CommitPaths remain for the all-at-once and pick-files flows.
func Commit(repoPath, message string) (CommitResult, error) {
	if strings.TrimSpace(message) == "" {
		return CommitResult{}, fmt.Errorf("commit message is empty")
	}
	if _, err := runGit(repoPath, "commit", "-m", message); err != nil {
		return CommitResult{}, err
	}
	hash, _ := runGit(repoPath, "rev-parse", "--short", "HEAD")
	return CommitResult{Hash: hash, Message: message}, nil
}

// StageAll stages every change (tracked + untracked). UnstageAll resets the
// index back to HEAD without touching the working tree.
func StageAll(repoPath string) error {
	_, err := runGit(repoPath, "add", "-A")
	return err
}

func UnstageAll(repoPath string) error {
	_, err := runGit(repoPath, "reset")
	return err
}

// FileDiff returns the unified diff for a single file. When staged is true it
// diffs the index against HEAD (what is staged); otherwise the working tree
// against the index (what is unstaged). Output is raw (newline intact) so each
// hunk stays apply-able for partial staging.
func FileDiff(repoPath, path string, staged bool) (string, error) {
	path = strings.TrimSpace(path)
	if path == "" {
		return "", fmt.Errorf("file path is empty")
	}
	args := []string{"-C", repoPath, "diff"}
	if staged {
		args = append(args, "--cached")
	}
	args = append(args, "--", path)
	cmd := exec.Command("git", args...)
	configureHiddenCommand(cmd)
	var out, errBuf bytes.Buffer
	cmd.Stdout = &out
	cmd.Stderr = &errBuf
	if err := cmd.Run(); err != nil {
		return "", fmt.Errorf("git diff: %s", firstNonEmpty(errBuf.String(), err.Error()))
	}
	return out.String(), nil
}

// ApplyHunkToIndex stages (reverse=false) or unstages (reverse=true) a patch of
// one or more selected hunks for a single file by applying it to the index. The
// patch must be a valid unified diff (file header + hunks) produced from
// FileDiff, so its context matches the index exactly.
func ApplyHunkToIndex(repoPath, patch string, reverse bool) error {
	if strings.TrimSpace(patch) == "" {
		return fmt.Errorf("patch is empty")
	}
	if !strings.HasSuffix(patch, "\n") {
		patch += "\n"
	}
	tmp, err := os.CreateTemp("", "adomnia-hunk-*.patch")
	if err != nil {
		return fmt.Errorf("create temp patch: %w", err)
	}
	defer os.Remove(tmp.Name())
	if _, err := tmp.WriteString(patch); err != nil {
		tmp.Close()
		return fmt.Errorf("write temp patch: %w", err)
	}
	tmp.Close()

	args := []string{"apply", "--cached", "--whitespace=nowarn"}
	if reverse {
		args = append(args, "--reverse")
	}
	args = append(args, tmp.Name())
	_, err = runGit(repoPath, args...)
	return err
}
