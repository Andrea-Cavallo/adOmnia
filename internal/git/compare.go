package git

import (
	"bytes"
	"fmt"
	"os"
	"os/exec"
	"strings"
)

// CompareResult is the structured output of a commit/branch/tag/worktree compare.
type CompareResult struct {
	RefA      string        `json:"refA"`
	RefB      string        `json:"refB"`
	Files     []ChangedFile `json:"files"`
	Additions int           `json:"additions"`
	Deletions int           `json:"deletions"`
}

// standard pretty format shared by every commit-listing command, matching the
// field order GetOverview already parses (%h %H %P %an %ad %s %D).
const commitLogFormat = "--pretty=format:%h%x1f%H%x1f%P%x1f%an%x1f%ad%x1f%s%x1f%D"

// diffArgs turns (refA, refB) into git diff arguments, transparently supporting
// range notation like "84f63e3..HEAD" (or "...") passed in refA with empty refB.
func diffArgs(refA, refB string) []string {
	refA = strings.TrimSpace(refA)
	refB = strings.TrimSpace(refB)
	if refB == "" && strings.Contains(refA, "..") {
		return []string{refA}
	}
	if refB == "" {
		return []string{refA}
	}
	return []string{refA, refB}
}

// CompareCommits returns the changed files plus aggregate additions/deletions
// between two refs. refA may be a range ("A..B") with refB empty.
func CompareCommits(repoPath, refA, refB string) (CompareResult, error) {
	result := CompareResult{RefA: refA, RefB: refB, Files: []ChangedFile{}}
	base := diffArgs(refA, refB)

	nameStatus, _, _, err := runFull(repoPath, append([]string{"diff", "--name-status", "--find-renames"}, base...)...)
	if err != nil {
		return result, fmt.Errorf("git diff --name-status: %w", err)
	}
	result.Files = parseNameStatus(nameStatus)

	numstat, _, _, err := runFull(repoPath, append([]string{"diff", "--numstat"}, base...)...)
	if err == nil {
		for _, line := range strings.Split(numstat, "\n") {
			fields := strings.Split(strings.TrimSpace(line), "\t")
			if len(fields) < 3 {
				continue
			}
			// Binary files report "-" for counts; treat as 0.
			result.Additions += atoiSafe(fields[0])
			result.Deletions += atoiSafe(fields[1])
		}
	}
	return result, nil
}

// parseNameStatus parses `git diff --name-status` into ChangedFile entries,
// handling rename/copy lines (R100 old new).
func parseNameStatus(out string) []ChangedFile {
	files := []ChangedFile{}
	for _, line := range strings.Split(strings.TrimSpace(out), "\n") {
		if line == "" {
			continue
		}
		parts := strings.Fields(line)
		if len(parts) < 2 {
			continue
		}
		status := parts[0]
		if strings.HasPrefix(status, "R") || strings.HasPrefix(status, "C") {
			oldPath := parts[1]
			newPath := parts[len(parts)-1]
			files = append(files, ChangedFile{Status: string(status[0]), Path: newPath, OldPath: oldPath})
		} else {
			files = append(files, ChangedFile{Status: status, Path: parts[1]})
		}
	}
	return files
}

// CreatePatch returns a unified diff patch between two refs (range supported in
// refA). The result is apply-able with ApplyPatch / `git apply`. Output is kept
// raw (no trimming) because git apply requires the trailing newline intact.
func CreatePatch(repoPath, refA, refB string) (string, error) {
	args := append([]string{"diff", "--binary"}, diffArgs(refA, refB)...)
	cmd := exec.Command("git", append([]string{"-C", repoPath}, args...)...)
	configureHiddenCommand(cmd)
	var out, errBuf bytes.Buffer
	cmd.Stdout = &out
	cmd.Stderr = &errBuf
	if err := cmd.Run(); err != nil {
		return "", fmt.Errorf("git diff (patch): %s", firstNonEmpty(errBuf.String(), err.Error()))
	}
	return out.String(), nil
}

