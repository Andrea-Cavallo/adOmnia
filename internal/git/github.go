package git

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"strings"
	"time"
)

// GitHub host integration: validate a PAT, list open pull requests, and create
// a PR from the current branch. Tokens are never persisted here — the caller
// passes them per-request, keeping this layer stateless and local-first.
// ponytail: GitHub-only + PAT; a provider interface and OAuth are the upgrade
// path once a second host (#26) or multi-account (#34) is actually needed.

const githubAPI = "https://api.github.com"

// PullRequest is the trimmed PR shape the UI needs.
type PullRequest struct {
	Number int    `json:"number"`
	Title  string `json:"title"`
	State  string `json:"state"`
	Author string `json:"author"`
	Head   string `json:"head"`
	Base   string `json:"base"`
	URL    string `json:"url"`
	Draft  bool   `json:"draft"`
}

// githubOwnerRepo extracts owner/repo from the origin remote, erroring when the
// origin is not a github.com repository.
func githubOwnerRepo(repoPath string) (owner, repo string, err error) {
	return parseGitHubOwnerRepo(remoteWebBase(originURL(repoPath)))
}

// parseGitHubOwnerRepo pulls owner/repo out of a github.com web base.
func parseGitHubOwnerRepo(base string) (owner, repo string, err error) {
	const marker = "github.com/"
	idx := strings.Index(strings.ToLower(base), marker)
	if idx == -1 {
		return "", "", fmt.Errorf("origin is not a GitHub repository")
	}
	path := strings.Trim(base[idx+len(marker):], "/")
	parts := strings.SplitN(path, "/", 2)
	if len(parts) != 2 || parts[0] == "" || parts[1] == "" {
		return "", "", fmt.Errorf("cannot determine owner/repo from origin")
	}
	return parts[0], parts[1], nil
}

func githubRequest(ctx context.Context, method, url, token string, body io.Reader) (*http.Response, error) {
	req, err := http.NewRequestWithContext(ctx, method, url, body)
	if err != nil {
		return nil, err
	}
	req.Header.Set("Authorization", "Bearer "+strings.TrimSpace(token))
	req.Header.Set("Accept", "application/vnd.github+json")
	req.Header.Set("X-GitHub-Api-Version", "2022-11-28")
	if body != nil {
		req.Header.Set("Content-Type", "application/json")
	}
	return http.DefaultClient.Do(req)
}

// githubError turns a non-2xx response into a clean, frontend-safe error using
// GitHub's JSON "message" field when present.
func githubError(resp *http.Response) error {
	raw, _ := io.ReadAll(io.LimitReader(resp.Body, 1<<16))
	var parsed struct {
		Message string `json:"message"`
	}
	if json.Unmarshal(raw, &parsed) == nil && parsed.Message != "" {
		return fmt.Errorf("GitHub: %s (%d)", parsed.Message, resp.StatusCode)
	}
	return fmt.Errorf("GitHub request failed (%d)", resp.StatusCode)
}

// ValidateGitHubToken returns the authenticated login for a PAT, or an error.
func ValidateGitHubToken(token string) (string, error) {
	if strings.TrimSpace(token) == "" {
		return "", fmt.Errorf("token is empty")
	}
	ctx, cancel := context.WithTimeout(context.Background(), 15*time.Second)
	defer cancel()
	resp, err := githubRequest(ctx, http.MethodGet, githubAPI+"/user", token, nil)
	if err != nil {
		return "", err
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		return "", githubError(resp)
	}
	var user struct {
		Login string `json:"login"`
	}
	if err := json.NewDecoder(resp.Body).Decode(&user); err != nil {
		return "", err
	}
	return user.Login, nil
}

// rawPR is the subset of GitHub's PR payload we read.
type rawPR struct {
	Number  int    `json:"number"`
	Title   string `json:"title"`
	State   string `json:"state"`
	Draft   bool   `json:"draft"`
	HTMLURL string `json:"html_url"`
	User    struct {
		Login string `json:"login"`
	} `json:"user"`
	Head struct {
		Ref string `json:"ref"`
	} `json:"head"`
	Base struct {
		Ref string `json:"ref"`
	} `json:"base"`
}

func (r rawPR) toPR() PullRequest {
	return PullRequest{
		Number: r.Number, Title: r.Title, State: r.State, Draft: r.Draft,
		Author: r.User.Login, Head: r.Head.Ref, Base: r.Base.Ref, URL: r.HTMLURL,
	}
}

// ListGitHubPRs returns open pull requests for the origin repository.
func ListGitHubPRs(repoPath, token string) ([]PullRequest, error) {
	owner, repo, err := githubOwnerRepo(repoPath)
	if err != nil {
		return nil, err
	}
	ctx, cancel := context.WithTimeout(context.Background(), 20*time.Second)
	defer cancel()
	url := fmt.Sprintf("%s/repos/%s/%s/pulls?state=open&per_page=50", githubAPI, owner, repo)
	resp, err := githubRequest(ctx, http.MethodGet, url, token, nil)
	if err != nil {
		return nil, err
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		return nil, githubError(resp)
	}
	var raws []rawPR
	if err := json.NewDecoder(resp.Body).Decode(&raws); err != nil {
		return nil, err
	}
	prs := make([]PullRequest, 0, len(raws))
	for _, r := range raws {
		prs = append(prs, r.toPR())
	}
	return prs, nil
}

// CreateGitHubPR opens a pull request on the origin repository. An empty base
// defaults to the repository's default branch on GitHub's side.
func CreateGitHubPR(repoPath, token, title, head, base, body string) (PullRequest, error) {
	owner, repo, err := githubOwnerRepo(repoPath)
	if err != nil {
		return PullRequest{}, err
	}
	if strings.TrimSpace(title) == "" || strings.TrimSpace(head) == "" {
		return PullRequest{}, fmt.Errorf("title and source branch are required")
	}
	payload := map[string]string{"title": title, "head": head, "body": body}
	if b := strings.TrimSpace(base); b != "" {
		payload["base"] = b
	}
	buf, _ := json.Marshal(payload)
	ctx, cancel := context.WithTimeout(context.Background(), 20*time.Second)
	defer cancel()
	url := fmt.Sprintf("%s/repos/%s/%s/pulls", githubAPI, owner, repo)
	resp, err := githubRequest(ctx, http.MethodPost, url, token, bytes.NewReader(buf))
	if err != nil {
		return PullRequest{}, err
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusCreated {
		return PullRequest{}, githubError(resp)
	}
	var raw rawPR
	if err := json.NewDecoder(resp.Body).Decode(&raw); err != nil {
		return PullRequest{}, err
	}
	return raw.toPR(), nil
}
