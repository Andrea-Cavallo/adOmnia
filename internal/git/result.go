package git

import (
	"bytes"
	"os/exec"
	"path/filepath"
	"strings"
)

// OpResult is the single, typed shape every operational Git command returns.
// The frontend service layer parses exactly this contract so callers never have
// to scrape terminal output. Recoverable failures (conflicts, dirty tree,
// protected branch) are reported through Success=false + Code, not panics.
type OpResult struct {
	Success   bool         `json:"success"`
	Command   string       `json:"command"`
	Stdout    string       `json:"stdout"`
	Stderr    string       `json:"stderr"`
	State     RepoState    `json:"state"`
	Conflicts []FileChange `json:"conflicts"`
	Error     string       `json:"error"`
	Code      string       `json:"code"`
}

// Result codes shared with the frontend (lib/git/types.ts must mirror these).
const (
	CodeOK        = "ok"
	CodeConflict  = "conflict"
	CodeDirty     = "dirty"
	CodeProtected = "protected"
	CodePublished = "published"
	CodeAborted   = "aborted"
	CodeError     = "error"
)

// RepoState is a centralized snapshot of everything a safety pre-flight needs:
// current branch/head, detached state, dirtiness, in-progress operations,
// whether the branch is published (has an upstream), and whether it is
// protected. Computed by inspectState and embedded in every OpResult so the UI
// can refresh without a second round-trip.
type RepoState struct {
	Branch          string   `json:"branch"`
	Head            string   `json:"head"`
	Detached        bool     `json:"detached"`
	Dirty           bool     `json:"dirty"`
	Published       bool     `json:"published"`
	Protected       bool     `json:"protected"`
	Operation       string   `json:"operation"` // "" | merge | rebase | cherry-pick | revert | bisect
	ConflictedFiles []string `json:"conflictedFiles"`
	AheadCount      int      `json:"aheadCount"`
	BehindCount     int      `json:"behindCount"`
}

// defaultProtectedBranches are treated as protected unless overridden. The UI
// surfaces a warning (not a hard block) before rewriting these.
var defaultProtectedBranches = map[string]bool{
	"main":    true,
	"master":  true,
	"develop": true,
	"release": true,
}

// runFull runs a git command capturing stdout, stderr and the exact command
// string. Unlike runGit it never discards stderr, so OpResult can surface the
// real reason an operation failed.
func runFull(dir string, args ...string) (stdout, stderr, command string, err error) {
	command = "git " + strings.Join(args, " ")
	cmd := exec.Command("git", args...)
	cmd.Dir = dir
	configureHiddenCommand(cmd)
	var out, errBuf bytes.Buffer
	cmd.Stdout = &out
	cmd.Stderr = &errBuf
	err = cmd.Run()
	return strings.TrimSpace(out.String()), strings.TrimSpace(errBuf.String()), command, err
}

// ok builds a success result, attaching a freshly-computed RepoState.
func ok(repoPath, command, stdout, stderr string) OpResult {
	state, _ := inspectState(repoPath)
	res := OpResult{
		Success:   true,
		Command:   command,
		Stdout:    stdout,
		Stderr:    stderr,
		State:     state,
		Conflicts: []FileChange{},
		Code:      CodeOK,
	}
	// A "successful" git command can still leave conflicts (e.g. cherry-pick
	// that auto-stops): surface them so the UI opens the resolver.
	if len(state.ConflictedFiles) > 0 {
		res.Success = false
		res.Code = CodeConflict
		res.Conflicts = conflictChanges(repoPath)
		res.Error = "Operation stopped with conflicts that need resolution."
	}
	return res
}

// fail builds a failure result with a machine code and the captured streams.
func fail(repoPath, command, stdout, stderr, code, message string) OpResult {
	state, _ := inspectState(repoPath)
	conflicts := []FileChange{}
	if code == CodeConflict || len(state.ConflictedFiles) > 0 {
		if code == "" {
			code = CodeConflict
		}
		conflicts = conflictChanges(repoPath)
	}
	if code == "" {
		code = CodeError
	}
	if message == "" {
		if stderr != "" {
			message = stderr
		} else {
			message = "git operation failed"
		}
	}
	return OpResult{
		Success:   false,
		Command:   command,
		Stdout:    stdout,
		Stderr:    stderr,
		State:     state,
		Conflicts: conflicts,
		Error:     message,
		Code:      code,
	}
}