// ApplyPatch applies a unified diff. threeWay enables 3-way merge on conflict;
// index also stages the applied changes.
func ApplyPatch(repoPath, patch string, threeWay, index bool) OpResult {
	if strings.TrimSpace(patch) == "" {
		return fail(repoPath, "git apply", "", "", CodeError, "patch is empty")
	}
	tmp, err := os.CreateTemp("", "adomnia-patch-*.patch")
	if err != nil {
		return fail(repoPath, "git apply", "", "", CodeError, "create temp patch: "+err.Error())
	}
	defer os.Remove(tmp.Name())
	if _, err := tmp.WriteString(patch); err != nil {
		tmp.Close()
		return fail(repoPath, "git apply", "", "", CodeError, "write temp patch: "+err.Error())
	}
	tmp.Close()

	args := []string{"apply"}
	if threeWay {
		args = append(args, "--3way")
	}
	if index {
		args = append(args, "--index")
	}
	args = append(args, tmp.Name())
	stdout, stderr, command, err := runFull(repoPath, args...)
	if err != nil {
		return fail(repoPath, command, stdout, stderr, "", "")
	}
	return ok(repoPath, command, stdout, stderr)
}

// RestoreFileFromCommit overwrites the working-tree (and index) copy of a file
// with its content at ref. The UI must preview via FileAtCommit before calling.
func RestoreFileFromCommit(repoPath, ref, path string) OpResult {
	ref = strings.TrimSpace(ref)
	path = strings.TrimSpace(path)
	if ref == "" || path == "" {
		return fail(repoPath, "git checkout", "", "", CodeError, "ref and file path are required")
	}
	stdout, stderr, command, err := runFull(repoPath, "checkout", ref, "--", path)
	if err != nil {
		return fail(repoPath, command, stdout, stderr, "", "")
	}
	return ok(repoPath, command, stdout, stderr)
}

// FileAtCommit returns a file's content at a given commit (for restore preview
// and "open file at this commit"). Empty string if the file did not exist.
func FileAtCommit(repoPath, ref, path string) (string, error) {
	ref = strings.TrimSpace(ref)
	if ref == "" {
		return "", fmt.Errorf("ref is empty")
	}
	return readFileAtRef(repoPath, ref, path)
}

// FileHistory returns the commits that touched a path (rename-following).
func FileHistory(repoPath, path string, n int) ([]CommitInfo, error) {
	path = strings.TrimSpace(path)
	if path == "" {
		return nil, fmt.Errorf("file path is empty")
	}
	if n <= 0 {
		n = 100
	}
	out, err := runGit(repoPath, "log", fmt.Sprintf("--max-count=%d", n), "--follow", "--date=short", commitLogFormat, "--", path)
	if err != nil {
		return nil, fmt.Errorf("git log --follow: %w", err)
	}
	return parseCommitLog(out), nil
}

// Blame returns line-by-line authorship for a file at its current revision.
func Blame(repoPath, path string) (string, error) {
	path = strings.TrimSpace(path)
	if path == "" {
		return "", fmt.Errorf("file path is empty")
	}
	out, stderr, _, err := runFull(repoPath, "blame", "--date=short", "--", path)
	if err != nil {
		return "", fmt.Errorf("git blame: %s", firstNonEmpty(stderr, err.Error()))
	}
	return out, nil
}

// parseCommitLog parses the shared commitLogFormat output into CommitInfo.
func parseCommitLog(out string) []CommitInfo {
	commits := []CommitInfo{}
	if strings.TrimSpace(out) == "" {
		return commits
	}
	for _, line := range strings.Split(out, "\n") {
		parts := strings.Split(line, "\x1f")
		if len(parts) < 7 {
			continue
		}
		var parents []string
		if p := strings.TrimSpace(parts[2]); p != "" {
			for _, parent := range strings.Fields(p) {
				if len(parent) > 7 {
					parent = parent[:7]
				}
				parents = append(parents, parent)
			}
		}
		var decorations []string
		for _, decoration := range strings.Split(parts[6], ",") {
			if trimmed := strings.TrimSpace(decoration); trimmed != "" {
				decorations = append(decorations, trimmed)
			}
		}
		commits = append(commits, CommitInfo{
			Hash:        parts[0],
			FullHash:    parts[1],
			Parents:     parents,
			Author:      parts[3],
			Date:        parts[4],
			Message:     parts[5],
			Decorations: decorations,
		})
	}
	return commits
}
