package git

import (
	"bytes"
	"fmt"
	"os"
	"path/filepath"
	"slices"
	"strconv"
	"strings"

	"github.com/Andrea-Cavallo/adOmnia/internal/procutil"
)

// mirroredPolicyPath is the AI policy adOmnia copies into an agent worktree. It is
// configuration, not the agent's work: it never travels back into the project.
const mirroredPolicyPath = ".adomnia/ai-policy.json"

// WorkspacePatch returns everything an agent worktree changed since base — commits,
// edits and new files, binary included — as a patch apply-able with `git apply
// --3way`, plus the changed paths. New files are staged into a temporary index, so
// the worktree's own index and status (and the evidence fingerprint) stay untouched.
func WorkspacePatch(worktree, base string) (string, []string, error) {
	base = strings.TrimSpace(base)
	if base == "" || strings.HasPrefix(base, "-") || strings.ContainsAny(base, " \t\r\n\x00") {
		return "", nil, fmt.Errorf("invalid base revision %q", base)
	}
	index, err := os.CreateTemp("", "adomnia-index-*")
	if err != nil {
		return "", nil, fmt.Errorf("create a temporary index: %w", err)
	}
	indexPath := index.Name()
	_ = index.Close()        // git writes the file itself
	_ = os.Remove(indexPath) // an empty file is not a valid index; git creates it
	defer os.Remove(indexPath)
	env := []string{"GIT_INDEX_FILE=" + indexPath}
	// Copiare l'indice vero porta con sé le informazioni di stat: `add -A` rilegge solo i
	// file cambiati. Senza indice (repository appena creato) si parte da HEAD.
	if err := copyIndex(worktree, indexPath); err != nil {
		if _, err := runRaw(worktree, env, "read-tree", "HEAD"); err != nil {
			return "", nil, err
		}
	}
	if _, err := runRaw(worktree, env, "add", "-A"); err != nil {
		return "", nil, err
	}
	exclude := ":(exclude)" + mirroredPolicyPath
	names, err := runRaw(worktree, env, "diff", "--cached", "--name-only", base, "--", ".", exclude)
	if err != nil {
		return "", nil, err
	}
	var files []string
	for line := range strings.SplitSeq(names, "\n") {
		if line = strings.TrimSpace(line); line != "" {
			files = append(files, line)
		}
	}
	if len(files) == 0 {
		return "", nil, nil
	}
	patch, err := runRaw(worktree, env, "diff", "--cached", "--binary", "--full-index", base, "--", ".", exclude)
	if err != nil {
		return "", nil, err
	}
	return patch, files, nil
}

// copyIndex copies the working tree's own index to target.
func copyIndex(worktree, target string) error {
	indexPath, err := runGit(worktree, "rev-parse", "--path-format=absolute", "--git-path", "index")
	if err != nil {
		return err
	}
	content, err := os.ReadFile(filepath.Clean(indexPath)) // #nosec G304 -- path reported by git for this working tree
	if err != nil {
		return err
	}
	return os.WriteFile(target, content, 0o600)
}

// TargetComparison describes the project branch a workspace would be integrated into.
type TargetComparison struct {
	Branch string `json:"branch"`
	Head   string `json:"head"`
	// CommitsSinceBase counts the commits the target received after the workspace started.
	CommitsSinceBase int `json:"commitsSinceBase"`
	// ChangedSinceBase lists files the target changed after the workspace started.
	ChangedSinceBase []string `json:"changedSinceBase"`
	// LocalChanges lists files with uncommitted changes in the project working tree.
	LocalChanges []string `json:"localChanges"`
}

// CompareTarget reads the project's current branch relative to base.
func CompareTarget(repo, base string) (TargetComparison, error) {
	var result TargetComparison
	branch, err := runGit(repo, "rev-parse", "--abbrev-ref", "HEAD")
	if err != nil {
		return result, err
	}
	head, err := runGit(repo, "rev-parse", "HEAD")
	if err != nil {
		return result, err
	}
	result.Branch, result.Head = branch, head
	count, err := runGit(repo, "rev-list", "--count", base+"..HEAD")
	if err != nil {
		return result, err
	}
	if result.CommitsSinceBase, err = strconv.Atoi(strings.TrimSpace(count)); err != nil {
		return result, fmt.Errorf("read the commit count: %w", err)
	}
	changed, err := runGit(repo, "diff", "--name-only", base, "HEAD")
	if err != nil {
		return result, err
	}
	result.ChangedSinceBase = nonEmptyLines(changed)
	status, err := runGit(repo, "status", "--porcelain", "-uall")
	if err != nil {
		return result, err
	}
	for _, line := range nonEmptyLines(status) {
		if len(line) > 3 {
			path := line[3:]
			if _, renamed, ok := strings.Cut(path, " -> "); ok {
				path = renamed
			}
			result.LocalChanges = append(result.LocalChanges, strings.Trim(path, `"`))
		}
	}
	return result, nil
}

// IntegrationResult is the outcome of applying a workspace patch to the project.
type IntegrationResult struct {
	Applied   bool     `json:"applied"`
	Conflicts []string `json:"conflicts"`
	Output    string   `json:"output"`
}

