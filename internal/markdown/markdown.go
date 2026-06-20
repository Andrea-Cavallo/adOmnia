// Package markdown implements the local Markdown workspace: listing, reading,
// writing, renaming and importing .md/.markdown notes inside a user-selected
// folder. All paths are validated so operations stay inside the chosen root.
package markdown

import (
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"sort"
	"strings"
	"time"
)

// FileEntry describes a single Markdown note on disk.
type FileEntry struct {
	Name       string `json:"name"`
	Path       string `json:"path"`
	RelPath    string `json:"relPath"`
	Dir        string `json:"dir"`
	Size       int64  `json:"size"`
	ModifiedAt string `json:"modifiedAt"`
}

// WorkspaceInfo summarises a folder imported into a local workspace.
type WorkspaceInfo struct {
	Root  string `json:"root"`
	Name  string `json:"name"`
	Files int    `json:"files"`
}

// IsMarkdownPath reports whether path has a Markdown extension.
func IsMarkdownPath(path string) bool {
	ext := strings.ToLower(filepath.Ext(path))
	return ext == ".md" || ext == ".markdown"
}

func cleanRoot(root string) (string, error) {
	root = strings.TrimSpace(root)
	if root == "" {
		return "", errors.New("markdown folder is empty")
	}
	abs, err := filepath.Abs(root)
	if err != nil {
		return "", err
	}
	info, err := os.Stat(abs)
	if err != nil {
		return "", err
	}
	if !info.IsDir() {
		return "", errors.New("selected markdown root is not a folder")
	}
	return abs, nil
}

func cleanFilePath(path string) (string, error) {
	path = strings.TrimSpace(path)
	if path == "" {
		return "", errors.New("markdown file path is empty")
	}
	abs, err := filepath.Abs(path)
	if err != nil {
		return "", err
	}
	if !IsMarkdownPath(abs) {
		return "", errors.New("only .md and .markdown files are supported")
	}
	return abs, nil
}

func cleanRelativePath(relPath string) (string, error) {
	relPath = strings.TrimSpace(strings.ReplaceAll(relPath, "\\", "/"))
	if relPath == "" {
		return "", errors.New("note name is empty")
	}
	if !IsMarkdownPath(relPath) {
		relPath += ".md"
	}
	clean := filepath.Clean(relPath)
	if filepath.IsAbs(clean) || clean == "." || strings.HasPrefix(clean, "..") {
		return "", errors.New("note path must stay inside the selected folder")
	}
	if !IsMarkdownPath(clean) {
		return "", errors.New("only .md and .markdown files are supported")
	}
	return clean, nil
}

func shouldSkipDir(name string) bool {
	switch strings.ToLower(name) {
	case ".git", "node_modules", "dist", "build", "out", ".next", ".vite":
		return true
	default:
		return strings.HasPrefix(name, ".")
	}
}

// ListFiles returns every Markdown note under root, sorted by relative path.
func ListFiles(root string) ([]FileEntry, error) {
	rootAbs, err := cleanRoot(root)
	if err != nil {
		return nil, err
	}
	files := make([]FileEntry, 0, 64)
	err = filepath.WalkDir(rootAbs, func(path string, entry os.DirEntry, walkErr error) error {
		if walkErr != nil {
			return walkErr
		}
		if entry.IsDir() {
			if path != rootAbs && shouldSkipDir(entry.Name()) {
				return filepath.SkipDir
			}
			return nil
		}
		if !IsMarkdownPath(path) {
			return nil
		}
		info, err := entry.Info()
		if err != nil {
			return err
		}
		rel, err := filepath.Rel(rootAbs, path)
		if err != nil {
			return err
		}
		rel = filepath.ToSlash(rel)
		files = append(files, FileEntry{
			Name:       entry.Name(),
			Path:       path,
			RelPath:    rel,
			Dir:        filepath.ToSlash(filepath.Dir(rel)),
			Size:       info.Size(),
			ModifiedAt: info.ModTime().Format("2006-01-02 15:04"),
		})
		return nil
	})
	if err != nil {
		return nil, err
	}
	sort.Slice(files, func(i, j int) bool {
		return strings.ToLower(files[i].RelPath) < strings.ToLower(files[j].RelPath)
	})
	return files, nil
}

