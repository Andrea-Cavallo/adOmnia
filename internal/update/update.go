// Package update checks GitHub Releases for a newer adOmnia version.
//
// Notify-only: queried on an explicit user action from Settings > About, never
// at startup; no download or self-replace.
// ponytail: notify + open page. Assisted download / auto-replace is the upgrade
// path if users ask, but a portable cross-platform self-updater is days of work
// and risks breaking the install.
package update

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"strconv"
	"strings"
	"time"

	"adomnia/internal/netpolicy"
)

const releasesAPI = "https://api.github.com/repos/Andrea-Cavallo/adOmnia/releases/latest"

// UpdateInfo is the trimmed shape the UI needs.
type UpdateInfo struct {
	CurrentVersion  string `json:"currentVersion"`
	LatestVersion   string `json:"latestVersion"`
	UpdateAvailable bool   `json:"updateAvailable"`
	ReleaseURL      string `json:"releaseUrl"`
	ReleaseNotes    string `json:"releaseNotes"`
	PublishedAt     string `json:"publishedAt"`
	IsDev           bool   `json:"isDev"` // running unversioned dev build; check skipped
}

// Check queries the latest GitHub release and compares it with current.
// Errors are frontend-safe.
func Check(current string) (UpdateInfo, error) {
	info := UpdateInfo{CurrentVersion: current}
	if current == "dev" || current == "" {
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

	resp, err := netpolicy.Client("update", 10*time.Second).Do(req)
	if errors.Is(err, netpolicy.ErrOffline) {
		return info, err
	}
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
	}
	raw, _ := io.ReadAll(io.LimitReader(resp.Body, 1<<20))
	if err := json.Unmarshal(raw, &release); err != nil {
		return info, fmt.Errorf("could not parse release info")
	}
	info.LatestVersion = release.TagName
	info.ReleaseURL = release.HTMLURL
	info.ReleaseNotes = release.Body
	info.PublishedAt = release.PublishedAt
	info.UpdateAvailable = CompareSemver(release.TagName, current) > 0
	return info, nil
}

// CompareSemver compares two "vMAJOR.MINOR.PATCH" strings (the "v" and any
// pre-release suffix are ignored). Returns 1 if a>b, -1 if a<b, 0 if equal.
func CompareSemver(a, b string) int {
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
		out[i], _ = strconv.Atoi(strings.TrimSpace(part))
	}
	return out
}
