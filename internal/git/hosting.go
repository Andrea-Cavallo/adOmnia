package git

import (
	"bytes"
	"context"
	"encoding/base64"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"os"
	"os/exec"
	"path/filepath"
	"strconv"
	"strings"
	"time"
)

// HostAccount describes the provider-specific connection selected by the UI.
// Tokens remain caller-owned and are never persisted by the backend.
type HostAccount struct {
	Provider string `json:"provider"`
	BaseURL  string `json:"baseURL"`
	Username string `json:"username"`
}

type remoteProject struct {
	Owner, Repo, Organization, Project string
}

func normalizeProvider(provider string) string {
	return strings.ToLower(strings.TrimSpace(provider))
}

func remoteProjectFor(repoPath, provider string) (remoteProject, error) {
	raw := originURL(repoPath)
	if raw == "" {
		return remoteProject{}, fmt.Errorf("origin remote is not configured")
	}
	web := remoteWebBase(raw)
	u, err := url.Parse(web)
	if err != nil || u.Host == "" {
		return remoteProject{}, fmt.Errorf("cannot parse origin remote")
	}
	parts := strings.Split(strings.Trim(strings.TrimSuffix(u.Path, ".git"), "/"), "/")
	switch normalizeProvider(provider) {
	case "github", "gitlab", "bitbucket":
		if len(parts) < 2 {
			return remoteProject{}, fmt.Errorf("cannot determine repository from origin")
		}
		return remoteProject{Owner: strings.Join(parts[:len(parts)-1], "/"), Repo: parts[len(parts)-1]}, nil
	case "azure":
		if len(parts) >= 4 && strings.EqualFold(parts[len(parts)-2], "_git") {
			return remoteProject{Organization: parts[0], Project: strings.Join(parts[1:len(parts)-2], "/"), Repo: parts[len(parts)-1]}, nil
		}
		return remoteProject{}, fmt.Errorf("origin is not an Azure DevOps Git repository")
	default:
		return remoteProject{}, fmt.Errorf("unsupported Git host provider: %s", provider)
	}
}

func hostBase(provider, baseURL string) string {
	if strings.TrimSpace(baseURL) != "" {
		return strings.TrimRight(strings.TrimSpace(baseURL), "/")
	}
	switch normalizeProvider(provider) {
	case "github":
		return githubAPI
	case "gitlab":
		return "https://gitlab.com"
	case "bitbucket":
		return "https://api.bitbucket.org"
	case "azure":
		return "https://dev.azure.com"
	default:
		return ""
	}
}

func hostRequest(ctx context.Context, account HostAccount, method, endpoint, token string, body io.Reader) (*http.Response, error) {
	req, err := http.NewRequestWithContext(ctx, method, endpoint, body)
	if err != nil {
		return nil, err
	}
	switch normalizeProvider(account.Provider) {
	case "gitlab":
		req.Header.Set("PRIVATE-TOKEN", strings.TrimSpace(token))
	case "azure":
		req.Header.Set("Authorization", "Basic "+base64.StdEncoding.EncodeToString([]byte(":"+strings.TrimSpace(token))))
	case "bitbucket":
		if strings.TrimSpace(account.Username) != "" {
			req.Header.Set("Authorization", "Basic "+base64.StdEncoding.EncodeToString([]byte(strings.TrimSpace(account.Username)+":"+strings.TrimSpace(token))))
		} else {
			req.Header.Set("Authorization", "Bearer "+strings.TrimSpace(token))
		}
	default:
		req.Header.Set("Authorization", "Bearer "+strings.TrimSpace(token))
	}
	req.Header.Set("Accept", "application/json")
	if body != nil {
		req.Header.Set("Content-Type", "application/json")
	}
	return http.DefaultClient.Do(req)
}

func hostError(provider string, resp *http.Response) error {
	raw, _ := io.ReadAll(io.LimitReader(resp.Body, 1<<16))
	var parsed map[string]any
	_ = json.Unmarshal(raw, &parsed)
	for _, key := range []string{"message", "error_description", "error"} {
		if value, ok := parsed[key].(string); ok && value != "" {
			return fmt.Errorf("%s: %s (%d)", provider, value, resp.StatusCode)
		}
	}
	return fmt.Errorf("%s request failed (%d)", provider, resp.StatusCode)
}