// ReadFile returns the contents of a Markdown note.
func ReadFile(path string) (string, error) {
	abs, err := cleanFilePath(path)
	if err != nil {
		return "", err
	}
	data, err := os.ReadFile(abs)
	if err != nil {
		return "", err
	}
	return string(data), nil
}

// WriteFile overwrites a Markdown note with content.
func WriteFile(path string, content string) error {
	abs, err := cleanFilePath(path)
	if err != nil {
		return err
	}
	return os.WriteFile(abs, []byte(content), 0644)
}

// SaveToPath writes content to a (dialog-chosen) path and returns its entry.
func SaveToPath(path string, content string) (FileEntry, error) {
	abs, err := cleanFilePath(path)
	if err != nil {
		return FileEntry{}, err
	}
	if err := os.WriteFile(abs, []byte(content), 0644); err != nil {
		return FileEntry{}, err
	}
	info, err := os.Stat(abs)
	if err != nil {
		return FileEntry{}, err
	}
	return FileEntry{
		Name:       filepath.Base(abs),
		Path:       abs,
		RelPath:    filepath.Base(abs),
		Dir:        ".",
		Size:       info.Size(),
		ModifiedAt: info.ModTime().Format("2006-01-02 15:04"),
	}, nil
}

// CreateFile creates a new note at relPath inside root.
func CreateFile(root string, relPath string, content string) (FileEntry, error) {
	rootAbs, err := cleanRoot(root)
	if err != nil {
		return FileEntry{}, err
	}
	cleanRel, err := cleanRelativePath(relPath)
	if err != nil {
		return FileEntry{}, err
	}
	abs := filepath.Join(rootAbs, cleanRel)
	parent := filepath.Dir(abs)
	relCheck, err := filepath.Rel(rootAbs, abs)
	if err != nil {
		return FileEntry{}, err
	}
	if strings.HasPrefix(relCheck, "..") {
		return FileEntry{}, errors.New("note path must stay inside the selected folder")
	}
	if _, err := os.Stat(abs); err == nil {
		return FileEntry{}, errors.New("a note with this path already exists")
	}
	if err := os.MkdirAll(parent, 0755); err != nil {
		return FileEntry{}, err
	}
	if err := os.WriteFile(abs, []byte(content), 0644); err != nil {
		return FileEntry{}, err
	}
	info, err := os.Stat(abs)
	if err != nil {
		return FileEntry{}, err
	}
	relSlash := filepath.ToSlash(cleanRel)
	return FileEntry{
		Name:       filepath.Base(abs),
		Path:       abs,
		RelPath:    relSlash,
		Dir:        filepath.ToSlash(filepath.Dir(relSlash)),
		Size:       info.Size(),
		ModifiedAt: info.ModTime().Format("2006-01-02 15:04"),
	}, nil
}

// RenameFile moves a note from oldRelPath to newRelPath inside root.
func RenameFile(root string, oldRelPath string, newRelPath string) (FileEntry, error) {
	rootAbs, err := cleanRoot(root)
	if err != nil {
		return FileEntry{}, err
	}
	oldClean, err := cleanRelativePath(oldRelPath)
	if err != nil {
		return FileEntry{}, err
	}
	newClean, err := cleanRelativePath(newRelPath)
	if err != nil {
		return FileEntry{}, err
	}
	oldAbs := filepath.Join(rootAbs, oldClean)
	newAbs := filepath.Join(rootAbs, newClean)
	if _, err := os.Stat(oldAbs); err != nil {
		return FileEntry{}, err
	}
	if _, err := os.Stat(newAbs); err == nil {
		return FileEntry{}, errors.New("a note with this path already exists")
	}
	if err := os.MkdirAll(filepath.Dir(newAbs), 0755); err != nil {
		return FileEntry{}, err
	}
	if err := os.Rename(oldAbs, newAbs); err != nil {
		return FileEntry{}, err
	}
	info, err := os.Stat(newAbs)
	if err != nil {
		return FileEntry{}, err
	}
	newRelSlash := filepath.ToSlash(newClean)
	return FileEntry{
		Name:       filepath.Base(newAbs),
		Path:       newAbs,
		RelPath:    newRelSlash,
		Dir:        filepath.ToSlash(filepath.Dir(newRelSlash)),
		Size:       info.Size(),
		ModifiedAt: info.ModTime().Format("2006-01-02 15:04"),
	}, nil
}

