package git

import (
	"fmt"
	"strconv"
	"strings"
)

// CherryPick applies one or more commits onto the current branch, preserving the
// given order. noCommit keeps changes staged without committing; recordOrigin
// adds the "(cherry picked from …)" line (-x); newBranch (optional) is created
// and checked out first. Conflicts are surfaced via OpResult.Code == conflict.
func CherryPick(repoPath string, shas []string, noCommit bool, newBranch string, recordOrigin bool) OpResult {
	clean := []string{}
	for _, s := range shas {
		if t := strings.TrimSpace(s); t != "" {
			clean = append(clean, t)
		}
	}
	if len(clean) == 0 {
		return fail(repoPath, "git cherry-pick", "", "", CodeError, "no commits selected")
	}
	if newBranch = strings.TrimSpace(newBranch); newBranch != "" {
		if br := CreateBranchFromCommit(repoPath, newBranch, "", true, false); !br.Success {
			return br
		}
	}
	args := []string{"cherry-pick"}
	if recordOrigin {
		args = append(args, "-x")
	}
	if noCommit {
		args = append(args, "--no-commit")
	}
	args = append(args, clean...)
	stdout, stderr, command, err := runFull(repoPath, args...)
	if err != nil {
		return fail(repoPath, command, stdout, stderr, conflictCodeIfAny(repoPath), "")
	}
	return ok(repoPath, command, stdout, stderr)
}

// GenerateRevertMessage returns the message git would use for reverting a commit
// so the dialog can show (and let the user edit) it before execution.
func GenerateRevertMessage(repoPath, sha string) (string, error) {
	full, err := runGit(repoPath, "rev-parse", sha)
	if err != nil {
		return "", err
	}
	subject, err := runGit(repoPath, "show", "-s", "--format=%s", full)
	if err != nil {
		return "", err
	}
	return fmt.Sprintf("Revert \"%s\"\n\nThis reverts commit %s.", subject, full), nil
}

// RevertCommit creates a new commit that undoes sha. Merge commits require a
// 1-based mainline parent. An edited message (different from git's default) is
// applied via a follow-up amend once the revert lands cleanly.
func RevertCommit(repoPath, sha, message string, mainline int) OpResult {
	sha = strings.TrimSpace(sha)
	if sha == "" {
		return fail(repoPath, "git revert", "", "", CodeError, "commit ref is empty")
	}
	parents, _ := runGit(repoPath, "show", "-s", "--format=%P", sha)
	isMerge := len(strings.Fields(parents)) > 1
	if isMerge && mainline < 1 {
		return fail(repoPath, "git revert", "", "", CodeError, "reverting a merge commit requires choosing a mainline parent")
	}

	args := []string{"revert", "--no-edit"}
	if isMerge {
		args = append(args, "-m", strconv.Itoa(mainline))
	}
	args = append(args, sha)
	stdout, stderr, command, err := runFull(repoPath, args...)
	if err != nil {
		return fail(repoPath, command, stdout, stderr, conflictCodeIfAny(repoPath), "")
	}
	res := ok(repoPath, command, stdout, stderr)
	if res.Success && strings.TrimSpace(message) != "" {
		if generated, gErr := GenerateRevertMessage(repoPath, sha); gErr == nil && strings.TrimSpace(message) != strings.TrimSpace(generated) {
			aOut, aErr, aCmd, err := runFull(repoPath, "commit", "--amend", "-m", message)
			res.Command = res.Command + " && " + aCmd
			res.Stdout = joinStreams(res.Stdout, aOut)
			res.Stderr = joinStreams(res.Stderr, aErr)
			if err != nil {
				res.Success = false
				res.Code = CodeError
				res.Error = "Revert committed but message update failed: " + firstNonEmpty(aErr, aOut)
			}
		}
	}
	return res
}

// ResetBranch moves the current branch to sha. mode is soft (keep staged),
// mixed (keep unstaged) or hard (discard). Hard is destructive — the UI must
// confirm. Reset is refused while a merge/rebase/etc. is in progress.
func ResetBranch(repoPath, sha, mode string) OpResult {
	sha = strings.TrimSpace(sha)
	mode = strings.TrimSpace(mode)
	if sha == "" {
		return fail(repoPath, "git reset", "", "", CodeError, "commit ref is empty")
	}
	flag := map[string]string{"soft": "--soft", "mixed": "--mixed", "hard": "--hard"}[mode]
	if flag == "" {
		return fail(repoPath, "git reset", "", "", CodeError, "invalid reset mode: "+mode)
	}
	if op := inProgressOperation(repoPath); op != "" {
		return fail(repoPath, "git reset "+flag, "", "", CodeAborted, "cannot reset while a "+op+" is in progress")
	}
	stdout, stderr, command, err := runFull(repoPath, "reset", flag, sha)
	if err != nil {
		return fail(repoPath, command, stdout, stderr, "", "")
	}
	return ok(repoPath, command, stdout, stderr)
}