func doHostJSON(account HostAccount, method, endpoint, token string, payload any, target any, expected ...int) error {
	if strings.TrimSpace(token) == "" {
		return fmt.Errorf("token is empty")
	}
	var body io.Reader
	if payload != nil {
		raw, _ := json.Marshal(payload)
		body = bytes.NewReader(raw)
	}
	ctx, cancel := context.WithTimeout(context.Background(), 20*time.Second)
	defer cancel()
	resp, err := hostRequest(ctx, account, method, endpoint, token, body)
	if err != nil {
		return err
	}
	defer resp.Body.Close()
	ok := false
	for _, status := range expected {
		if resp.StatusCode == status {
			ok = true
		}
	}
	if !ok {
		return hostError(account.Provider, resp)
	}
	if target != nil {
		return json.NewDecoder(resp.Body).Decode(target)
	}
	return nil
}

// ValidateHostToken validates an account and returns its display login.
func ValidateHostToken(repoPath string, account HostAccount, token string) (string, error) {
	provider := normalizeProvider(account.Provider)
	if provider == "github" && strings.TrimSpace(account.BaseURL) == "" {
		return ValidateGitHubToken(token)
	}
	base := hostBase(provider, account.BaseURL)
	var endpoint string
	switch provider {
	case "github":
		endpoint = base + "/user"
	case "gitlab":
		endpoint = base + "/api/v4/user"
	case "bitbucket":
		endpoint = base + "/2.0/user"
	case "azure":
		if strings.TrimSpace(account.BaseURL) == "" {
			project, err := remoteProjectFor(repoPath, provider)
			if err != nil {
				return "", err
			}
			endpoint = base + "/" + project.Organization + "/_apis/connectionData?api-version=7.1-preview.1"
		} else {
			endpoint = base + "/_apis/connectionData?api-version=7.1-preview.1"
		}
	default:
		return "", fmt.Errorf("unsupported Git host provider: %s", account.Provider)
	}
	var raw map[string]any
	if err := doHostJSON(account, http.MethodGet, endpoint, token, nil, &raw, http.StatusOK); err != nil {
		return "", err
	}
	for _, key := range []string{"login", "username", "display_name", "name"} {
		if value, ok := raw[key].(string); ok && value != "" {
			return value, nil
		}
	}
	if user, ok := raw["authenticatedUser"].(map[string]any); ok {
		if value, ok := user["providerDisplayName"].(string); ok {
			return value, nil
		}
	}
	return account.Username, nil
}

func ListHostPRs(repoPath string, account HostAccount, token string) ([]PullRequest, error) {
	provider := normalizeProvider(account.Provider)
	if provider == "github" && strings.TrimSpace(account.BaseURL) == "" {
		return ListGitHubPRs(repoPath, token)
	}
	p, err := remoteProjectFor(repoPath, provider)
	if err != nil {
		return nil, err
	}
	base := hostBase(provider, account.BaseURL)
	prs := []PullRequest{}
	switch provider {
	case "github":
		var raws []rawPR
		endpoint := fmt.Sprintf("%s/repos/%s/%s/pulls?state=open&per_page=50", base, p.Owner, p.Repo)
		if err := doHostJSON(account, http.MethodGet, endpoint, token, nil, &raws, http.StatusOK); err != nil {
			return nil, err
		}
		for _, item := range raws {
			prs = append(prs, item.toPR())
		}
	case "gitlab":
		var raws []struct {
			IID    int    `json:"iid"`
			Title  string `json:"title"`
			State  string `json:"state"`
			WebURL string `json:"web_url"`
			Source string `json:"source_branch"`
			Target string `json:"target_branch"`
			Author struct {
				Username string `json:"username"`
			} `json:"author"`
			Draft bool `json:"draft"`
		}
		endpoint := fmt.Sprintf("%s/api/v4/projects/%s/merge_requests?state=opened", base, url.PathEscape(p.Owner+"/"+p.Repo))
		if err := doHostJSON(account, http.MethodGet, endpoint, token, nil, &raws, http.StatusOK); err != nil {
			return nil, err
		}
		for _, item := range raws {
			prs = append(prs, PullRequest{Number: item.IID, Title: item.Title, State: item.State, Author: item.Author.Username, Head: item.Source, Base: item.Target, URL: item.WebURL, Draft: item.Draft})
		}
	case "bitbucket":
		var raw struct {
			Values []struct {
				ID                        int `json:"id"`
				Title, State, Description string
				Author                    struct {
					DisplayName string `json:"display_name"`
				} `json:"author"`
				Source, Destination struct {
					Branch struct {
						Name string `json:"name"`
					} `json:"branch"`
				}
				Links struct {
					HTML struct {
						Href string `json:"href"`
					} `json:"html"`
				} `json:"links"`
			} `json:"values"`
		}
		endpoint := fmt.Sprintf("%s/2.0/repositories/%s/%s/pullrequests?state=OPEN", base, p.Owner, p.Repo)
		if err := doHostJSON(account, http.MethodGet, endpoint, token, nil, &raw, http.StatusOK); err != nil {
			return nil, err
		}
		for _, item := range raw.Values {
			prs = append(prs, PullRequest{Number: item.ID, Title: item.Title, State: item.State, Author: item.Author.DisplayName, Head: item.Source.Branch.Name, Base: item.Destination.Branch.Name, URL: item.Links.HTML.Href})
		}
	case "azure":
		var raw struct {
			Value []struct {
				ID        int    `json:"pullRequestId"`
				Title     string `json:"title"`
				Status    string `json:"status"`
				CreatedBy struct {
					DisplayName string `json:"displayName"`
				} `json:"createdBy"`
				Source  string `json:"sourceRefName"`
				Target  string `json:"targetRefName"`
				URL     string `json:"url"`
				IsDraft bool   `json:"isDraft"`
			} `json:"value"`
		}
		endpoint := fmt.Sprintf("%s/%s/%s/_apis/git/repositories/%s/pullrequests?searchCriteria.status=active&api-version=7.1", base, p.Organization, p.Project, p.Repo)
		if err := doHostJSON(account, http.MethodGet, endpoint, token, nil, &raw, http.StatusOK); err != nil {
			return nil, err
		}
		for _, item := range raw.Value {
			webURL := remoteWebBase(originURL(repoPath)) + "/pullrequest/" + strconv.Itoa(item.ID)
			prs = append(prs, PullRequest{Number: item.ID, Title: item.Title, State: item.Status, Author: item.CreatedBy.DisplayName, Head: strings.TrimPrefix(item.Source, "refs/heads/"), Base: strings.TrimPrefix(item.Target, "refs/heads/"), URL: webURL, Draft: item.IsDraft})
		}
	default:
		return nil, fmt.Errorf("unsupported Git host provider: %s", account.Provider)
	}
	return prs, nil
}

