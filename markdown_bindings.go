package main

import (
	"adomnia/internal/markdown"
	"errors"
	"strings"

	wailsRuntime "github.com/wailsapp/wails/v2/pkg/runtime"
)

func (a *App) ListMarkdownFiles(root string) ([]markdown.FileEntry, error) {
	return markdown.ListFiles(root)
}

func (a *App) ReadMarkdownFile(path string) (string, error) {
	return markdown.ReadFile(path)
}

func (a *App) WriteMarkdownFile(path string, content string) error {
	return markdown.WriteFile(path, content)
}

func (a *App) SaveMarkdownFileAs(defaultName string, content string) (markdown.FileEntry, error) {
	defaultName = strings.TrimSpace(defaultName)
	if defaultName == "" {
		defaultName = "Untitled.md"
	}
	if !markdown.IsMarkdownPath(defaultName) {
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
		return markdown.FileEntry{}, err
	}
	if strings.TrimSpace(path) == "" {
		return markdown.FileEntry{}, errors.New("save cancelled")
	}
	return markdown.SaveToPath(path, content)
}

func (a *App) CreateMarkdownFile(root string, relPath string, content string) (markdown.FileEntry, error) {
	return markdown.CreateFile(root, relPath, content)
}

func (a *App) RenameMarkdownFile(root string, oldRelPath string, newRelPath string) (markdown.FileEntry, error) {
	return markdown.RenameFile(root, oldRelPath, newRelPath)
}

func (a *App) DeleteMarkdownFile(root string, relPath string) error {
	return markdown.DeleteFile(root, relPath)
}

func (a *App) WriteMarkdownAgentGraph(root string, content string) (string, error) {
	return markdown.WriteAgentGraph(root, content)
}

func (a *App) ImportMarkdownFolderToWorkspace(sourceRoot string) (markdown.WorkspaceInfo, error) {
	return markdown.ImportFolderToWorkspace(sourceRoot, dataDir())
}