// AmendCommit rewrites the most recent commit. When addAll is true the working
// tree is staged first; an empty message keeps the existing one.
func AmendCommit(repoPath, message string, addAll bool) OpResult {
	if addAll {
		if _, stderr, command, err := runFull(repoPath, "add", "-A"); err != nil {
			return fail(repoPath, command, "", stderr, "", "")
		}
	}
	args := []string{"commit", "--amend"}
	if strings.TrimSpace(message) == "" {
		args = append(args, "--no-edit")
	} else {
		args = append(args, "-m", message)
	}
	stdout, stderr, command, err := runFull(repoPath, args...)
	if err != nil {
		return fail(repoPath, command, stdout, stderr, "", "")
	}
	return ok(repoPath, command, stdout, stderr)
}

// UndoLastCommit removes the HEAD commit but keeps its changes. keepStaged uses
// a soft reset (changes stay staged); otherwise a mixed reset (unstaged).
func UndoLastCommit(repoPath string, keepStaged bool) OpResult {
	flag := "--mixed"
	if keepStaged {
		flag = "--soft"
	}
	stdout, stderr, command, err := runFull(repoPath, "reset", flag, "HEAD~1")
	if err != nil {
		return fail(repoPath, command, stdout, stderr, "", "")
	}
	return ok(repoPath, command, stdout, stderr)
}

// SquashHeadIntoPrevious folds the HEAD commit into its parent, keeping the
// parent's message. Only valid when the parent is not the root commit.
func SquashHeadIntoPrevious(repoPath string) OpResult {
	if _, err := runGit(repoPath, "rev-parse", "--verify", "HEAD~1"); err != nil {
		return fail(repoPath, "git reset --soft HEAD~1", "", "", CodeError, "no previous commit to squash into")
	}
	if _, stderr, command, err := runFull(repoPath, "reset", "--soft", "HEAD~1"); err != nil {
		return fail(repoPath, command, "", stderr, "", "")
	}
	stdout, stderr, command, err := runFull(repoPath, "commit", "--amend", "--no-edit")
	if err != nil {
		return fail(repoPath, command, stdout, stderr, "", "")
	}
	return ok(repoPath, "git reset --soft HEAD~1 && "+command, stdout, stderr)
}

// ExtractHeadToNewBranch moves the HEAD commit onto a fresh branch and rewinds
// the current branch by one, keeping the working tree intact. Non-destructive:
// the commit survives on newBranch.
func ExtractHeadToNewBranch(repoPath, newBranch string) OpResult {
	newBranch = strings.TrimSpace(newBranch)
	if !validRefName("heads", newBranch) {
		return fail(repoPath, "git branch "+newBranch, "", "", CodeError, "invalid branch name: "+newBranch)
	}
	if branchExists(repoPath, newBranch) {
		return fail(repoPath, "git branch "+newBranch, "", "", CodeError, "branch already exists: "+newBranch)
	}
	if _, err := runGit(repoPath, "rev-parse", "--verify", "HEAD~1"); err != nil {
		return fail(repoPath, "git reset --keep HEAD~1", "", "", CodeError, "cannot rewind the root commit")
	}
	if _, stderr, command, err := runFull(repoPath, "branch", newBranch); err != nil {
		return fail(repoPath, command, "", stderr, "", "")
	}
	stdout, stderr, command, err := runFull(repoPath, "reset", "--keep", "HEAD~1")
	if err != nil {
		return fail(repoPath, command, stdout, stderr, "", "")
	}
	return ok(repoPath, "git branch "+newBranch+" && "+command, stdout, stderr)
}

// conflictCodeIfAny returns CodeConflict when the repo currently has conflicted
// files, else an empty string (so fail() classifies it as a generic error).
func conflictCodeIfAny(repoPath string) string {
	if len(conflictChanges(repoPath)) > 0 {
		return CodeConflict
	}
	return ""
}
