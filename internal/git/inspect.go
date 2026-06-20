package git

import (
	"fmt"
	"net/url"
	"regexp"
	"strings"
)

// CommitMeta is the relational/state info the context menu needs to decide which
// actions are valid for a commit, without duplicating what the details panel
// already shows. Computed on demand for the right-clicked commit.
type CommitMeta struct {
	Hash            string   `json:"hash"`
	FullHash        string   `json:"fullHash"`
	Parents         []string `json:"parents"`
	IsMerge         bool     `json:"isMerge"`
	IsHead          bool     `json:"isHead"`
	OnCurrentBranch bool     `json:"onCurrentBranch"`
	Published       bool     `json:"published"`
	Branches        []string `json:"branches"`
	Tags            []string `json:"tags"`
	RemoteURL       string   `json:"remoteURL"`
	Subject         string   `json:"subject"`
	Body            string   `json:"body"`
	Author          string   `json:"author"`
	AuthorEmail     string   `json:"authorEmail"`
	Date            string   `json:"date"`
}

// GetCommitMeta resolves the relational metadata for a single commit.
func GetCommitMeta(repoPath, ref string) (CommitMeta, error) {
	ref = strings.TrimSpace(ref)
	if ref == "" {
		return CommitMeta{}, fmt.Errorf("commit ref is empty")
	}
	full, err := runGit(repoPath, "rev-parse", ref)
	if err != nil {
		return CommitMeta{}, fmt.Errorf("resolve commit: %w", err)
	}
	meta := CommitMeta{
		Hash:     full[:min(7, len(full))],
		FullHash: full,
		Parents:  []string{},
		Branches: []string{},
		Tags:     []string{},
	}

	// Subject / body / author / date in one show.
	if out, err := runGit(repoPath, "show", "-s", "--format=%P%x1f%an%x1f%ae%x1f%ad%x1f%s%x1f%b", "--date=short", full); err == nil {
		parts := strings.Split(out, "\x1f")
		if len(parts) >= 6 {
			if p := strings.TrimSpace(parts[0]); p != "" {
				meta.Parents = strings.Fields(p)
			}
			meta.Author = parts[1]
			meta.AuthorEmail = parts[2]
			meta.Date = parts[3]
			meta.Subject = parts[4]
			meta.Body = strings.TrimSpace(parts[5])
		}
	}
	meta.IsMerge = len(meta.Parents) > 1

	if head, err := runGit(repoPath, "rev-parse", "HEAD"); err == nil {
		meta.IsHead = head == full
	}
	// Reachable from current HEAD (ancestor) → on current branch history.
	if _, err := runGit(repoPath, "merge-base", "--is-ancestor", full, "HEAD"); err == nil {
		meta.OnCurrentBranch = true
	}
	// Published = contained by at least one remote-tracking ref.
	if out, err := runGit(repoPath, "branch", "-r", "--contains", full); err == nil && strings.TrimSpace(out) != "" {
		meta.Published = true
	}
	if out, err := runGit(repoPath, "branch", "--contains", full, "--format=%(refname:short)"); err == nil {
		for _, line := range splitLines(out) {
			meta.Branches = append(meta.Branches, line)
		}
	}
	if out, err := runGit(repoPath, "tag", "--points-at", full); err == nil {
		for _, line := range splitLines(out) {
			meta.Tags = append(meta.Tags, line)
		}
	}
	meta.RemoteURL = commitWebURL(repoPath, full)
	return meta, nil
}

// scpLikeRe matches git@host:owner/repo(.git) SSH remotes.
var scpLikeRe = regexp.MustCompile(`^(?:ssh://)?git@([^:/]+)[:/](.+?)(?:\.git)?/?$`)

// remoteWebBase converts an origin URL into an https web base like
// "https://github.com/owner/repo", or "" when it is not a recognizable host.
func remoteWebBase(remoteURL string) string {
	remoteURL = strings.TrimSpace(remoteURL)
	if remoteURL == "" {
		return ""
	}
	if m := scpLikeRe.FindStringSubmatch(remoteURL); m != nil {
		if strings.EqualFold(m[1], "ssh.dev.azure.com") {
			parts := strings.Split(strings.TrimPrefix(m[2], "v3/"), "/")
			if len(parts) >= 3 {
				return "https://dev.azure.com/" + parts[0] + "/" + parts[1] + "/_git/" + strings.Join(parts[2:], "/")
			}
		}
		return "https://" + m[1] + "/" + strings.TrimSuffix(m[2], "/")
	}
	for _, prefix := range []string{"https://", "http://"} {
		if strings.HasPrefix(remoteURL, prefix) {
			base := strings.TrimSuffix(strings.TrimSuffix(remoteURL, "/"), ".git")
			// Strip embedded credentials (user:pass@host) for a clean web URL.
			if at := strings.Index(base, "@"); at != -1 && strings.Contains(base[:at], ":") {
				base = prefix + base[at+1:]
			}
			return base
		}
	}
	return ""
}

func originURL(repoPath string) string {
	url, _ := runGit(repoPath, "remote", "get-url", "origin")
	return strings.TrimSpace(url)
}

// commitWebURL builds a browser URL to view a commit on the origin host.
func commitWebURL(repoPath, fullHash string) string {
	base := remoteWebBase(originURL(repoPath))
	return commitURLForBase(base, fullHash)
}

func commitURLForBase(base, fullHash string) string {
	if base == "" {
		return ""
	}
	if strings.Contains(base, "gitlab") {
		return base + "/-/commit/" + fullHash
	}
	if strings.Contains(base, "bitbucket") {
		return base + "/commits/" + fullHash
	}
	return base + "/commit/" + fullHash
}

// CompareWebURL builds a browser URL comparing two refs on the origin host.
func CompareWebURL(repoPath, refA, refB string) string {
	base := remoteWebBase(originURL(repoPath))
	return compareURLForBase(base, refA, refB)
}

func compareURLForBase(base, refA, refB string) string {
	if base == "" {
		return ""
	}
	if strings.Contains(base, "gitlab") {
		return base + "/-/compare/" + refA + "..." + refB
	}
	if isAzureDevOpsBase(base) {
		return base + "/branchCompare?baseVersion=GB" + url.QueryEscape(refA) +
			"&targetVersion=GB" + url.QueryEscape(refB) + "&_a=commits"
	}
	return base + "/compare/" + refA + "..." + refB
}

func isAzureDevOpsBase(base string) bool {
	lower := strings.ToLower(base)
	return strings.Contains(lower, "dev.azure.com/") || strings.Contains(lower, ".visualstudio.com/")
}

// RemoteWebURL returns the bare web URL of origin ("" if none/unrecognized).
func RemoteWebURL(repoPath string) string {
	return remoteWebBase(originURL(repoPath))
}

func splitLines(s string) []string {
	out := []string{}
	for _, line := range strings.Split(s, "\n") {
		if t := strings.TrimSpace(line); t != "" {
			out = append(out, t)
		}
	}
	return out
}