// IntegratePatch applies patch to the project with a 3-way merge. With check it only
// reports whether it would apply. The changes are staged, never committed; a conflict
// leaves the usual markers for the Git panel. Git refuses — and nothing changes — when a
// touched file has uncommitted edits that do not match the index.
func IntegratePatch(repo, patch string, check bool) (IntegrationResult, error) {
	if strings.TrimSpace(patch) == "" {
		return IntegrationResult{}, fmt.Errorf("the workspace has no changes to integrate")
	}
	file, err := os.CreateTemp("", "adomnia-integrate-*.patch")
	if err != nil {
		return IntegrationResult{}, fmt.Errorf("create a temporary patch: %w", err)
	}
	defer os.Remove(file.Name())
	if _, err := file.WriteString(patch); err != nil {
		_ = file.Close()
		return IntegrationResult{}, fmt.Errorf("write the temporary patch: %w", err)
	}
	if err := file.Close(); err != nil {
		return IntegrationResult{}, fmt.Errorf("write the temporary patch: %w", err)
	}
	args := []string{"apply", "--3way", "--whitespace=nowarn"}
	if check {
		args = append(args, "--check")
	}
	output, runErr := runRaw(repo, nil, append(args, filepath.Clean(file.Name()))...)
	result := IntegrationResult{Output: strings.TrimSpace(output)}
	if !check {
		unmerged, err := runGit(repo, "diff", "--name-only", "--diff-filter=U")
		if err == nil {
			result.Conflicts = nonEmptyLines(unmerged)
		}
	}
	if runErr != nil && len(result.Conflicts) == 0 {
		result.Output = strings.TrimSpace(result.Output + "\n" + runErr.Error())
		return result, nil
	}
	result.Applied = true
	return result, nil
}

// runRaw runs git keeping stdout byte-exact (patches need their trailing newline);
// stderr is merged into the error.
func runRaw(dir string, extraEnv []string, args ...string) (string, error) {
	ctx, cancel := gitContext(args)
	defer cancel()
	cmd := procutil.CommandContext(ctx, "git", args...)
	cmd.Dir = dir
	cmd.Env = append(gitEnviron(), extraEnv...)
	var out, errBuf bytes.Buffer
	cmd.Stdout = &out
	cmd.Stderr = &errBuf
	if err := cmd.Run(); err != nil {
		if timedOut(ctx) {
			return "", gitTimeoutError(args)
		}
		return out.String(), fmt.Errorf("git %s: %s", args[0], strings.TrimSpace(firstNonEmpty(errBuf.String(), err.Error())))
	}
	return out.String(), nil
}

func nonEmptyLines(text string) []string {
	lines := []string{}
	for line := range strings.SplitSeq(text, "\n") {
		if line = strings.TrimSpace(line); line != "" {
			lines = append(lines, line)
		}
	}
	return slices.Clip(lines)
}

// MainRepository returns the root of the repository a linked worktree belongs to
// (the folder holding the shared .git directory).
func MainRepository(worktree string) (string, error) {
	common, err := runGit(worktree, "rev-parse", "--path-format=absolute", "--git-common-dir")
	if err != nil {
		return "", err
	}
	common = filepath.Clean(strings.TrimSpace(common))
	if filepath.Base(common) != ".git" {
		return "", fmt.Errorf("%s is not inside a repository with a working tree", worktree)
	}
	return filepath.Dir(common), nil
}

// PendingFiles lists the uncommitted changes of a working tree (new files included),
// without the mirrored AI policy.
func PendingFiles(worktree string) ([]string, error) {
	status, err := runRaw(worktree, nil, "status", "--porcelain", "-uall", "--", ".", ":(exclude)"+mirroredPolicyPath)
	if err != nil {
		return nil, err
	}
	files := []string{}
	for line := range strings.SplitSeq(status, "\n") {
		line = strings.TrimRight(line, "\r")
		if len(line) <= 3 {
			continue
		}
		path := line[3:]
		if _, renamed, ok := strings.Cut(path, " -> "); ok {
			path = renamed
		}
		files = append(files, strings.Trim(path, `"`))
	}
	return files, nil
}

// CommitWorktree commits every pending change of an agent worktree (never the mirrored
// AI policy) and returns the new commit and its files. It is meant for the task's own
// branch: the user's project branch is changed only by an explicit integration.
func CommitWorktree(worktree, message string) (string, []string, error) {
	message = strings.TrimSpace(message)
	if message == "" {
		return "", nil, fmt.Errorf("a commit message is required")
	}
	files, err := PendingFiles(worktree)
	if err != nil {
		return "", nil, err
	}
	if len(files) == 0 {
		return "", nil, fmt.Errorf("there is nothing to commit")
	}
	if _, err := runRaw(worktree, nil, "add", "-A", "--", ".", ":(exclude)"+mirroredPolicyPath); err != nil {
		return "", nil, err
	}
	if _, err := runRaw(worktree, nil, "commit", "-m", message); err != nil {
		return "", nil, err
	}
	sha, err := runGit(worktree, "rev-parse", "HEAD")
	if err != nil {
		return "", nil, err
	}
	return sha, files, nil
}
