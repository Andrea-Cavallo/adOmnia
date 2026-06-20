package git

import (
	"fmt"
	"strings"
)

type SubmoduleInfo struct {
	Path  string `json:"path"`
	Hash  string `json:"hash"`
	State string `json:"state"`
}

func ListSubmodules(repoPath string) ([]SubmoduleInfo, error) {
	out, err := runGit(repoPath, "submodule", "status", "--recursive")
	if err != nil {
		// A repository without .gitmodules is a valid empty result.
		if !pathExists(repoPath + "/.gitmodules") {
			return []SubmoduleInfo{}, nil
		}
		return nil, err
	}
	items := []SubmoduleInfo{}
	for _, line := range splitLines(out) {
		if len(line) < 2 {
			continue
		}
		prefix := line[0]
		fields := strings.Fields(strings.TrimSpace(line[1:]))
		if len(fields) < 2 {
			continue
		}
		state := "ready"
		switch prefix {
		case '-':
			state = "uninitialized"
		case '+':
			state = "modified"
		case 'U':
			state = "conflict"
		}
		items = append(items, SubmoduleInfo{Path: fields[1], Hash: fields[0], State: state})
	}
	return items, nil
}

func AddSubmodule(repoPath, remoteURL, path, branch string) error {
	remoteURL, path, branch = strings.TrimSpace(remoteURL), strings.TrimSpace(path), strings.TrimSpace(branch)
	if remoteURL == "" || path == "" {
		return fmt.Errorf("submodule URL and path are required")
	}
	args := []string{"-c", "protocol.file.allow=always", "submodule", "add"}
	if branch != "" {
		args = append(args, "-b", branch)
	}
	_, err := runGit(repoPath, append(args, "--", remoteURL, path)...)
	return err
}

func UpdateSubmodules(repoPath, path string) error {
	args := []string{"-c", "protocol.file.allow=always", "submodule", "update", "--init", "--recursive"}
	if path = strings.TrimSpace(path); path != "" {
		args = append(args, "--", path)
	}
	_, err := runGit(repoPath, args...)
	return err
}

func RemoveSubmodule(repoPath, path string) error {
	path = strings.TrimSpace(path)
	if path == "" {
		return fmt.Errorf("submodule path is required")
	}
	if _, err := runGit(repoPath, "submodule", "deinit", "-f", "--", path); err != nil {
		return err
	}
	_, err := runGit(repoPath, "rm", "-f", "--", path)
	return err
}

type WorktreeInfo struct {
	Path     string `json:"path"`
	Head     string `json:"head"`
	Branch   string `json:"branch"`
	Bare     bool   `json:"bare"`
	Detached bool   `json:"detached"`
}

func ListWorktrees(repoPath string) ([]WorktreeInfo, error) {
	out, err := runGit(repoPath, "worktree", "list", "--porcelain")
	if err != nil {
		return nil, err
	}
	items := []WorktreeInfo{}
	current := WorktreeInfo{}
	flush := func() {
		if current.Path != "" {
			items = append(items, current)
			current = WorktreeInfo{}
		}
	}
	for _, line := range strings.Split(out, "\n") {
		if line == "" {
			flush()
			continue
		}
		switch {
		case strings.HasPrefix(line, "worktree "):
			current.Path = strings.TrimPrefix(line, "worktree ")
		case strings.HasPrefix(line, "HEAD "):
			current.Head = strings.TrimPrefix(line, "HEAD ")
		case strings.HasPrefix(line, "branch "):
			current.Branch = strings.TrimPrefix(line, "branch refs/heads/")
		case line == "bare":
			current.Bare = true
		case line == "detached":
			current.Detached = true
		}
	}
	flush()
	return items, nil
}

func AddWorktree(repoPath, path, branch string, createBranch bool) error {
	path, branch = strings.TrimSpace(path), strings.TrimSpace(branch)
	if path == "" {
		return fmt.Errorf("worktree path is required")
	}
	args := []string{"worktree", "add"}
	if createBranch {
		if branch == "" {
			return fmt.Errorf("new branch name is required")
		}
		args = append(args, "-b", branch, path)
	} else {
		args = append(args, path)
		if branch != "" {
			args = append(args, branch)
		}
	}
	_, err := runGit(repoPath, args...)
	return err
}

func RemoveWorktree(repoPath, path string, force bool) error {
	path = strings.TrimSpace(path)
	if path == "" {
		return fmt.Errorf("worktree path is required")
	}
	args := []string{"worktree", "remove"}
	if force {
		args = append(args, "--force")
	}
	_, err := runGit(repoPath, append(args, path)...)
	return err
}

func SparseCheckoutList(repoPath string) ([]string, error) {
	out, err := runGit(repoPath, "sparse-checkout", "list")
	if err != nil {
		return []string{}, nil
	}
	return splitLines(out), nil
}

func SetSparseCheckout(repoPath string, paths []string, cone bool) error {
	clean := []string{}
	for _, path := range paths {
		if path = strings.TrimSpace(path); path != "" {
			clean = append(clean, path)
		}
	}
	if len(clean) == 0 {
		return fmt.Errorf("at least one sparse path is required")
	}
	mode := "--no-cone"
	if cone {
		mode = "--cone"
	}
	if _, err := runGit(repoPath, "sparse-checkout", "init", mode); err != nil {
		return err
	}
	_, err := runGit(repoPath, append([]string{"sparse-checkout", "set", "--"}, clean...)...)
	return err
}

func DisableSparseCheckout(repoPath string) error {
	_, err := runGit(repoPath, "sparse-checkout", "disable")
	return err
}
