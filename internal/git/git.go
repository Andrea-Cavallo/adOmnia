package git

import (
	"bytes"
	"errors"
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"time"
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
	Hash        string   `json:"hash"`
	FullHash    string   `json:"fullHash"`
	Parents     []string `json:"parents"`
	Author      string   `json:"author"`
	Date        string   `json:"date"`
	Message     string   `json:"message"`
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

type ChangedFile struct {
	Status  string `json:"status"` // M, A, D, R, C, U
	Path    string `json:"path"`
	OldPath string `json:"oldPath"` // only set for renames (R)
}

type WorkingTreeFileSnapshot struct {
	Path       string `json:"path"`
	OldPath    string `json:"oldPath,omitempty"`
	OldContent string `json:"oldContent"`
	NewContent string `json:"newContent"`
	Diff       string `json:"diff"`
}

func runGit(dir string, args ...string) (string, error) {
	cmd := exec.Command("git", args...)
	cmd.Dir = dir
	configureHiddenCommand(cmd)
	var out, errBuf bytes.Buffer
	cmd.Stdout = &out
	cmd.Stderr = &errBuf
	if err := cmd.Run(); err != nil {
		return "", fmt.Errorf("git %s: %w\n%s", strings.Join(args, " "), err, errBuf.String())
	}
	return strings.TrimSpace(out.String()), nil
}

// statusPorcelain runs `git status --porcelain` trimming only the trailing
// newline. runGit's TrimSpace would strip the leading space of the FIRST line
// (e.g. " M file" → "M file"), shifting the status columns and corrupting the
// first changed file's name/status. Porcelain parsing must keep column 0.
func statusPorcelain(repoPath string) (string, error) {
	cmd := exec.Command("git", "status", "--porcelain")
	cmd.Dir = repoPath
	configureHiddenCommand(cmd)
	var out, errBuf bytes.Buffer
	cmd.Stdout = &out
	cmd.Stderr = &errBuf
	if err := cmd.Run(); err != nil {
		return "", fmt.Errorf("git status --porcelain: %w\n%s", err, errBuf.String())
	}
	return strings.TrimRight(out.String(), "\r\n"), nil
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

func Clone(remoteURL, destination string) error {
	remoteURL = strings.TrimSpace(remoteURL)
	destination = strings.TrimSpace(destination)
	if remoteURL == "" {
		return fmt.Errorf("remote URL is empty")
	}
	if destination == "" {
		return fmt.Errorf("destination path is empty")
	}
	cmd := exec.Command("git", "clone", remoteURL, destination)
	configureHiddenCommand(cmd)
	var errBuf bytes.Buffer
	cmd.Stderr = &errBuf
	if err := cmd.Run(); err != nil {
		return fmt.Errorf("git clone: %w\n%s", err, errBuf.String())
	}
	return nil
}

func ConfigureUser(repoPath, name, email string) error {
	name = strings.TrimSpace(name)
	email = strings.TrimSpace(email)
	if name == "" && email == "" {
		return fmt.Errorf("name or email is required")
	}
	if name != "" {
		if _, err := runGit(repoPath, "config", "user.name", name); err != nil {
			return err
		}
	}
	if email != "" {
		if _, err := runGit(repoPath, "config", "user.email", email); err != nil {
			return err
		}
	}
	return nil
}

func AddIgnorePattern(repoPath, pattern string) error {
	pattern = strings.TrimSpace(pattern)
	if pattern == "" {
		return fmt.Errorf("ignore pattern is empty")
	}
	ignorePath := filepath.Join(repoPath, ".gitignore")
	f, err := os.OpenFile(ignorePath, os.O_CREATE|os.O_APPEND|os.O_WRONLY, 0644)
	if err != nil {
		return fmt.Errorf("open .gitignore: %w", err)
	}
	defer f.Close()
	if _, err := fmt.Fprintln(f, pattern); err != nil {
		return fmt.Errorf("write .gitignore: %w", err)
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
	porcelain, err := statusPorcelain(repoPath)
	if err != nil {
		return Status{}, err
	}

	// Non-nil so JSON marshals empty collections as [] (not null), which the
	// frontend reads with .length without guarding.
	modified, untracked := []string{}, []string{}
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
	changes := []FileChange{}
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

	porcelain, _ := statusPorcelain(repoPath)
	changes := parsePorcelain(porcelain)
	conflicts := []FileChange{}
	for _, change := range changes {
		if change.Conflicted {
			conflicts = append(conflicts, change)
		}
	}

	branches := []BranchInfo{}
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
	remotes := []RemoteInfo{}
	for name, url := range remoteURLs {
		remotes = append(remotes, RemoteInfo{Name: name, URL: url})
	}

	stashes := []string{}
	if out, err := runGit(repoPath, "stash", "list"); err == nil && out != "" {
		stashes = strings.Split(out, "\n")
	}

	commits := []CommitInfo{}
	if out, err := runGit(repoPath, "log", "--all", "--topo-order", fmt.Sprintf("--max-count=%d", n), "--date=short", "--pretty=format:%h%x1f%H%x1f%P%x1f%an%x1f%ad%x1f%s%x1f%D"); err == nil && out != "" {
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

// CommitPaths commits exactly the given paths and nothing else. It stages each
// path (covering add/modify/delete/untracked) then does a pathspec commit, which
// records only those paths and leaves any other change untouched. This is what
// lets the Changes panel commit just the files the user ticked.
func CommitPaths(repoPath, message string, paths []string) (CommitResult, error) {
	if strings.TrimSpace(message) == "" {
		return CommitResult{}, fmt.Errorf("commit message is empty")
	}
	clean := []string{}
	for _, p := range paths {
		if p = strings.TrimSpace(p); p != "" {
			clean = append(clean, p)
		}
	}
	if len(clean) == 0 {
		return CommitResult{}, fmt.Errorf("no files selected to commit")
	}
	if _, err := runGit(repoPath, append([]string{"add", "-A", "--"}, clean...)...); err != nil {
		return CommitResult{}, err
	}
	if _, err := runGit(repoPath, append([]string{"commit", "-m", message, "--"}, clean...)...); err != nil {
		return CommitResult{}, err
	}
	hash, _ := runGit(repoPath, "rev-parse", "--short", "HEAD")
	return CommitResult{Hash: hash, Message: message}, nil
}

func Push(repoPath, branch string) error {
	branch, err := resolveCurrentBranch(repoPath, branch)
	if err != nil {
		return err
	}
	_, err = runGit(repoPath, "push", "origin", branch)
	return err
}

// resolveCurrentBranch keeps Push/Pull correct for repositories whose default
// branch is not named main or master. A detached HEAD has no safe implicit
// destination, so callers must choose a branch explicitly in that state.
func resolveCurrentBranch(repoPath, branch string) (string, error) {
	if branch = strings.TrimSpace(branch); branch != "" {
		return branch, nil
	}
	branch, err := runGit(repoPath, "symbolic-ref", "--quiet", "--short", "HEAD")
	if err != nil || strings.TrimSpace(branch) == "" {
		return "", fmt.Errorf("current checkout is detached; choose a branch before push or pull")
	}
	return strings.TrimSpace(branch), nil
}

func AddRemote(repoPath, name, remoteURL string) error {
	name = strings.TrimSpace(name)
	remoteURL = strings.TrimSpace(remoteURL)
	if name == "" || remoteURL == "" {
		return fmt.Errorf("remote name and URL are required")
	}
	if existing, _ := runGit(repoPath, "remote", "get-url", name); strings.TrimSpace(existing) != "" {
		_, err := runGit(repoPath, "remote", "set-url", name, remoteURL)
		return err
	}
	_, err := runGit(repoPath, "remote", "add", name, remoteURL)
	return err
}

func RemoveRemote(repoPath, name string) error {
	name = strings.TrimSpace(name)
	if name == "" {
		return fmt.Errorf("remote name is empty")
	}
	_, err := runGit(repoPath, "remote", "remove", name)
	return err
}

func Fetch(repoPath string) error {
	_, err := runGit(repoPath, "fetch", "--prune", "origin")
	return err
}

func Pull(repoPath, branch string) error {
	branch, err := resolveCurrentBranch(repoPath, branch)
	if err != nil {
		return err
	}
	_, err = runGit(repoPath, "pull", "--rebase", "--autostash", "origin", branch)
	return err
}

func Stash(repoPath string) error {
	_, err := runGit(repoPath, "stash", "push", "-u", "-m", "adOmnia manual stash "+time.Now().Format("2006-01-02 15:04:05"))
	return err
}

func StashPop(repoPath string) error {
	_, err := runGit(repoPath, "stash", "pop")
	return err
}

func StashDrop(repoPath, stashRef string) error {
	stashRef = strings.TrimSpace(stashRef)
	if stashRef == "" {
		stashRef = "stash@{0}"
	}
	_, err := runGit(repoPath, "stash", "drop", stashRef)
	return err
}

func CreateBranch(repoPath, branch string) error {
	branch = strings.TrimSpace(branch)
	if branch == "" {
		return fmt.Errorf("branch name is empty")
	}
	_, err := runGit(repoPath, "branch", branch)
	return err
}

func CheckoutBranch(repoPath, branch string) error {
	branch = strings.TrimSpace(branch)
	if branch == "" {
		return fmt.Errorf("branch name is empty")
	}
	_, err := runGit(repoPath, "checkout", branch)
	return err
}

func CreateAndCheckoutBranch(repoPath, branch string) error {
	branch = strings.TrimSpace(branch)
	if branch == "" {
		return fmt.Errorf("branch name is empty")
	}
	_, err := runGit(repoPath, "checkout", "-b", branch)
	return err
}

func MergeBranch(repoPath, branch string) error {
	branch = strings.TrimSpace(branch)
	if branch == "" {
		return fmt.Errorf("branch name is empty")
	}
	_, err := runGit(repoPath, "merge", branch)
	return err
}

func RebaseBranch(repoPath, branch string) error {
	branch = strings.TrimSpace(branch)
	if branch == "" {
		return fmt.Errorf("branch name is empty")
	}
	_, err := runGit(repoPath, "rebase", branch)
	return err
}

func ResetHard(repoPath, ref string) error {
	ref = strings.TrimSpace(ref)
	if ref == "" {
		return fmt.Errorf("target ref is empty")
	}
	_, err := runGit(repoPath, "reset", "--hard", ref)
	return err
}

func StageFile(repoPath, path string) error {
	if path == "" {
		return fmt.Errorf("file path is empty")
	}
	_, err := runGit(repoPath, "add", "--", path)
	return err
}

func UnstageFile(repoPath, path string) error {
	if path == "" {
		return fmt.Errorf("file path is empty")
	}
	_, err := runGit(repoPath, "reset", "--", path)
	return err
}

func RestoreFile(repoPath, path string) error {
	if path == "" {
		return fmt.Errorf("file path is empty")
	}
	_, err := runGit(repoPath, "restore", "--", path)
	return err
}

func RemoveFile(repoPath, path string) error {
	if path == "" {
		return fmt.Errorf("file path is empty")
	}
	_, err := runGit(repoPath, "rm", "--", path)
	return err
}

func MoveFile(repoPath, oldPath, newPath string) error {
	if oldPath == "" || newPath == "" {
		return fmt.Errorf("source and destination paths are required")
	}
	_, err := runGit(repoPath, "mv", "--", oldPath, newPath)
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

func Show(repoPath, ref string) (string, error) {
	ref = strings.TrimSpace(ref)
	if ref == "" {
		return "", fmt.Errorf("ref is empty")
	}
	return runGit(repoPath, "show", "--stat", "--decorate", "--oneline", ref)
}

func CreateTag(repoPath, name, ref string) error {
	name = strings.TrimSpace(name)
	ref = strings.TrimSpace(ref)
	if name == "" {
		return fmt.Errorf("tag name is empty")
	}
	args := []string{"tag", name}
	if ref != "" {
		args = append(args, ref)
	}
	_, err := runGit(repoPath, args...)
	return err
}

func DeleteTag(repoPath, name string) error {
	name = strings.TrimSpace(name)
	if name == "" {
		return fmt.Errorf("tag name is empty")
	}
	_, err := runGit(repoPath, "tag", "-d", name)
	return err
}

func IsInstalled() bool {
	_, err := exec.LookPath("git")
	return err == nil
}

// CompareRefs returns files changed between refA and refB.
func CompareRefs(repoPath, refA, refB string) ([]ChangedFile, error) {
	cmd := exec.Command("git", "-C", repoPath, "diff", "--name-status", refA, refB)
	configureHiddenCommand(cmd)
	out, err := cmd.Output()
	if err != nil {
		return nil, fmt.Errorf("git diff --name-status: %w", err)
	}
	files := []ChangedFile{}
	for _, line := range strings.Split(strings.TrimSpace(string(out)), "\n") {
		if line == "" {
			continue
		}
		parts := strings.Fields(line)
		if len(parts) < 2 {
			continue
		}
		status := parts[0]
		if strings.HasPrefix(status, "R") || strings.HasPrefix(status, "C") {
			oldPath := ""
			newPath := parts[len(parts)-1]
			if len(parts) >= 3 {
				oldPath = parts[1]
			}
			files = append(files, ChangedFile{Status: string(status[0]), Path: newPath, OldPath: oldPath})
		} else {
			files = append(files, ChangedFile{Status: status, Path: parts[1]})
		}
	}
	return files, nil
}

// GetFileDiff returns the unified diff for a single file between two refs.
func GetFileDiff(repoPath, refA, refB, filePath string) (string, error) {
	cmd := exec.Command("git", "-C", repoPath, "diff", refA, refB, "--", filePath)
	configureHiddenCommand(cmd)
	out, err := cmd.Output()
	if err != nil {
		var exitErr *exec.ExitError
		if errors.As(err, &exitErr) && exitErr.ExitCode() == 1 {
			return "", nil
		}
		return "", fmt.Errorf("git diff file: %w", err)
	}
	return string(out), nil
}

func readFileAtRef(repoPath, ref, filePath string) (string, error) {
	gitPath := filepath.ToSlash(filePath)
	cmd := exec.Command("git", "-C", repoPath, "show", fmt.Sprintf("%s:%s", ref, gitPath))
	configureHiddenCommand(cmd)
	out, err := cmd.Output()
	if err != nil {
		var exitErr *exec.ExitError
		if errors.As(err, &exitErr) {
			return "", nil
		}
		return "", fmt.Errorf("git show file: %w", err)
	}
	return string(out), nil
}

func readWorkingTreeFile(repoPath, filePath string) (string, error) {
	cleanPath := filepath.Clean(filePath)
	if filepath.IsAbs(cleanPath) || strings.HasPrefix(cleanPath, "..") {
		return "", fmt.Errorf("invalid file path: %s", filePath)
	}
	absRepo, err := filepath.Abs(repoPath)
	if err != nil {
		return "", fmt.Errorf("resolve repo path: %w", err)
	}
	absFile, err := filepath.Abs(filepath.Join(absRepo, cleanPath))
	if err != nil {
		return "", fmt.Errorf("resolve file path: %w", err)
	}
	rel, err := filepath.Rel(absRepo, absFile)
	if err != nil || strings.HasPrefix(rel, "..") || filepath.IsAbs(rel) {
		return "", fmt.Errorf("file is outside repository: %s", filePath)
	}
	out, err := os.ReadFile(absFile)
	if err != nil {
		if errors.Is(err, os.ErrNotExist) {
			return "", nil
		}
		return "", fmt.Errorf("read working file: %w", err)
	}
	return string(out), nil
}

func GetWorkingTreeFileSnapshot(repoPath, filePath, oldPath string) (WorkingTreeFileSnapshot, error) {
	leftPath := oldPath
	if leftPath == "" {
		leftPath = filePath
	}
	oldContent, err := readFileAtRef(repoPath, "HEAD", leftPath)
	if err != nil {
		return WorkingTreeFileSnapshot{}, err
	}
	newContent, err := readWorkingTreeFile(repoPath, filePath)
	if err != nil {
		return WorkingTreeFileSnapshot{}, err
	}

	cmd := exec.Command("git", "-C", repoPath, "diff", "HEAD", "--", filePath)
	configureHiddenCommand(cmd)
	out, err := cmd.Output()
	if err != nil {
		var exitErr *exec.ExitError
		if !errors.As(err, &exitErr) || exitErr.ExitCode() != 1 {
			return WorkingTreeFileSnapshot{}, fmt.Errorf("git diff working file: %w", err)
		}
	}

	return WorkingTreeFileSnapshot{
		Path:       filePath,
		OldPath:    oldPath,
		OldContent: oldContent,
		NewContent: newContent,
		Diff:       string(out),
	}, nil
}
