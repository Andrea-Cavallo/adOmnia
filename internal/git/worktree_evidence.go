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
// a SHA-256 over the binary diff plus the porcelain status (untracked included),
// and the number of changed paths. Evidence uses it to name what it measured, so
// a later verification can prove whether the content is the same one.
func WorkingTreeFingerprint(repoPath, ref string) (string, int, error) {
	ref = strings.TrimSpace(ref)
	if ref == "" {
		ref = "HEAD"
	}
	if strings.HasPrefix(ref, "-") || strings.ContainsAny(ref, " \t\r\n\x00") {
		return "", 0, fmt.Errorf("invalid reference %q", ref)
	}
	status, err := runGit(repoPath, "status", "--porcelain", "-uall")
	if err != nil {
		return "", 0, err
	}
	// La policy AI copiata da adOmnia nel worktree è configurazione, non contenuto
	// dell'agente: non deve comparire come file modificato nelle evidenze.
	status = withoutMirroredPolicy(status)
	diff, err := runGit(repoPath, "diff", "--no-color", "--binary", ref)
	if err != nil {
		return "", 0, err
	}
	sum := sha256.Sum256([]byte(status + "\x00" + diff))
	changed := 0
	for line := range strings.SplitSeq(status, "\n") {
		if strings.TrimSpace(line) != "" {
			changed++
		}
	}
	return hex.EncodeToString(sum[:]), changed, nil
}

func withoutMirroredPolicy(status string) string {
	const mirrored = ".adomnia/ai-policy.json"
	kept := make([]string, 0, 8)
	for line := range strings.SplitSeq(status, "\n") {
		if strings.HasSuffix(strings.TrimSpace(line), mirrored) {
			continue
		}
		kept = append(kept, line)
	}
	return strings.Join(kept, "\n")
}