func CreateHostPR(repoPath string, account HostAccount, token, title, head, baseBranch, body string) (PullRequest, error) {
	provider := normalizeProvider(account.Provider)
	if provider == "github" && strings.TrimSpace(account.BaseURL) == "" {
		return CreateGitHubPR(repoPath, token, title, head, baseBranch, body)
	}
	if strings.TrimSpace(title) == "" || strings.TrimSpace(head) == "" || strings.TrimSpace(baseBranch) == "" {
		return PullRequest{}, fmt.Errorf("title, source branch, and base branch are required")
	}
	p, err := remoteProjectFor(repoPath, provider)
	if err != nil {
		return PullRequest{}, err
	}
	baseURL := hostBase(provider, account.BaseURL)
	switch provider {
	case "github":
		var raw rawPR
		endpoint := fmt.Sprintf("%s/repos/%s/%s/pulls", baseURL, p.Owner, p.Repo)
		err = doHostJSON(account, http.MethodPost, endpoint, token, map[string]any{"title": title, "head": head, "base": baseBranch, "body": body}, &raw, http.StatusCreated)
		return raw.toPR(), err
	case "gitlab":
		var raw struct {
			IID    int    `json:"iid"`
			Title  string `json:"title"`
			State  string `json:"state"`
			WebURL string `json:"web_url"`
			Source string `json:"source_branch"`
			Target string `json:"target_branch"`
			Author struct {
				Username string `json:"username"`
			} `json:"author"`
			Draft bool `json:"draft"`
		}
		endpoint := fmt.Sprintf("%s/api/v4/projects/%s/merge_requests", baseURL, url.PathEscape(p.Owner+"/"+p.Repo))
		err = doHostJSON(account, http.MethodPost, endpoint, token, map[string]any{"title": title, "source_branch": head, "target_branch": baseBranch, "description": body}, &raw, http.StatusCreated)
		return PullRequest{Number: raw.IID, Title: raw.Title, State: raw.State, Author: raw.Author.Username, Head: raw.Source, Base: raw.Target, URL: raw.WebURL, Draft: raw.Draft}, err
	case "bitbucket":
		var raw struct {
			ID           int `json:"id"`
			Title, State string
			Author       struct {
				DisplayName string `json:"display_name"`
			} `json:"author"`
			Source, Destination struct {
				Branch struct {
					Name string `json:"name"`
				} `json:"branch"`
			}
			Links struct {
				HTML struct {
					Href string `json:"href"`
				} `json:"html"`
			} `json:"links"`
		}
		endpoint := fmt.Sprintf("%s/2.0/repositories/%s/%s/pullrequests", baseURL, p.Owner, p.Repo)
		payload := map[string]any{"title": title, "description": body, "source": map[string]any{"branch": map[string]string{"name": head}}, "destination": map[string]any{"branch": map[string]string{"name": baseBranch}}}
		err = doHostJSON(account, http.MethodPost, endpoint, token, payload, &raw, http.StatusCreated)
		return PullRequest{Number: raw.ID, Title: raw.Title, State: raw.State, Author: raw.Author.DisplayName, Head: raw.Source.Branch.Name, Base: raw.Destination.Branch.Name, URL: raw.Links.HTML.Href}, err
	case "azure":
		var raw struct {
			ID        int    `json:"pullRequestId"`
			Title     string `json:"title"`
			Status    string `json:"status"`
			Source    string `json:"sourceRefName"`
			Target    string `json:"targetRefName"`
			URL       string `json:"url"`
			CreatedBy struct {
				DisplayName string `json:"displayName"`
			} `json:"createdBy"`
			IsDraft bool `json:"isDraft"`
		}
		endpoint := fmt.Sprintf("%s/%s/%s/_apis/git/repositories/%s/pullrequests?api-version=7.1", baseURL, p.Organization, p.Project, p.Repo)
		payload := map[string]any{"title": title, "description": body, "sourceRefName": "refs/heads/" + head, "targetRefName": "refs/heads/" + baseBranch}
		err = doHostJSON(account, http.MethodPost, endpoint, token, payload, &raw, http.StatusCreated)
		webURL := remoteWebBase(originURL(repoPath)) + "/pullrequest/" + strconv.Itoa(raw.ID)
		return PullRequest{Number: raw.ID, Title: raw.Title, State: raw.Status, Author: raw.CreatedBy.DisplayName, Head: strings.TrimPrefix(raw.Source, "refs/heads/"), Base: strings.TrimPrefix(raw.Target, "refs/heads/"), URL: webURL, Draft: raw.IsDraft}, err
	default:
		return PullRequest{}, fmt.Errorf("unsupported Git host provider: %s", account.Provider)
	}
}