// InspectState is the exported entry point used by the Wails binding to fetch a
// repository state snapshot on demand.
func InspectState(repoPath string) (RepoState, error) {
	return inspectState(repoPath)
}

// inspectState computes a RepoState snapshot. It tolerates partial failures
// (a fresh repo without HEAD, no upstream, etc.) and always returns usable data.
func inspectState(repoPath string) (RepoState, error) {
	state := RepoState{ConflictedFiles: []string{}}
	if repoPath == "" {
		return state, nil
	}
	if _, err := runGit(repoPath, "rev-parse", "--is-inside-work-tree"); err != nil {
		return state, err
	}

	if head, err := runGit(repoPath, "rev-parse", "HEAD"); err == nil {
		state.Head = head
	}
	branch, _ := runGit(repoPath, "rev-parse", "--abbrev-ref", "HEAD")
	if branch == "HEAD" || branch == "" {
		state.Detached = true
		if state.Head != "" {
			state.Branch = state.Head[:min(7, len(state.Head))]
		}
	} else {
		state.Branch = branch
		state.Protected = isProtected(branch)
	}

	// Working-tree dirtiness + conflict markers from one porcelain pass.
	if porcelain, err := statusPorcelain(repoPath); err == nil {
		conflicts := []string{}
		dirty := false
		conflictCodes := map[string]bool{"DD": true, "AU": true, "UD": true, "UA": true, "DU": true, "AA": true, "UU": true}
		for _, line := range strings.Split(porcelain, "\n") {
			if len(line) < 4 {
				continue
			}
			dirty = true
			code := line[:2]
			if conflictCodes[code] {
				conflicts = append(conflicts, strings.TrimSpace(line[3:]))
			}
		}
		state.Dirty = dirty
		state.ConflictedFiles = conflicts
	}

	// Published = current branch has an upstream tracking ref.
	if !state.Detached {
		if _, err := runGit(repoPath, "rev-parse", "--abbrev-ref", "--symbolic-full-name", "@{upstream}"); err == nil {
			state.Published = true
		}
		if ab, err := runGit(repoPath, "rev-list", "--left-right", "--count", "HEAD...@{upstream}"); err == nil {
			parseAheadBehind(ab, &state.AheadCount, &state.BehindCount)
		}
	}

	state.Operation = inProgressOperation(repoPath)
	return state, nil
}

// inProgressOperation detects an interrupted merge/rebase/cherry-pick/revert/
// bisect by probing the git dir for the marker files git itself writes.
func inProgressOperation(repoPath string) string {
	gitDir, err := runGit(repoPath, "rev-parse", "--git-dir")
	if err != nil || gitDir == "" {
		return ""
	}
	if !filepath.IsAbs(gitDir) {
		gitDir = filepath.Join(repoPath, gitDir)
	}
	type marker struct {
		op   string
		path string
	}
	markers := []marker{
		{"rebase", filepath.Join(gitDir, "rebase-merge")},
		{"rebase", filepath.Join(gitDir, "rebase-apply")},
		{"merge", filepath.Join(gitDir, "MERGE_HEAD")},
		{"cherry-pick", filepath.Join(gitDir, "CHERRY_PICK_HEAD")},
		{"revert", filepath.Join(gitDir, "REVERT_HEAD")},
		{"bisect", filepath.Join(gitDir, "BISECT_LOG")},
	}
	for _, m := range markers {
		if pathExists(m.path) {
			return m.op
		}
	}
	return ""
}

// conflictChanges returns the conflicted files as FileChange entries (reusing
// the porcelain parser) so the resolver UI gets full status detail.
func conflictChanges(repoPath string) []FileChange {
	porcelain, err := statusPorcelain(repoPath)
	if err != nil {
		return []FileChange{}
	}
	conflicts := []FileChange{}
	for _, change := range parsePorcelain(porcelain) {
		if change.Conflicted {
			conflicts = append(conflicts, change)
		}
	}
	return conflicts
}

func isProtected(branch string) bool {
	return defaultProtectedBranches[strings.TrimSpace(branch)]
}

func parseAheadBehind(s string, ahead, behind *int) {
	fields := strings.Fields(s)
	if len(fields) == 2 {
		*ahead = atoiSafe(fields[0])
		*behind = atoiSafe(fields[1])
	}
}
