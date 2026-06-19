package git

import "strings"

// branchExists reports whether a local branch ref is already present.
func branchExists(repoPath, branch string) bool {
	_, err := runGit(repoPath, "rev-parse", "--verify", "--quiet", "refs/heads/"+branch)
	return err == nil
}

// tagExists reports whether a tag ref is already present.
func tagExists(repoPath, name string) bool {
	_, err := runGit(repoPath, "rev-parse", "--verify", "--quiet", "refs/tags/"+name)
	return err == nil
}

// validRefName uses git's own validator so our naming rules match git exactly.
func validRefName(kind, name string) bool {
	name = strings.TrimSpace(name)
	if name == "" {
		return false
	}
	_, err := runGit("", "check-ref-format", "refs/"+kind+"/"+name)
	return err == nil
}

func hasOrigin(repoPath string) bool {
	out, _ := runGit(repoPath, "remote")
	for _, r := range splitLines(out) {
		if r == "origin" {
			return true
		}
	}
	return false
}

// CheckoutCommit checks out a commit. When newBranch is empty it enters detached
// HEAD; otherwise it creates and switches to newBranch at the commit. The dialog
// is responsible for warning about detached HEAD before calling this.
func CheckoutCommit(repoPath, ref, newBranch string) OpResult {
	ref = strings.TrimSpace(ref)
	if ref == "" {
		return fail(repoPath, "git checkout", "", "", CodeError, "commit ref is empty")
	}
	newBranch = strings.TrimSpace(newBranch)
	var args []string
	if newBranch != "" {
		if !validRefName("heads", newBranch) {
			return fail(repoPath, "git checkout -b "+newBranch, "", "", CodeError, "invalid branch name: "+newBranch)
		}
		if branchExists(repoPath, newBranch) {
			return fail(repoPath, "git checkout -b "+newBranch, "", "", CodeError, "branch already exists: "+newBranch)
		}
		args = []string{"checkout", "-b", newBranch, ref}
	} else {
		args = []string{"checkout", ref}
	}
	stdout, stderr, command, err := runFull(repoPath, args...)
	if err != nil {
		return fail(repoPath, command, stdout, stderr, "", "")
	}
	return ok(repoPath, command, stdout, stderr)
}

// CreateBranchFromCommit creates a branch at ref, optionally checking it out and
// pushing it to origin. Names are validated and duplicates rejected.
func CreateBranchFromCommit(repoPath, branch, ref string, checkout, push bool) OpResult {
	branch = strings.TrimSpace(branch)
	ref = strings.TrimSpace(ref)
	if !validRefName("heads", branch) {
		return fail(repoPath, "git branch "+branch, "", "", CodeError, "invalid branch name: "+branch)
	}
	if branchExists(repoPath, branch) {
		return fail(repoPath, "git branch "+branch, "", "", CodeError, "branch already exists: "+branch)
	}
	var args []string
	if checkout {
		args = []string{"checkout", "-b", branch}
	} else {
		args = []string{"branch", branch}
	}
	if ref != "" {
		args = append(args, ref)
	}
	stdout, stderr, command, err := runFull(repoPath, args...)
	if err != nil {
		return fail(repoPath, command, stdout, stderr, "", "")
	}
	res := ok(repoPath, command, stdout, stderr)
	if push {
		if !hasOrigin(repoPath) {
			res.Error = "Branch created locally; no 'origin' remote to push to."
			return res
		}
		pOut, pErr, pCmd, err := runFull(repoPath, "push", "-u", "origin", branch)
		res.Command = res.Command + " && " + pCmd
		res.Stdout = joinStreams(res.Stdout, pOut)
		res.Stderr = joinStreams(res.Stderr, pErr)
		if err != nil {
			res.Success = false
			res.Code = CodeError
			res.Error = "Branch created but push failed: " + firstNonEmpty(pErr, pOut)
		}
	}
	return res
}

// CreateTagFromCommit creates a lightweight or annotated tag at ref, optionally
// pushing it to origin. Duplicate names are rejected.
func CreateTagFromCommit(repoPath, name, ref, message string, annotated, push bool) OpResult {
	name = strings.TrimSpace(name)
	ref = strings.TrimSpace(ref)
	if !validRefName("tags", name) {
		return fail(repoPath, "git tag "+name, "", "", CodeError, "invalid tag name: "+name)
	}
	if tagExists(repoPath, name) {
		return fail(repoPath, "git tag "+name, "", "", CodeError, "tag already exists: "+name)
	}
	var args []string
	if annotated {
		if strings.TrimSpace(message) == "" {
			message = name
		}
		args = []string{"tag", "-a", name, "-m", message}
	} else {
		args = []string{"tag", name}
	}
	if ref != "" {
		args = append(args, ref)
	}
	stdout, stderr, command, err := runFull(repoPath, args...)
	if err != nil {
		return fail(repoPath, command, stdout, stderr, "", "")
	}
	res := ok(repoPath, command, stdout, stderr)
	if push {
		if !hasOrigin(repoPath) {
			res.Error = "Tag created locally; no 'origin' remote to push to."
			return res
		}
		pOut, pErr, pCmd, err := runFull(repoPath, "push", "origin", "refs/tags/"+name)
		res.Command = res.Command + " && " + pCmd
		res.Stdout = joinStreams(res.Stdout, pOut)
		res.Stderr = joinStreams(res.Stderr, pErr)
		if err != nil {
			res.Success = false
			res.Code = CodeError
			res.Error = "Tag created but push failed: " + firstNonEmpty(pErr, pOut)
		}
	}
	return res
}

// ForcePush force-pushes the current branch with --force-with-lease, the safe
// variant that refuses to clobber unseen upstream work. Requires an origin.
func ForcePush(repoPath, branch string) OpResult {
	branch = strings.TrimSpace(branch)
	if branch == "" {
		return fail(repoPath, "git push --force-with-lease", "", "", CodeError, "branch is empty")
	}
	if !hasOrigin(repoPath) {
		return fail(repoPath, "git push --force-with-lease", "", "", CodeError, "no 'origin' remote to push to")
	}
	stdout, stderr, command, err := runFull(repoPath, "push", "--force-with-lease", "origin", branch)
	if err != nil {
		return fail(repoPath, command, stdout, stderr, "", "")
	}
	return ok(repoPath, command, stdout, stderr)
}

func joinStreams(a, b string) string {
	a, b = strings.TrimSpace(a), strings.TrimSpace(b)
	switch {
	case a == "":
		return b
	case b == "":
		return a
	default:
		return a + "\n" + b
	}
}

func firstNonEmpty(values ...string) string {
	for _, v := range values {
		if strings.TrimSpace(v) != "" {
			return v
		}
	}
	return ""
}
