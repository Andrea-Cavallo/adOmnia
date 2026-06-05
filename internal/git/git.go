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

type FileChange struct {
	Path       string `json:"path"`
	Index      string `json:"index"`
	Worktree   string `json:"worktree"`
	Status     string `json:"status"`
	Conflicted bool   `json:"conflicted"`
}

type BranchInfo struct {
	Name       string `json:"name"`
	Remote     bool   `json:"remote"`
	Current    bool   `json:"current"`
	Upstream   string `json:"upstream"`
	CommitHash string `json:"commitHash"`
	Updated    string `json:"updated"`
}

type RemoteInfo struct {
	Name string `json:"name"`
	URL  string `json:"url"`
}

type CommitInfo struct {
	Hash       string   `json:"hash"`
	FullHash   string   `json:"fullHash"`
	Parents    []string `json:"parents"`
	Author     string   `json:"author"`
	Date       string   `json:"date"`
	Message    string   `json:"message"`
	Decorations []string `json:"decorations"`
}

type Overview struct {
	Status    Status       `json:"status"`
	Changes   []FileChange `json:"changes"`
	Conflicts []FileChange `json:"conflicts"`
	Branches  []BranchInfo `json:"branches"`
	Remotes   []RemoteInfo `json:"remotes"`
	Stashes   []string     `json:"stashes"`
	Commits   []CommitInfo `json:"commits"`
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
			if _, err := runGit(cfg.RepoPath, "remote", "add", "origin", cfg.RemoteURL); err != nil {
				return fmt.Errorf("set remote origin: %w", err)
			}
		} else if existing != cfg.RemoteURL {
			if _, err := runGit(cfg.RepoPath, "remote", "set-url", "origin", cfg.RemoteURL); err != nil {
				return fmt.Errorf("update remote origin: %w", err)
			}
		}
	}
	return nil
}

func GetStatus(repoPath string) (Status, error) {
	if repoPath == "" {
		return Status{}, fmt.Errorf("repository path is empty")
	}
	// Fail clearly when the path is not a git working tree, instead of
	// returning an empty-but-valid-looking status the UI would misread.
	if _, err := runGit(repoPath, "rev-parse", "--is-inside-work-tree"); err != nil {
		return Status{}, fmt.Errorf("not a git repository: %s", repoPath)
	}

	branch, err := runGit(repoPath, "rev-parse", "--abbrev-ref", "HEAD")
	if err != nil {
		// A freshly-initialized repo with no commits has no HEAD yet.
		branch = ""
	}
	porcelain, err := runGit(repoPath, "status", "--porcelain")
	if err != nil {
		return Status{}, err
	}

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

func parsePorcelain(porcelain string) []FileChange {
	var changes []FileChange
	conflictCodes := map[string]bool{"DD": true, "AU": true, "UD": true, "UA": true, "DU": true, "AA": true, "UU": true}
	for _, line := range strings.Split(porcelain, "\n") {
		if len(line) < 4 || strings.HasPrefix(line, "##") {
			continue
		}
		code := line[:2]
		path := strings.TrimSpace(line[3:])
		change := FileChange{
			Path:       path,
			Index:      strings.TrimSpace(code[:1]),
			Worktree:   strings.TrimSpace(code[1:2]),
			Status:     code,
			Conflicted: conflictCodes[code],
		}
		changes = append(changes, change)
	}
	return changes
}

func GetOverview(repoPath string, n int) (Overview, error) {
	status, err := GetStatus(repoPath)
	if err != nil {
		return Overview{}, err
	}
	if n <= 0 {
		n = 80
	}

	porcelain, _ := runGit(repoPath, "status", "--porcelain")
	changes := parsePorcelain(porcelain)
	var conflicts []FileChange
	for _, change := range changes {
		if change.Conflicted {
			conflicts = append(conflicts, change)
		}
	}

	var branches []BranchInfo
	if out, err := runGit(repoPath, "branch", "--all", "--format=%(refname:short)|%(upstream:short)|%(objectname:short)|%(committerdate:relative)"); err == nil {
		for _, line := range strings.Split(out, "\n") {
			if strings.TrimSpace(line) == "" {
				continue
			}
			parts := strings.Split(line, "|")
			name := strings.TrimSpace(parts[0])
			if name == "" || strings.Contains(name, "HEAD ->") {
				continue
			}
			info := BranchInfo{Name: name, Remote: strings.HasPrefix(name, "remotes/"), Current: name == status.Branch}
			if len(parts) > 1 {
				info.Upstream = strings.TrimSpace(parts[1])
			}
			if len(parts) > 2 {
				info.CommitHash = strings.TrimSpace(parts[2])
			}
			if len(parts) > 3 {
				info.Updated = strings.TrimSpace(parts[3])
			}
			branches = append(branches, info)
		}
	}

	remoteURLs := map[string]string{}
	if out, err := runGit(repoPath, "remote", "-v"); err == nil {
		for _, line := range strings.Split(out, "\n") {
			fields := strings.Fields(line)
			if len(fields) >= 3 && fields[2] == "(fetch)" {
				remoteURLs[fields[0]] = fields[1]
			}
		}
	}
	var remotes []RemoteInfo
	for name, url := range remoteURLs {
		remotes = append(remotes, RemoteInfo{Name: name, URL: url})
	}

	var stashes []string
	if out, err := runGit(repoPath, "stash", "list"); err == nil && out != "" {
		stashes = strings.Split(out, "\n")
	}

	var commits []CommitInfo
	if out, err := runGit(repoPath, "log", fmt.Sprintf("--max-count=%d", n), "--date=short", "--pretty=format:%h%x1f%H%x1f%P%x1f%an%x1f%ad%x1f%s%x1f%D"); err == nil && out != "" {
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
	}

	return Overview{
		Status:    status,
		Changes:   changes,
		Conflicts: conflicts,
		Branches:  branches,
		Remotes:   remotes,
		Stashes:   stashes,
		Commits:   commits,
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

func StageFile(repoPath, path string) error {
	if path == "" {
		return fmt.Errorf("file path is empty")
	}
	_, err := runGit(repoPath, "add", "--", path)
	return err
}

func CheckoutConflictSide(repoPath, path, side string) error {
	if path == "" {
		return fmt.Errorf("file path is empty")
	}
	if side != "ours" && side != "theirs" {
		return fmt.Errorf("invalid conflict side: %s", side)
	}
	_, err := runGit(repoPath, "checkout", "--"+side, "--", path)
	return err
}

func AbortIntegration(repoPath string) error {
	if _, err := runGit(repoPath, "merge", "--abort"); err == nil {
		return nil
	}
	if _, err := runGit(repoPath, "rebase", "--abort"); err == nil {
		return nil
	}
	return fmt.Errorf("no merge or rebase operation to abort")
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
