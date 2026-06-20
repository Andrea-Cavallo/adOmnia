package git

import (
	"fmt"
	"strings"
	"time"
)

// StashPaths stashes only the selected paths, including untracked files. Other
// working-tree changes stay in place, which makes stash useful during focused
// context switches instead of forcing an all-or-nothing save.
func StashPaths(repoPath string, paths []string) error {
	clean := make([]string, 0, len(paths))
	seen := map[string]bool{}
	for _, path := range paths {
		path = strings.TrimSpace(path)
		if path != "" && !seen[path] {
			clean = append(clean, path)
			seen[path] = true
		}
	}
	if len(clean) == 0 {
		return fmt.Errorf("select at least one file to stash")
	}
	args := []string{"stash", "push", "-u", "-m", "adOmnia selected stash " + time.Now().Format("2006-01-02 15:04:05"), "--"}
	_, err := runGit(repoPath, append(args, clean...)...)
	return err
}

// StashApply applies a stash without removing it (unlike StashPop). Empty ref
// defaults to the most recent stash.
func StashApply(repoPath, ref string) error {
	ref = strings.TrimSpace(ref)
	if ref == "" {
		ref = "stash@{0}"
	}
	_, err := runGit(repoPath, "stash", "apply", ref)
	return err
}

// StashShow returns the patch (diff) of a stash entry for preview.
func StashShow(repoPath, ref string) (string, error) {
	ref = strings.TrimSpace(ref)
	if ref == "" {
		ref = "stash@{0}"
	}
	return runGit(repoPath, "stash", "show", "-p", ref)
}