// PushWithHostAccount performs an authenticated HTTPS push without writing the
// token into .git/config or the remote URL. The temporary header is delivered
// through Git's process environment so it is not exposed in command arguments.
func PushWithHostAccount(repoPath, branch string, account HostAccount, token string) error {
	if _, err := os.Stat(filepath.Join(repoPath, ".git")); err != nil {
		return fmt.Errorf("not a git repository: %s", repoPath)
	}
	branch = strings.TrimSpace(branch)
	if branch == "" {
		return fmt.Errorf("branch is empty")
	}
	if strings.TrimSpace(token) == "" {
		return fmt.Errorf("token is empty")
	}
	provider := normalizeProvider(account.Provider)
	header := "Authorization: Bearer " + strings.TrimSpace(token)
	if provider == "azure" {
		header = "Authorization: Basic " + base64.StdEncoding.EncodeToString([]byte(":"+strings.TrimSpace(token)))
	} else if provider == "bitbucket" && strings.TrimSpace(account.Username) != "" {
		header = "Authorization: Basic " + base64.StdEncoding.EncodeToString([]byte(strings.TrimSpace(account.Username)+":"+strings.TrimSpace(token)))
	}
	ctx, cancel := context.WithTimeout(context.Background(), 2*time.Minute)
	defer cancel()
	cmd := exec.CommandContext(ctx, "git", "push", "origin", branch)
	configureHiddenCommand(cmd)
	cmd.Dir = repoPath
	cmd.Env = append(os.Environ(), "GIT_CONFIG_COUNT=1", "GIT_CONFIG_KEY_0=http.extraHeader", "GIT_CONFIG_VALUE_0="+header, "GIT_TERMINAL_PROMPT=0")
	var stdout, stderr bytes.Buffer
	cmd.Stdout = &stdout
	cmd.Stderr = &stderr
	if err := cmd.Run(); err != nil {
		if ctx.Err() != nil {
			return fmt.Errorf("push timed out")
		}
		return fmt.Errorf("git push: %s", firstNonEmpty(stderr.String(), stdout.String(), err.Error()))
	}
	return nil
}
