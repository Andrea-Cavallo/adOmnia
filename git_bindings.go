package main

import (
	"adomnia/internal/git"
	"encoding/json"
	"fmt"
	"path/filepath"
)

type GitSync struct {
	dataDir string
}

func NewGitSync(dataDir string) *GitSync {
	return &GitSync{dataDir: dataDir}
}

func (g *GitSync) defaultRepoPath() string {
	return filepath.Join(g.dataDir, "git-workspace")
}

func (g *GitSync) IsGitInstalled() bool {
	return git.IsInstalled()
}

func (g *GitSync) InitRepo(cfgJSON string) error {
	var cfg git.Config
	if err := json.Unmarshal([]byte(cfgJSON), &cfg); err != nil {
		return fmt.Errorf("invalid config: %w", err)
	}
	if cfg.RepoPath == "" {
		cfg.RepoPath = g.defaultRepoPath()
	}
	return git.Init(cfg)
}

func (g *GitSync) GetStatus(repoPath string) (string, error) {
	if repoPath == "" {
		repoPath = g.defaultRepoPath()
	}
	status, err := git.GetStatus(repoPath)
	if err != nil {
		return "", err
	}
	raw, _ := json.Marshal(status)
	return string(raw), nil
}

func (g *GitSync) CommitAll(repoPath, message string) (string, error) {
	if repoPath == "" {
		repoPath = g.defaultRepoPath()
	}
	result, err := git.CommitAll(repoPath, message)
	if err != nil {
		return "", err
	}
	raw, _ := json.Marshal(result)
	return string(raw), nil
}

func (g *GitSync) Push(repoPath, branch string) error {
	if repoPath == "" {
		repoPath = g.defaultRepoPath()
	}
	return git.Push(repoPath, branch)
}

func (g *GitSync) Pull(repoPath, branch string) error {
	if repoPath == "" {
		repoPath = g.defaultRepoPath()
	}
	return git.Pull(repoPath, branch)
}

func (g *GitSync) Log(repoPath string, n int) (string, error) {
	if repoPath == "" {
		repoPath = g.defaultRepoPath()
	}
	lines, err := git.Log(repoPath, n)
	if err != nil {
		return "", err
	}
	raw, _ := json.Marshal(lines)
	return string(raw), nil
}
