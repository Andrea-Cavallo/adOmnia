package git

import (
	"bytes"
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
)

// ConflictFileVersions is the complete three-way input plus the editable
// working-tree result for one unmerged path. Availability flags distinguish an
// empty file from a side that does not exist (add/delete conflicts).
type ConflictFileVersions struct {
	Path            string `json:"path"`
	Base            string `json:"base"`
	Ours            string `json:"ours"`
	Theirs          string `json:"theirs"`
	Result          string `json:"result"`
	BaseAvailable   bool   `json:"baseAvailable"`
	OursAvailable   bool   `json:"oursAvailable"`
	TheirsAvailable bool   `json:"theirsAvailable"`
}

func conflictStage(repoPath, path, stage string) (string, bool) {
	cmd := exec.Command("git", "show", ":"+stage+":"+filepath.ToSlash(path))
	cmd.Dir = repoPath
	configureHiddenCommand(cmd)
	var out bytes.Buffer
	cmd.Stdout = &out
	err := cmd.Run()
	return out.String(), err == nil
}

func GetConflictFileVersions(repoPath, path string) (ConflictFileVersions, error) {
	path = strings.TrimSpace(path)
	if path == "" {
		return ConflictFileVersions{}, fmt.Errorf("file path is empty")
	}
	if out, err := runGit(repoPath, "ls-files", "-u", "--", path); err != nil || strings.TrimSpace(out) == "" {
		return ConflictFileVersions{}, fmt.Errorf("file is not currently conflicted: %s", path)
	}
	result, err := readWorkingTreeFile(repoPath, path)
	if err != nil {
		return ConflictFileVersions{}, err
	}
	base, baseOK := conflictStage(repoPath, path, "1")
	ours, oursOK := conflictStage(repoPath, path, "2")
	theirs, theirsOK := conflictStage(repoPath, path, "3")
	return ConflictFileVersions{
		Path: path, Base: base, Ours: ours, Theirs: theirs, Result: result,
		BaseAvailable: baseOK, OursAvailable: oursOK, TheirsAvailable: theirsOK,
	}, nil
}

func repoFilePath(repoPath, path string) (string, error) {
	clean := filepath.Clean(strings.TrimSpace(path))
	if clean == "." || filepath.IsAbs(clean) || strings.HasPrefix(clean, "..") {
		return "", fmt.Errorf("invalid file path: %s", path)
	}
	absRepo, err := filepath.Abs(repoPath)
	if err != nil {
		return "", fmt.Errorf("resolve repository: %w", err)
	}
	absFile, err := filepath.Abs(filepath.Join(absRepo, clean))
	if err != nil {
		return "", fmt.Errorf("resolve file: %w", err)
	}
	rel, err := filepath.Rel(absRepo, absFile)
	if err != nil || filepath.IsAbs(rel) || rel == ".." || strings.HasPrefix(rel, ".."+string(filepath.Separator)) {
		return "", fmt.Errorf("file is outside repository: %s", path)
	}
	return absFile, nil
}

// SaveConflictResolution writes the user's merged result and stages it. Git's
// index is the source of truth: after add succeeds the path is resolved.
func SaveConflictResolution(repoPath, path, content string) error {
	if _, err := GetConflictFileVersions(repoPath, path); err != nil {
		return err
	}
	fullPath, err := repoFilePath(repoPath, path)
	if err != nil {
		return err
	}
	if err := os.MkdirAll(filepath.Dir(fullPath), 0755); err != nil {
		return fmt.Errorf("prepare conflict file: %w", err)
	}
	mode := os.FileMode(0644)
	if info, statErr := os.Lstat(fullPath); statErr == nil {
		if info.Mode()&os.ModeSymlink != 0 {
			return fmt.Errorf("symlink conflicts must be resolved outside the text editor: %s", path)
		}
		mode = info.Mode().Perm()
	}
	if err := os.WriteFile(fullPath, []byte(content), mode); err != nil {
		return fmt.Errorf("save conflict resolution: %w", err)
	}
	return StageFile(repoPath, path)
}
