package git

import (
	"io/fs"
	"os"
	"path/filepath"
	"strings"
)

// RepositoryFolders discovers local Git markers, including .git files used by
// worktrees. It does not follow symlinks or inspect generated/dependency trees.
func RepositoryFolders(root string) ([]string, error) {
	result := []string{}
	visited := 0
	err := filepath.WalkDir(root, func(path string, entry fs.DirEntry, err error) error {
		if err != nil {
			if path == root {
				return err
			}
			return filepath.SkipDir
		}
		if !entry.IsDir() {
			return nil
		}
		visited++
		if visited > 10000 {
			return filepath.SkipAll
		}
		if path != root {
			name := entry.Name()
			rel, _ := filepath.Rel(root, path)
			if strings.HasPrefix(name, ".") || name == "node_modules" || name == "vendor" || name == "dist" || name == "build" || name == "target" || strings.Count(rel, string(filepath.Separator)) >= 8 {
				return filepath.SkipDir
			}
		}
		if marker, err := os.Stat(filepath.Join(path, ".git")); err == nil && (marker.IsDir() || marker.Mode().IsRegular()) {
			result = append(result, path)
		}
		return nil
	})
	return result, err
}
