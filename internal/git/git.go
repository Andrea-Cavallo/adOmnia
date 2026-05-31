package git

import (
	"bytes"
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
)

type Config struct {
	RepoPath    string `json:"repoPath"`
	RemoteURL   string `json:"remoteURL"`
	Branch      string `json:"branch"`
	AuthorName  string `json:"authorName"`
	AuthorEmail string `json:"authorEmail"`
}

type Status struct {
	Branch      string   `json:"branch"`
	Dirty       bool     `json:"dirty"`
	AheadCount  int      `json:"aheadCount"`
	BehindCount int      `json:"behindCount"`
	Modified    []string `json:"modified"`
	Untracked   []string `json:"untracked"`
}

type CommitResult struct {
	Hash    string `json:"hash"`
	Message string `json:"message"`
}

func runGit(dir string, args ...string) (string, error) {
	cmd := exec.Command("git", args...)
	cmd.Dir = dir
	var out, errBuf bytes.Buffer
	cmd.Stdout = &out
	cmd.Stderr = &errBuf
	if err := cmd.Run(); err != nil {
		return "", fmt.Errorf("git %s: %w\n%s", strings.Join(args, " "), err, errBuf.String())
	}
	return strings.TrimSpace(out.String()), nil
}

func Init(cfg Config) error {
	if err := os.MkdirAll(cfg.RepoPath, 0755); err != nil {
		return fmt.Errorf("mkdir: %w", err)
	}
	if _, err := os.Stat(filepath.Join(cfg.RepoPath, ".git")); os.IsNotExist(err) {
		if _, err := runGit(cfg.RepoPath, "init", "-b", cfg.Branch); err != nil {
			return err
		}
	}
	if cfg.AuthorName != "" {
		_, _ = runGit(cfg.RepoPath, "config", "user.name", cfg.AuthorName)
	}
	if cfg.AuthorEmail != "" {
		_, _ = runGit(cfg.RepoPath, "config", "user.email", cfg.AuthorEmail)
	}
	if cfg.RemoteURL != "" {
		existing, _ := runGit(cfg.RepoPath, "remote", "get-url", "origin")
		if existing == "" {
			_, _ = runGit(cfg.RepoPath, "remote", "add", "origin", cfg.RemoteURL)
		} else if existing != cfg.RemoteURL {
			_, _ = runGit(cfg.RepoPath, "remote", "set-url", "origin", cfg.RemoteURL)
		}
	}
	return nil
}

func GetStatus(repoPath string) (Status, error) {
	branch, _ := runGit(repoPath, "rev-parse", "--abbrev-ref", "HEAD")
	porcelain, _ := runGit(repoPath, "status", "--porcelain")

	var modified, untracked []string
	for _, line := range strings.Split(porcelain, "\n") {
		if len(line) < 4 {
			continue
		}
		xy := line[:2]
		file := strings.TrimSpace(line[3:])
		if xy == "??" {
			untracked = append(untracked, file)
		} else {
			modified = append(modified, file)
		}
	}

	ahead, behind := 0, 0
	if ab, err := runGit(repoPath, "rev-list", "--left-right", "--count", "HEAD...@{upstream}"); err == nil {
		fmt.Sscanf(ab, "%d\t%d", &ahead, &behind)
	}

	return Status{
		Branch:      branch,
		Dirty:       len(modified)+len(untracked) > 0,
		AheadCount:  ahead,
		BehindCount: behind,
		Modified:    modified,
		Untracked:   untracked,
	}, nil
}

func CommitAll(repoPath, message string) (CommitResult, error) {
	if _, err := runGit(repoPath, "add", "."); err != nil {
		return CommitResult{}, err
	}
	if _, err := runGit(repoPath, "commit", "-m", message); err != nil {
		return CommitResult{}, err
	}
	hash, _ := runGit(repoPath, "rev-parse", "--short", "HEAD")
	return CommitResult{Hash: hash, Message: message}, nil
}

func Push(repoPath, branch string) error {
	if branch == "" {
		branch = "main"
	}
	_, err := runGit(repoPath, "push", "origin", branch)
	return err
}

func Pull(repoPath, branch string) error {
	if branch == "" {
		branch = "main"
	}
	_, err := runGit(repoPath, "pull", "--rebase", "origin", branch)
	return err
}

func Log(repoPath string, n int) ([]string, error) {
	if n <= 0 {
		n = 10
	}
	out, err := runGit(repoPath, "log", fmt.Sprintf("--max-count=%d", n),
		"--pretty=format:%h %s (%ar)")
	if err != nil {
		return nil, err
	}
	if out == "" {
		return []string{}, nil
	}
	return strings.Split(out, "\n"), nil
}

func IsInstalled() bool {
	_, err := exec.LookPath("git")
	return err == nil
}
