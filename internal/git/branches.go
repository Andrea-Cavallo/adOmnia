package git

import (
	"fmt"
	"strings"
)

// localBranchName derives the local branch name from a remote-tracking ref like
// "remotes/origin/feature" or "origin/feature" → "feature".
func localBranchName(remoteRef string) string {
	n := strings.TrimPrefix(strings.TrimSpace(remoteRef), "remotes/")
	if i := strings.Index(n, "/"); i >= 0 {
		return n[i+1:]
	}
	return n
}

// CheckoutRemoteBranch checks out a remote-tracking branch as a local tracking
// branch (or switches to the existing local branch of the same name).
func CheckoutRemoteBranch(repoPath, remoteRef string) error {
	remoteRef = strings.TrimSpace(remoteRef)
	if remoteRef == "" {
		return fmt.Errorf("remote branch is empty")
	}
	tracking := strings.TrimPrefix(remoteRef, "remotes/")
	local := localBranchName(remoteRef)
	if local == "" {
		return fmt.Errorf("cannot derive local branch name from %q", remoteRef)
	}
	if _, err := runGit(repoPath, "rev-parse", "--verify", "refs/heads/"+local); err == nil {
		_, err := runGit(repoPath, "checkout", local)
		return err
	}
	_, err := runGit(repoPath, "checkout", "-b", local, "--track", tracking)
	return err
}

// DeleteLocalBranch deletes a local branch. force uses -D (drop even if unmerged).
func DeleteLocalBranch(repoPath, branch string, force bool) error {
	branch = strings.TrimSpace(branch)
	if branch == "" {
		return fmt.Errorf("branch name is empty")
	}
	flag := "-d"
	if force {
		flag = "-D"
	}
	_, err := runGit(repoPath, "branch", flag, branch)
	return err
}

// DeleteRemoteBranch deletes a branch on the remote (`git push <remote> --delete
// <branch>`). Outward-facing — the UI must confirm before calling.
func DeleteRemoteBranch(repoPath, remote, branch string) error {
	remote = strings.TrimSpace(remote)
	branch = strings.TrimSpace(branch)
	if remote == "" || branch == "" {
		return fmt.Errorf("remote and branch are required")
	}
	_, err := runGit(repoPath, "push", remote, "--delete", branch)
	return err
}

// SetUpstream sets the upstream tracking ref for a local branch.
func SetUpstream(repoPath, branch, upstream string) error {
	branch = strings.TrimSpace(branch)
	upstream = strings.TrimSpace(upstream)
	if branch == "" || upstream == "" {
		return fmt.Errorf("branch and upstream are required")
	}
	_, err := runGit(repoPath, "branch", "--set-upstream-to="+upstream, branch)
	return err
}
