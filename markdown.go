package main

import (
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"sort"
	"strings"
	"time"

	wailsRuntime "github.com/wailsapp/wails/v2/pkg/runtime"
)

type MarkdownFileEntry struct {
	Name       string `json:"name"`
	Path       string `json:"path"`
	RelPath    string `json:"relPath"`
	Dir        string `json:"dir"`
	Size       int64  `json:"size"`
	ModifiedAt string `json:"modifiedAt"`
}

type MarkdownWorkspaceInfo struct {
	Root  string `json:"root"`
	Name  string `json:"name"`
	Files int    `json:"files"`
}

func isMarkdownPath(path string) bool {
	ext := strings.ToLower(filepath.Ext(path))
	return ext == ".md" || ext == ".markdown"
}

func cleanMarkdownRoot(root string) (string, error) {
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

func cleanMarkdownFilePath(path string) (string, error) {
	path = strings.TrimSpace(path)
	if path == "" {
		return "", errors.New("markdown file path is empty")
	}
	abs, err := filepath.Abs(path)
	if err != nil {
		return "", err
	}
	if !isMarkdownPath(abs) {
		return "", errors.New("only .md and .markdown files are supported")
	}
	return abs, nil
}

func cleanMarkdownRelativePath(relPath string) (string, error) {
	relPath = strings.TrimSpace(strings.ReplaceAll(relPath, "\\", "/"))
	if relPath == "" {
		return "", errors.New("note name is empty")
	}
	if !isMarkdownPath(relPath) {
		relPath += ".md"
	}
	clean := filepath.Clean(relPath)
	if filepath.IsAbs(clean) || clean == "." || strings.HasPrefix(clean, "..") {
		return "", errors.New("note path must stay inside the selected folder")
	}
	if !isMarkdownPath(clean) {
		return "", errors.New("only .md and .markdown files are supported")
	}
	return clean, nil
}

func shouldSkipMarkdownDir(name string) bool {
	switch strings.ToLower(name) {
	case ".git", "node_modules", "dist", "build", "out", ".next", ".vite":
		return true
	default:
		return strings.HasPrefix(name, ".")
	}
}

func markdownFileEntry(abs string) (MarkdownFileEntry, error) {
	info, err := os.Stat(abs)
	if err != nil {
		return MarkdownFileEntry{}, err
	}
	return MarkdownFileEntry{
		Name:       filepath.Base(abs),
		Path:       abs,
		RelPath:    filepath.Base(abs),
		Dir:        ".",
		Size:       info.Size(),
		ModifiedAt: info.ModTime().Format("2006-01-02 15:04"),
	}, nil
}

func (a *App) ListMarkdownFiles(root string) ([]MarkdownFileEntry, error) {
	rootAbs, err := cleanMarkdownRoot(root)
	if err != nil {
		return nil, err
	}
	files := make([]MarkdownFileEntry, 0, 64)
	err = filepath.WalkDir(rootAbs, func(path string, entry os.DirEntry, walkErr error) error {
		if walkErr != nil {
			return walkErr
		}
		if entry.IsDir() {
			if path != rootAbs && shouldSkipMarkdownDir(entry.Name()) {
				return filepath.SkipDir
			}
			return nil
		}
		if !isMarkdownPath(path) {
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
		files = append(files, MarkdownFileEntry{
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

func (a *App) ReadMarkdownFile(path string) (string, error) {
	abs, err := cleanMarkdownFilePath(path)
	if err != nil {
		return "", err
	}
	data, err := os.ReadFile(abs)
	if err != nil {
		return "", err
	}
	return string(data), nil
}

func (a *App) WriteMarkdownFile(path string, content string) error {
	abs, err := cleanMarkdownFilePath(path)
	if err != nil {
		return err
	}
	return os.WriteFile(abs, []byte(content), 0644)
}

func (a *App) SaveMarkdownFileAs(defaultName string, content string) (MarkdownFileEntry, error) {
	defaultName = strings.TrimSpace(defaultName)
	if defaultName == "" {
		defaultName = "Untitled.md"
	}
	if !isMarkdownPath(defaultName) {
		defaultName += ".md"
	}
	path, err := wailsRuntime.SaveFileDialog(a.ctx, wailsRuntime.SaveDialogOptions{
		Title:           "Save Markdown note",
		DefaultFilename: defaultName,
		Filters: []wailsRuntime.FileFilter{
			{DisplayName: "Markdown files (*.md, *.markdown)", Pattern: "*.md;*.markdown"},
		},
	})
	if err != nil {
		return MarkdownFileEntry{}, err
	}
	if strings.TrimSpace(path) == "" {
		return MarkdownFileEntry{}, errors.New("save cancelled")
	}
	abs, err := cleanMarkdownFilePath(path)
	if err != nil {
		return MarkdownFileEntry{}, err
	}
	if err := os.WriteFile(abs, []byte(content), 0644); err != nil {
		return MarkdownFileEntry{}, err
	}
	return markdownFileEntry(abs)
}

func (a *App) CreateMarkdownFile(root string, relPath string, content string) (MarkdownFileEntry, error) {
	rootAbs, err := cleanMarkdownRoot(root)
	if err != nil {
		return MarkdownFileEntry{}, err
	}
	cleanRel, err := cleanMarkdownRelativePath(relPath)
	if err != nil {
		return MarkdownFileEntry{}, err
	}
	abs := filepath.Join(rootAbs, cleanRel)
	parent := filepath.Dir(abs)
	relCheck, err := filepath.Rel(rootAbs, abs)
	if err != nil {
		return MarkdownFileEntry{}, err
	}
	if strings.HasPrefix(relCheck, "..") {
		return MarkdownFileEntry{}, errors.New("note path must stay inside the selected folder")
	}
	if _, err := os.Stat(abs); err == nil {
		return MarkdownFileEntry{}, errors.New("a note with this path already exists")
	}
	if err := os.MkdirAll(parent, 0755); err != nil {
		return MarkdownFileEntry{}, err
	}
	if err := os.WriteFile(abs, []byte(content), 0644); err != nil {
		return MarkdownFileEntry{}, err
	}
	info, err := os.Stat(abs)
	if err != nil {
		return MarkdownFileEntry{}, err
	}
	relSlash := filepath.ToSlash(cleanRel)
	return MarkdownFileEntry{
		Name:       filepath.Base(abs),
		Path:       abs,
		RelPath:    relSlash,
		Dir:        filepath.ToSlash(filepath.Dir(relSlash)),
		Size:       info.Size(),
		ModifiedAt: info.ModTime().Format("2006-01-02 15:04"),
	}, nil
}

func (a *App) RenameMarkdownFile(root string, oldRelPath string, newRelPath string) (MarkdownFileEntry, error) {
	rootAbs, err := cleanMarkdownRoot(root)
	if err != nil {
		return MarkdownFileEntry{}, err
	}
	oldClean, err := cleanMarkdownRelativePath(oldRelPath)
	if err != nil {
		return MarkdownFileEntry{}, err
	}
	newClean, err := cleanMarkdownRelativePath(newRelPath)
	if err != nil {
		return MarkdownFileEntry{}, err
	}
	oldAbs := filepath.Join(rootAbs, oldClean)
	newAbs := filepath.Join(rootAbs, newClean)
	if _, err := os.Stat(oldAbs); err != nil {
		return MarkdownFileEntry{}, err
	}
	if _, err := os.Stat(newAbs); err == nil {
		return MarkdownFileEntry{}, errors.New("a note with this path already exists")
	}
	if err := os.MkdirAll(filepath.Dir(newAbs), 0755); err != nil {
		return MarkdownFileEntry{}, err
	}
	if err := os.Rename(oldAbs, newAbs); err != nil {
		return MarkdownFileEntry{}, err
	}
	info, err := os.Stat(newAbs)
	if err != nil {
		return MarkdownFileEntry{}, err
	}
	newRelSlash := filepath.ToSlash(newClean)
	return MarkdownFileEntry{
		Name:       filepath.Base(newAbs),
		Path:       newAbs,
		RelPath:    newRelSlash,
		Dir:        filepath.ToSlash(filepath.Dir(newRelSlash)),
		Size:       info.Size(),
		ModifiedAt: info.ModTime().Format("2006-01-02 15:04"),
	}, nil
}

func (a *App) DeleteMarkdownFile(root string, relPath string) error {
	rootAbs, err := cleanMarkdownRoot(root)
	if err != nil {
		return err
	}
	cleanRel, err := cleanMarkdownRelativePath(relPath)
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

func (a *App) WriteMarkdownAgentGraph(root string, content string) (string, error) {
	rootAbs, err := cleanMarkdownRoot(root)
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

func (a *App) ImportMarkdownFolderToWorkspace(sourceRoot string) (MarkdownWorkspaceInfo, error) {
	sourceAbs, err := cleanMarkdownRoot(sourceRoot)
	if err != nil {
		return MarkdownWorkspaceInfo{}, err
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
	targetRoot := filepath.Join(dataDir(), "markdown-workspaces", fmt.Sprintf("%s-%s", strings.TrimSpace(safeName), time.Now().Format("20060102-150405")))
	count := 0
	err = filepath.WalkDir(sourceAbs, func(path string, entry os.DirEntry, walkErr error) error {
		if walkErr != nil {
			return walkErr
		}
		if entry.IsDir() {
			if path != sourceAbs && shouldSkipMarkdownDir(entry.Name()) {
				return filepath.SkipDir
			}
			return nil
		}
		if !isMarkdownPath(path) {
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
		return MarkdownWorkspaceInfo{}, err
	}
	return MarkdownWorkspaceInfo{Root: targetRoot, Name: baseName, Files: count}, nil
}
