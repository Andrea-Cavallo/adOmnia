package git

import "strings"

// BisectStart begins a bisect session bracketed by a known-bad and known-good
// commit. HEAD is left at the midpoint to test.
func BisectStart(repoPath, bad, good string) OpResult {
	bad = strings.TrimSpace(bad)
	good = strings.TrimSpace(good)
	if bad == "" || good == "" {
		return fail(repoPath, "git bisect start", "", "", CodeError, "both a bad and a good commit are required")
	}
	if op := inProgressOperation(repoPath); op != "" && op != "bisect" {
		return fail(repoPath, "git bisect start", "", "", CodeAborted, "cannot start bisect while a "+op+" is in progress")
	}
	stdout, stderr, command, err := runFull(repoPath, "bisect", "start", bad, good)
	if err != nil {
		return fail(repoPath, command, stdout, stderr, CodeError, "")
	}
	return ok(repoPath, command, stdout, stderr)
}

// BisectMark marks the current revision as good, bad or skipped and advances.
func BisectMark(repoPath, verdict string) OpResult {
	verdict = strings.TrimSpace(verdict)
	if verdict != "good" && verdict != "bad" && verdict != "skip" {
		return fail(repoPath, "git bisect", "", "", CodeError, "verdict must be good, bad or skip")
	}
	stdout, stderr, command, err := runFull(repoPath, "bisect", verdict)
	if err != nil {
		return fail(repoPath, command, stdout, stderr, CodeError, "")
	}
	return ok(repoPath, command, stdout, stderr)
}

// BisectRun automates the search with a test command (e.g. "go test ./...").
// git treats a zero exit as good and non-zero as bad.
func BisectRun(repoPath, command string) OpResult {
	fields := strings.Fields(strings.TrimSpace(command))
	if len(fields) == 0 {
		return fail(repoPath, "git bisect run", "", "", CodeError, "test command is empty")
	}
	args := append([]string{"bisect", "run"}, fields...)
	stdout, stderr, cmd, err := runFull(repoPath, args...)
	if err != nil {
		// A non-zero exit from `git bisect run` can still mean it concluded; the
		// stdout carries the "first bad commit" line, so report it as success
		// when a culprit was identified.
		if FirstBadCommit(stdout) != "" {
			return ok(repoPath, cmd, stdout, stderr)
		}
		return fail(repoPath, cmd, stdout, stderr, CodeError, "")
	}
	return ok(repoPath, cmd, stdout, stderr)
}

// BisectReset ends the bisect session and returns to the original HEAD.
func BisectReset(repoPath string) OpResult {
	stdout, stderr, command, err := runFull(repoPath, "bisect", "reset")
	if err != nil {
		return fail(repoPath, command, stdout, stderr, CodeError, "")
	}
	res := ok(repoPath, command, stdout, stderr)
	res.Code = CodeAborted
	return res
}

// FirstBadCommit extracts the culprit SHA from bisect output, or "" if the
// search has not concluded yet.
func FirstBadCommit(output string) string {
	for _, line := range strings.Split(output, "\n") {
		if strings.Contains(line, "is the first bad commit") {
			return strings.Fields(line)[0]
		}
	}
	return ""
}