// DeleteFile removes a note at relPath inside root.
func DeleteFile(root string, relPath string) error {
	rootAbs, err := cleanRoot(root)
	if err != nil {
		return err
	}
	cleanRel, err := cleanRelativePath(relPath)
	if err != nil {
		return err
	}
	abs := filepath.Join(rootAbs, cleanRel)
	info, err := os.Stat(abs)
	if err != nil {
		return err
	}
	if info.IsDir() {
		return errors.New("markdown delete expects a file")
	}
	return os.Remove(abs)
}

// WriteAgentGraph persists the computed note graph under root/.adomnia.
func WriteAgentGraph(root string, content string) (string, error) {
	rootAbs, err := cleanRoot(root)
	if err != nil {
		return "", err
	}
	graphDir := filepath.Join(rootAbs, ".adomnia")
	if err := os.MkdirAll(graphDir, 0755); err != nil {
		return "", err
	}
	graphPath := filepath.Join(graphDir, "markdown-graph.json")
	if err := os.WriteFile(graphPath, []byte(content), 0644); err != nil {
		return "", err
	}
	return graphPath, nil
}

// ImportFolderToWorkspace copies every Markdown note from sourceRoot into a new
// timestamped workspace under dataDir/markdown-workspaces.
func ImportFolderToWorkspace(sourceRoot string, dataDir string) (WorkspaceInfo, error) {
	sourceAbs, err := cleanRoot(sourceRoot)
	if err != nil {
		return WorkspaceInfo{}, err
	}
	baseName := filepath.Base(sourceAbs)
	if baseName == "." || baseName == string(filepath.Separator) {
		baseName = "markdown-workspace"
	}
	safeName := strings.Map(func(r rune) rune {
		if r == '-' || r == '_' || r == ' ' || r == '.' || (r >= '0' && r <= '9') || (r >= 'A' && r <= 'Z') || (r >= 'a' && r <= 'z') {
			return r
		}
		return '-'
	}, baseName)
	targetRoot := filepath.Join(dataDir, "markdown-workspaces", fmt.Sprintf("%s-%s", strings.TrimSpace(safeName), time.Now().Format("20060102-150405")))
	count := 0
	err = filepath.WalkDir(sourceAbs, func(path string, entry os.DirEntry, walkErr error) error {
		if walkErr != nil {
			return walkErr
		}
		if entry.IsDir() {
			if path != sourceAbs && shouldSkipDir(entry.Name()) {
				return filepath.SkipDir
			}
			return nil
		}
		if !IsMarkdownPath(path) {
			return nil
		}
		rel, err := filepath.Rel(sourceAbs, path)
		if err != nil {
			return err
		}
		target := filepath.Join(targetRoot, rel)
		if err := os.MkdirAll(filepath.Dir(target), 0755); err != nil {
			return err
		}
		data, err := os.ReadFile(path)
		if err != nil {
			return err
		}
		if err := os.WriteFile(target, data, 0644); err != nil {
			return err
		}
		count++
		return nil
	})
	if err != nil {
		return WorkspaceInfo{}, err
	}
	return WorkspaceInfo{Root: targetRoot, Name: baseName, Files: count}, nil
}
