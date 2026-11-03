// Package update keeps adOmnia current from GitHub Releases.
//
// Manager checks, downloads and verifies a signed release, and the helper in
// apply.go swaps it in with a startup rollback. DetectInstall decides whether this
// copy may update itself. Check below is the older notify-only query.
package update

import (
	"context"
	"encoding/json/v2"
	"errors"
	"fmt"
	"io"
	"net/http"
	"strings"
	"time"

	"golang.org/x/mod/semver"

	"github.com/Andrea-Cavallo/adOmnia/internal/netpolicy"
)

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

// Check finds the newest stable release and compares it with current. It reads
// the release list, not /releases/latest: GitHub's "Latest" is the most recently
// published release, so a mistyped tag published later (v0.1.24 after v1.0.24)
// would hide every real update. Errors are frontend-safe.
func Check(current string) (UpdateInfo, error) {
	info := UpdateInfo{CurrentVersion: current}
	if current == "dev" || current == "" {
		info.IsDev = true
		return info, nil
	}

	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, repositoryAPI, nil)
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

	var releases []release
	raw, _ := io.ReadAll(io.LimitReader(resp.Body, maxReleaseListBytes))
	if err := json.Unmarshal(raw, &releases); err != nil {
		return info, fmt.Errorf("could not parse release info")
	}
	newest := newestStableRelease(releases)
	if newest == nil {
		return info, fmt.Errorf("no published release found")
	}
	info.LatestVersion = newest.Tag
	info.ReleaseURL = newest.URL
	info.ReleaseNotes = newest.Notes
	info.PublishedAt = newest.PublishedAt
	info.UpdateAvailable = CompareSemver(newest.Tag, current) > 0
	return info, nil
}

// maxReleaseListBytes bounds the release list read from GitHub (100 releases with notes).
const maxReleaseListBytes = 4 << 20

// newestStableRelease is the published, non-prerelease release with the highest
// semantic version; publication order does not matter.
func newestStableRelease(releases []release) *release {
	var newest *release
	for i := range releases {
		candidate := &releases[i]
		version := normalizeVersion(candidate.Tag)
		if candidate.Draft || candidate.Prerelease || !semver.IsValid(version) || semver.Prerelease(version) != "" {
			continue
		}
		if newest == nil || CompareSemver(candidate.Tag, newest.Tag) > 0 {
			newest = candidate
		}
	}
	return newest
}

// CompareSemver includes prerelease ordering (beta.2 < beta.10 < stable).
func CompareSemver(a, b string) int {
	a, b = normalizeVersion(a), normalizeVersion(b)
	if !semver.IsValid(a) || !semver.IsValid(b) {
		return 0
	}
	return semver.Compare(a, b)
}
func normalizeVersion(v string) string { return "v" + strings.TrimPrefix(strings.TrimSpace(v), "v") }
