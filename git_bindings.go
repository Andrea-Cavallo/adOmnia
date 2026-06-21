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

func (g *GitSync) Clone(remoteURL, destination string) error {
	return git.Clone(remoteURL, destination)
}

func (g *GitSync) ConfigureUser(repoPath, name, email string) error {
	if repoPath == "" {
		repoPath = g.defaultRepoPath()
	}
	return git.ConfigureUser(repoPath, name, email)
}

func (g *GitSync) AddIgnorePattern(repoPath, pattern string) error {
	if repoPath == "" {
		repoPath = g.defaultRepoPath()
	}
	return git.AddIgnorePattern(repoPath, pattern)
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

func (g *GitSync) Overview(repoPath string, n int) (string, error) {
	if repoPath == "" {
		repoPath = g.defaultRepoPath()
	}
	overview, err := git.GetOverview(repoPath, n)
	if err != nil {
		return "", err
	}
	raw, _ := json.Marshal(overview)
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

func (g *GitSync) Commit(repoPath, message string) (string, error) {
	if repoPath == "" {
		repoPath = g.defaultRepoPath()
	}
	result, err := git.Commit(repoPath, message)
	if err != nil {
		return "", err
	}
	raw, _ := json.Marshal(result)
	return string(raw), nil
}

func (g *GitSync) StageAll(repoPath string) error {
	if repoPath == "" {
		repoPath = g.defaultRepoPath()
	}
	return git.StageAll(repoPath)
}

func (g *GitSync) UnstageAll(repoPath string) error {
	if repoPath == "" {
		repoPath = g.defaultRepoPath()
	}
	return git.UnstageAll(repoPath)
}

func (g *GitSync) FileDiff(repoPath, path string, staged bool) (string, error) {
	if repoPath == "" {
		repoPath = g.defaultRepoPath()
	}
	return git.FileDiff(repoPath, path, staged)
}

func (g *GitSync) ApplyHunk(repoPath, patch string, reverse bool) error {
	if repoPath == "" {
		repoPath = g.defaultRepoPath()
	}
	return git.ApplyHunkToIndex(repoPath, patch, reverse)
}

func (g *GitSync) CommitPaths(repoPath, message string, paths []string) (string, error) {
	if repoPath == "" {
		repoPath = g.defaultRepoPath()
	}
	result, err := git.CommitPaths(repoPath, message, paths)
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

func (g *GitSync) Fetch(repoPath string) error {
	if repoPath == "" {
		repoPath = g.defaultRepoPath()
	}
	return git.Fetch(repoPath)
}

func (g *GitSync) AddRemote(repoPath, name, remoteURL string) error {
	if repoPath == "" {
		repoPath = g.defaultRepoPath()
	}
	return git.AddRemote(repoPath, name, remoteURL)
}

func (g *GitSync) RemoveRemote(repoPath, name string) error {
	if repoPath == "" {
		repoPath = g.defaultRepoPath()
	}
	return git.RemoveRemote(repoPath, name)
}

func (g *GitSync) Pull(repoPath, branch string) error {
	if repoPath == "" {
		repoPath = g.defaultRepoPath()
	}
	return git.Pull(repoPath, branch)
}

func (g *GitSync) Stash(repoPath string) error {
	if repoPath == "" {
		repoPath = g.defaultRepoPath()
	}
	return git.Stash(repoPath)
}

func (g *GitSync) StashPaths(repoPath string, paths []string) error {
	if repoPath == "" {
		repoPath = g.defaultRepoPath()
	}
	return git.StashPaths(repoPath, paths)
}

func (g *GitSync) StashPop(repoPath string) error {
	if repoPath == "" {
		repoPath = g.defaultRepoPath()
	}
	return git.StashPop(repoPath)
}

func (g *GitSync) StashDrop(repoPath, stashRef string) error {
	if repoPath == "" {
		repoPath = g.defaultRepoPath()
	}
	return git.StashDrop(repoPath, stashRef)
}

func (g *GitSync) StashApply(repoPath, stashRef string) error {
	if repoPath == "" {
		repoPath = g.defaultRepoPath()
	}
	return git.StashApply(repoPath, stashRef)
}

func (g *GitSync) StashShow(repoPath, stashRef string) (string, error) {
	if repoPath == "" {
		repoPath = g.defaultRepoPath()
	}
	return git.StashShow(repoPath, stashRef)
}

func (g *GitSync) CheckoutRemoteBranch(repoPath, remoteRef string) error {
	if repoPath == "" {
		repoPath = g.defaultRepoPath()
	}
	return git.CheckoutRemoteBranch(repoPath, remoteRef)
}

func (g *GitSync) DeleteLocalBranch(repoPath, branch string, force bool) error {
	if repoPath == "" {
		repoPath = g.defaultRepoPath()
	}
	return git.DeleteLocalBranch(repoPath, branch, force)
}

func (g *GitSync) DeleteRemoteBranch(repoPath, remote, branch string) error {
	if repoPath == "" {
		repoPath = g.defaultRepoPath()
	}
	return git.DeleteRemoteBranch(repoPath, remote, branch)
}

func (g *GitSync) SetUpstream(repoPath, branch, upstream string) error {
	if repoPath == "" {
		repoPath = g.defaultRepoPath()
	}
	return git.SetUpstream(repoPath, branch, upstream)
}

func (g *GitSync) CreateBranch(repoPath, branch string) error {
	if repoPath == "" {
		repoPath = g.defaultRepoPath()
	}
	return git.CreateBranch(repoPath, branch)
}

func (g *GitSync) CheckoutBranch(repoPath, branch string) error {
	if repoPath == "" {
		repoPath = g.defaultRepoPath()
	}
	return git.CheckoutBranch(repoPath, branch)
}

func (g *GitSync) CreateAndCheckoutBranch(repoPath, branch string) error {
	if repoPath == "" {
		repoPath = g.defaultRepoPath()
	}
	return git.CreateAndCheckoutBranch(repoPath, branch)
}

func (g *GitSync) MergeBranch(repoPath, branch string) error {
	if repoPath == "" {
		repoPath = g.defaultRepoPath()
	}
	return git.MergeBranch(repoPath, branch)
}

func (g *GitSync) RebaseBranch(repoPath, branch string) error {
	if repoPath == "" {
		repoPath = g.defaultRepoPath()
	}
	return git.RebaseBranch(repoPath, branch)
}

func (g *GitSync) ResetHard(repoPath, ref string) error {
	if repoPath == "" {
		repoPath = g.defaultRepoPath()
	}
	return git.ResetHard(repoPath, ref)
}

func (g *GitSync) StageFile(repoPath, path string) error {
	if repoPath == "" {
		repoPath = g.defaultRepoPath()
	}
	return git.StageFile(repoPath, path)
}

func (g *GitSync) UnstageFile(repoPath, path string) error {
	if repoPath == "" {
		repoPath = g.defaultRepoPath()
	}
	return git.UnstageFile(repoPath, path)
}

func (g *GitSync) RestoreFile(repoPath, path string) error {
	if repoPath == "" {
		repoPath = g.defaultRepoPath()
	}
	return git.RestoreFile(repoPath, path)
}

func (g *GitSync) RemoveFile(repoPath, path string) error {
	if repoPath == "" {
		repoPath = g.defaultRepoPath()
	}
	return git.RemoveFile(repoPath, path)
}

func (g *GitSync) MoveFile(repoPath, oldPath, newPath string) error {
	if repoPath == "" {
		repoPath = g.defaultRepoPath()
	}
	return git.MoveFile(repoPath, oldPath, newPath)
}

func (g *GitSync) CheckoutConflictSide(repoPath, path, side string) error {
	if repoPath == "" {
		repoPath = g.defaultRepoPath()
	}
	return git.CheckoutConflictSide(repoPath, path, side)
}

func (g *GitSync) AbortIntegration(repoPath string) error {
	if repoPath == "" {
		repoPath = g.defaultRepoPath()
	}
	return git.AbortIntegration(repoPath)
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

func (g *GitSync) Show(repoPath, ref string) (string, error) {
	if repoPath == "" {
		repoPath = g.defaultRepoPath()
	}
	return git.Show(repoPath, ref)
}

func (g *GitSync) CreateTag(repoPath, name, ref string) error {
	if repoPath == "" {
		repoPath = g.defaultRepoPath()
	}
	return git.CreateTag(repoPath, name, ref)
}

func (g *GitSync) DeleteTag(repoPath, name string) error {
	if repoPath == "" {
		repoPath = g.defaultRepoPath()
	}
	return git.DeleteTag(repoPath, name)
}

func (g *GitSync) CompareRefs(repoPath, refA, refB string) (string, error) {
	if repoPath == "" {
		repoPath = g.defaultRepoPath()
	}
	files, err := git.CompareRefs(repoPath, refA, refB)
	if err != nil {
		return "", err
	}
	raw, _ := json.Marshal(files)
	return string(raw), nil
}

func (g *GitSync) GetFileDiff(repoPath, refA, refB, filePath string) (string, error) {
	if repoPath == "" {
		repoPath = g.defaultRepoPath()
	}
	return git.GetFileDiff(repoPath, refA, refB, filePath)
}

func (g *GitSync) GetWorkingTreeFileSnapshot(repoPath, filePath, oldPath string) (string, error) {
	if repoPath == "" {
		repoPath = g.defaultRepoPath()
	}
	snapshot, err := git.GetWorkingTreeFileSnapshot(repoPath, filePath, oldPath)
	if err != nil {
		return "", err
	}
	raw, _ := json.Marshal(snapshot)
	return string(raw), nil
}

// --- GitHub host integration (PAT) ---

func (g *GitSync) GitHubValidateToken(token string) (string, error) {
	return git.ValidateGitHubToken(token)
}

func (g *GitSync) GitHubListPRs(repoPath, token string) ([]git.PullRequest, error) {
	if repoPath == "" {
		repoPath = g.defaultRepoPath()
	}
	return git.ListGitHubPRs(repoPath, token)
}

func (g *GitSync) GitHubCreatePR(repoPath, token, title, head, base, body string) (git.PullRequest, error) {
	if repoPath == "" {
		repoPath = g.defaultRepoPath()
	}
	return git.CreateGitHubPR(repoPath, token, title, head, base, body)
}

func (g *GitSync) HostValidateToken(repoPath, accountJSON, token string) (string, error) {
	if repoPath == "" {
		repoPath = g.defaultRepoPath()
	}
	var account git.HostAccount
	if err := json.Unmarshal([]byte(accountJSON), &account); err != nil {
		return "", fmt.Errorf("invalid host account: %w", err)
	}
	return git.ValidateHostToken(repoPath, account, token)
}

func (g *GitSync) HostListPRs(repoPath, accountJSON, token string) ([]git.PullRequest, error) {
	if repoPath == "" {
		repoPath = g.defaultRepoPath()
	}
	var account git.HostAccount
	if err := json.Unmarshal([]byte(accountJSON), &account); err != nil {
		return nil, fmt.Errorf("invalid host account: %w", err)
	}
	return git.ListHostPRs(repoPath, account, token)
}

func (g *GitSync) HostCreatePR(repoPath, accountJSON, token, title, head, base, body string) (git.PullRequest, error) {
	if repoPath == "" {
		repoPath = g.defaultRepoPath()
	}
	var account git.HostAccount
	if err := json.Unmarshal([]byte(accountJSON), &account); err != nil {
		return git.PullRequest{}, fmt.Errorf("invalid host account: %w", err)
	}
	return git.CreateHostPR(repoPath, account, token, title, head, base, body)
}

func (g *GitSync) HostPush(repoPath, accountJSON, token, branch string) error {
	if repoPath == "" {
		repoPath = g.defaultRepoPath()
	}
	var account git.HostAccount
	if err := json.Unmarshal([]byte(accountJSON), &account); err != nil {
		return fmt.Errorf("invalid host account: %w", err)
	}
	return git.PushWithHostAccount(repoPath, branch, account, token)
}

func (g *GitSync) RunTerminalCommand(repoPath, command string) (string, error) {
	if repoPath == "" {
		repoPath = g.defaultRepoPath()
	}
	result, err := git.RunTerminalCommand(repoPath, command)
	if err != nil {
		return "", err
	}
	raw, _ := json.Marshal(result)
	return string(raw), nil
}
