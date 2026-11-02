package git

import (
	"crypto/sha256"
	"encoding/hex"
	"fmt"
	"strings"
)

// AddWorktreeFrom creates branch at ref and checks it out in path. It is the
// starting point of an isolated agent workspace: the new branch is created from
// the exact commit the user chose, not from whatever HEAD currently is.
func AddWorktreeFrom(repoPath, path, branch, ref string) error {
	path, branch, ref = strings.TrimSpace(path), strings.TrimSpace(branch), strings.TrimSpace(ref)
	if path == "" {
		return fmt.Errorf("worktree path is required")
	}
	if branch == "" {
		return fmt.Errorf("new branch name is required")
	}
	if strings.HasPrefix(branch, "-") || strings.ContainsAny(branch, " \t\r\n\x00") || !validRefName("heads", branch) {
		return fmt.Errorf("invalid branch name %q", branch)
	}
	if ref == "" {
		ref = "HEAD"
	}
	if strings.HasPrefix(ref, "-") || strings.ContainsAny(ref, " \t\r\n\x00") {
		return fmt.Errorf("invalid revision %q", ref)
	}
	_, err := runGit(repoPath, "worktree", "add", "-b", branch, path, ref)
	return err
}

// WorkingTreeFingerprint identifies the content of a working tree relative to ref:
// a SHA-256 over the binary patch of everything that differs from ref (commits, edits
// and new files, the mirrored AI policy excluded), and the number of changed paths.
// It depends only on content: committing the same changes keeps the same fingerprint,
// so evidence measured before a commit still names the committed content.
func WorkingTreeFingerprint(repoPath, ref string) (string, int, error) {
	ref = strings.TrimSpace(ref)
	if ref == "" {
		ref = "HEAD"
	}
	patch, files, err := WorkspacePatch(repoPath, ref)
	if err != nil {
		return "", 0, err
	}
	sum := sha256.Sum256([]byte(patch))
	return hex.EncodeToString(sum[:]), len(files), nil
}
