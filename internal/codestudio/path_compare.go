package codestudio

import (
	"bytes"
	"crypto/sha256"
	"fmt"
	"io/fs"
	"os"
	"path/filepath"
	"sort"
	"strings"
)

const (
	maxCompareFileBytes = 5 << 20
	maxCompareTreeFiles = 5000
)

type PathDifference struct {
	RelativePath string `json:"relativePath"`
	Status       string `json:"status"`
}

type PathComparison struct {
	Kind         string           `json:"kind"`
	LeftPath     string           `json:"leftPath"`
	RightPath    string           `json:"rightPath"`
	LeftContent  string           `json:"leftContent,omitempty"`
	RightContent string           `json:"rightContent,omitempty"`
	Differences  []PathDifference `json:"differences"`
}

func compareTextFile(path string) (string, error) {
	info, err := os.Stat(path)
	if err != nil {
		return "", err
	}
	if info.Size() > maxCompareFileBytes {
		return "", fmt.Errorf("%s is larger than the 5 MB comparison limit", filepath.Base(path))
	}
	data, err := os.ReadFile(path)
	if err != nil {
		return "", err
	}
	if bytes.IndexByte(data, 0) >= 0 {
		return "", fmt.Errorf("%s is binary and cannot be shown as a text diff", filepath.Base(path))
	}
	return string(data), nil
}

func treeFingerprints(root string) (map[string][sha256.Size]byte, error) {
	files := make(map[string][sha256.Size]byte)
	err := filepath.WalkDir(root, func(path string, entry fs.DirEntry, walkErr error) error {
		if walkErr != nil {
			return walkErr
		}
		if entry.IsDir() && path != root && (entry.Name() == ".git" || entry.Name() == ".adomnia") {
			return filepath.SkipDir
		}
		if entry.IsDir() {
			return nil
		}
		if len(files) >= maxCompareTreeFiles {
			return fmt.Errorf("folder comparison is limited to %d files", maxCompareTreeFiles)
		}
		data, err := os.ReadFile(path)
		if err != nil {
			return err
		}
		relative, err := filepath.Rel(root, path)
		if err != nil {
			return err
		}
		files[filepath.ToSlash(relative)] = sha256.Sum256(data)
		return nil
	})
	return files, err
}

func compareTrees(leftRoot, rightRoot string) ([]PathDifference, error) {
	left, err := treeFingerprints(leftRoot)
	if err != nil {
		return nil, err
	}
	right, err := treeFingerprints(rightRoot)
	if err != nil {
		return nil, err
	}
	paths := make(map[string]struct{}, len(left)+len(right))
	for path := range left {
		paths[path] = struct{}{}
	}
	for path := range right {
		paths[path] = struct{}{}
	}
	ordered := make([]string, 0, len(paths))
	for path := range paths {
		ordered = append(ordered, path)
	}
	sort.Strings(ordered)
	differences := make([]PathDifference, 0)
	for _, path := range ordered {
		leftHash, inLeft := left[path]
		rightHash, inRight := right[path]
		status := ""
		switch {
		case !inLeft:
			status = "only-right"
		case !inRight:
			status = "only-left"
		case leftHash != rightHash:
			status = "modified"
		}
		if status != "" {
			differences = append(differences, PathDifference{RelativePath: path, Status: status})
		}
	}
	return differences, nil
}

// ComparePaths confronta due file di testo o due cartelle, entrambi confinati al progetto.
func (s *Service) ComparePaths(sessionID, leftRelativePath, rightRelativePath string) (PathComparison, error) {
	session, err := s.session(sessionID)
	if err != nil {
		return PathComparison{}, err
	}
	resolve := func(relative string) (string, error) {
		relative = filepath.Clean(filepath.FromSlash(strings.TrimSpace(relative)))
		if relative == "." || relative == "" {
			return session.Project.RealPath, nil
		}
		absolute := filepath.Join(session.Project.RealPath, relative)
		if err := ensureWithinRoot(session.Project.RealPath, absolute); err != nil {
			return "", err
		}
		resolved, err := filepath.EvalSymlinks(absolute)
		if err != nil {
			return "", err
		}
		if err := ensureWithinRoot(session.Project.RealPath, resolved); err != nil {
			return "", err
		}
		return resolved, nil
	}
	left, err := resolve(leftRelativePath)
	if err != nil {
		return PathComparison{}, err
	}
	right, err := resolve(rightRelativePath)
	if err != nil {
		return PathComparison{}, err
	}
	leftInfo, err := os.Stat(left)
	if err != nil {
		return PathComparison{}, fmt.Errorf("left path: %w", err)
	}
	rightInfo, err := os.Stat(right)
	if err != nil {
		return PathComparison{}, fmt.Errorf("right path: %w", err)
	}
	if leftInfo.IsDir() != rightInfo.IsDir() {
		return PathComparison{}, fmt.Errorf("compare a file with another file, or a folder with another folder")
	}
	result := PathComparison{LeftPath: filepath.ToSlash(leftRelativePath), RightPath: filepath.ToSlash(rightRelativePath), Differences: []PathDifference{}}
	if leftInfo.IsDir() {
		result.Kind = "directory"
		result.Differences, err = compareTrees(left, right)
		return result, err
	}
	result.Kind = "file"
	result.LeftContent, err = compareTextFile(left)
	if err != nil {
		return PathComparison{}, err
	}
	result.RightContent, err = compareTextFile(right)
	return result, err
}
