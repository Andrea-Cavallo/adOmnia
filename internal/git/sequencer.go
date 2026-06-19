package git

import (
	"bytes"
	"os"
	"os/exec"
	"strings"
)

// noOpEditorEnv returns env entries that make git use a non-interactive,
// no-op editor. The "editor" is git itself invoked as `git --version <file>`,
// which ignores the file and exits 0 — so `--continue` keeps the existing
// commit message instead of blocking on a real editor. Works cross-platform.
func noOpEditorEnv() []string {
	gitPath, err := exec.LookPath("git")
	if err != nil {
		gitPath = "git"
	}
	editor := quoteIfNeeded(gitPath) + " --version"
	return []string{
		"GIT_EDITOR=" + editor,
		"GIT_SEQUENCE_EDITOR=" + editor,
	}
}

func quoteIfNeeded(p string) string {
	if strings.ContainsAny(p, " \t") {
		return "\"" + p + "\""
	}
	return p
}

// runFullWithEnv is runFull with extra environment variables appended.
func runFullWithEnv(dir string, extraEnv []string, args ...string) (stdout, stderr, command string, err error) {
	command = "git " + strings.Join(args, " ")
	cmd := exec.Command("git", args...)
	cmd.Dir = dir
	cmd.Env = append(os.Environ(), extraEnv...)
	configureHiddenCommand(cmd)
	var out, errBuf bytes.Buffer
	cmd.Stdout = &out
	cmd.Stderr = &errBuf
	err = cmd.Run()
	return strings.TrimSpace(out.String()), strings.TrimSpace(errBuf.String()), command, err
}

// ContinueOperation continues whichever sequencer operation is in progress
// (rebase / cherry-pick / revert / merge) after the user resolved conflicts.
func ContinueOperation(repoPath string) OpResult {
	op := inProgressOperation(repoPath)
	if op == "" {
		return fail(repoPath, "git --continue", "", "", CodeError, "no operation in progress to continue")
	}
	// Refuse to continue while conflict markers remain unresolved/unstaged.
	if len(conflictChanges(repoPath)) > 0 {
		return fail(repoPath, "git "+op+" --continue", "", "", CodeConflict, "resolve and stage all conflicts before continuing")
	}
	var args []string
	switch op {
	case "rebase":
		args = []string{"rebase", "--continue"}
	case "cherry-pick":
		args = []string{"cherry-pick", "--continue"}
	case "revert":
		args = []string{"revert", "--continue"}
	case "merge":
		args = []string{"merge", "--continue"}
	default:
		return fail(repoPath, "git --continue", "", "", CodeError, "cannot continue a "+op)
	}
	stdout, stderr, command, err := runFullWithEnv(repoPath, noOpEditorEnv(), args...)
	if err != nil {
		return fail(repoPath, command, stdout, stderr, conflictCodeIfAny(repoPath), "")
	}
	return ok(repoPath, command, stdout, stderr)
}

// SkipOperation skips the current commit in a rebase/cherry-pick/revert.
func SkipOperation(repoPath string) OpResult {
	op := inProgressOperation(repoPath)
	switch op {
	case "rebase", "cherry-pick", "revert":
		stdout, stderr, command, err := runFullWithEnv(repoPath, noOpEditorEnv(), op, "--skip")
		if err != nil {
			return fail(repoPath, command, stdout, stderr, conflictCodeIfAny(repoPath), "")
		}
		return ok(repoPath, command, stdout, stderr)
	default:
		return fail(repoPath, "git --skip", "", "", CodeError, "no skippable operation in progress")
	}
}

// AbortOperation aborts the current merge/rebase/cherry-pick/revert/bisect,
// restoring the pre-operation state.
func AbortOperation(repoPath string) OpResult {
	op := inProgressOperation(repoPath)
	var args []string
	switch op {
	case "rebase":
		args = []string{"rebase", "--abort"}
	case "cherry-pick":
		args = []string{"cherry-pick", "--abort"}
	case "revert":
		args = []string{"revert", "--abort"}
	case "merge":
		args = []string{"merge", "--abort"}
	case "bisect":
		args = []string{"bisect", "reset"}
	default:
		return fail(repoPath, "git --abort", "", "", CodeError, "no operation in progress to abort")
	}
	stdout, stderr, command, err := runFull(repoPath, args...)
	if err != nil {
		return fail(repoPath, command, stdout, stderr, CodeError, "")
	}
	res := ok(repoPath, command, stdout, stderr)
	res.Code = CodeAborted
	return res
}
