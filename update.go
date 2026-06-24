package main

import (
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"strconv"
	"strings"
	"time"
)

// Update check: notify-only. Queries the GitHub Releases API for the latest
// release and compares it with the embedded build version. No download, no
// self-replace — the frontend shows a banner and opens the release page so the
// user installs manually. Local-first: this is the only release-related network
// call, it runs on user action or one opt-in startup check.
// ponytail: notify + open page. Assisted download / auto-replace is the upgrade
// path if users ask, but a portable cross-platform self-updater is days of work
// and risks breaking the install.

// Version is declared in main.go and injected at build time via
// -ldflags "-X main.Version=v0.4.2" (already wired in build.ps1 / build.sh).
// It defaults to "dev" for `wails dev`, where update checks are skipped.

const releasesAPI = "https://api.github.com/repos/Andrea-Cavallo/adOmnia/releases/latest"

// UpdateInfo is the trimmed shape the UI needs.
type UpdateInfo struct {
	CurrentVersion string `json:"currentVersion"`
	LatestVersion  string `json:"latestVersion"`
	UpdateAvailable bool  `json:"updateAvailable"`
	ReleaseURL     string `json:"releaseUrl"`
	ReleaseNotes   string `json:"releaseNotes"`
	PublishedAt    string `json:"publishedAt"`
	IsDev          bool   `json:"isDev"` // running unversioned dev build; check skipped
}

// GetAppVersion returns the embedded build version (or "dev").
func (a *App) GetAppVersion() string {
	return Version
}

// CheckForUpdate queries the latest GitHub release and reports whether a newer
// version exists. Returns a clean, frontend-safe error on failure.
func (a *App) CheckForUpdate() (UpdateInfo, error) {
	info := UpdateInfo{CurrentVersion: Version}

	if Version == "dev" || Version == "" {
		info.IsDev = true
		return info, nil
	}

	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()

	req, err := http.NewRequestWithContext(ctx, http.MethodGet, releasesAPI, nil)
	if err != nil {
		return info, fmt.Errorf("could not build update request")
	}
	req.Header.Set("Accept", "application/vnd.github+json")
	req.Header.Set("X-GitHub-Api-Version", "2022-11-28")

	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		return info, fmt.Errorf("could not reach GitHub to check for updates")
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		return info, fmt.Errorf("update check failed (%d)", resp.StatusCode)
	}

	var release struct {
		TagName     string `json:"tag_name"`
		HTMLURL     string `json:"html_url"`
		Body        string `json:"body"`
		PublishedAt string `json:"published_at"`
		Draft       bool   `json:"draft"`
		Prerelease  bool   `json:"prerelease"`
	}
	raw, _ := io.ReadAll(io.LimitReader(resp.Body, 1<<20))
	if err := json.Unmarshal(raw, &release); err != nil {
		return info, fmt.Errorf("could not parse release info")
	}

	info.LatestVersion = release.TagName
	info.ReleaseURL = release.HTMLURL
	info.ReleaseNotes = release.Body
	info.PublishedAt = release.PublishedAt
	info.UpdateAvailable = compareSemver(release.TagName, Version) > 0

	return info, nil
}

// compareSemver compares two "vMAJOR.MINOR.PATCH" strings (the "v" and any
// pre-release suffix are ignored). Returns 1 if a>b, -1 if a<b, 0 if equal.
func compareSemver(a, b string) int {
	pa, pb := parseSemver(a), parseSemver(b)
	for i := 0; i < 3; i++ {
		if pa[i] > pb[i] {
			return 1
		}
		if pa[i] < pb[i] {
			return -1
		}
	}
	return 0
}

func parseSemver(v string) [3]int {
	v = strings.TrimSpace(strings.TrimPrefix(strings.TrimSpace(v), "v"))
	// drop pre-release / build metadata: 1.2.3-rc1+build -> 1.2.3
	if i := strings.IndexAny(v, "-+"); i >= 0 {
		v = v[:i]
	}
	var out [3]int
	for i, part := range strings.SplitN(v, ".", 3) {
		if i > 2 {
			break
		}
		out[i], _ = strconv.Atoi(strings.TrimSpace(part))
	}
	return out
}
