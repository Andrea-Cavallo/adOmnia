package git

import (
	"fmt"
	"strings"
)

// SearchFilters captures the structured commit-history query. Empty fields are
// ignored. Pickaxe drives `git log -S` (string) or `-G` (regex) code searches.
type SearchFilters struct {
	Author      string `json:"author"`
	Message     string `json:"message"`
	File        string `json:"file"`
	Branch      string `json:"branch"`
	After       string `json:"after"`
	Before      string `json:"before"`
	SHA         string `json:"sha"`
	IsMerge     bool   `json:"isMerge"`
	Pickaxe     string `json:"pickaxe"`
	PickaxeMode string `json:"pickaxeMode"` // "S" (literal) | "G" (regex)
	All         bool   `json:"all"`
	Limit       int    `json:"limit"`
}

// SearchHistory runs a filtered `git log`, returning the matching commits in the
// shared CommitInfo shape so results render in the same graph component.
func SearchHistory(repoPath string, f SearchFilters) ([]CommitInfo, error) {
	limit := f.Limit
	if limit <= 0 {
		limit = 200
	}

	// A specific SHA short-circuits everything else.
	if sha := strings.TrimSpace(f.SHA); sha != "" {
		out, err := runGit(repoPath, "log", "-1", "--date=short", commitLogFormat, sha)
		if err != nil {
			return []CommitInfo{}, nil // not found → empty, not an error
		}
		return parseCommitLog(out), nil
	}

	args := []string{"log", fmt.Sprintf("--max-count=%d", limit), "--date=short", commitLogFormat}
	if a := strings.TrimSpace(f.Author); a != "" {
		args = append(args, "--author="+a)
	}
	if m := strings.TrimSpace(f.Message); m != "" {
		args = append(args, "-i", "--grep="+m)
	}
	if af := strings.TrimSpace(f.After); af != "" {
		args = append(args, "--after="+af)
	}
	if bf := strings.TrimSpace(f.Before); bf != "" {
		args = append(args, "--before="+bf)
	}
	if f.IsMerge {
		args = append(args, "--merges")
	}
	if pick := strings.TrimSpace(f.Pickaxe); pick != "" {
		if strings.ToUpper(f.PickaxeMode) == "G" {
			args = append(args, "-G"+pick)
		} else {
			args = append(args, "-S"+pick, "--pickaxe-regex")
		}
	}

	// Revision scope: explicit branch, or all refs, else current HEAD.
	if b := strings.TrimSpace(f.Branch); b != "" {
		args = append(args, b)
	} else if f.All {
		args = append(args, "--all")
	}

	// Pathspec last; supports globs like *.go.
	if file := strings.TrimSpace(f.File); file != "" {
		args = append(args, "--", file)
	}

	out, err := runGit(repoPath, args...)
	if err != nil {
		// Bad pickaxe regex / unknown ref → return empty rather than a hard error
		// so the search bar degrades gracefully.
		return []CommitInfo{}, nil
	}
	return parseCommitLog(out), nil
}
