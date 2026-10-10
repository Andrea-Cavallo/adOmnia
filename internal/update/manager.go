package update

import (
	"adomnia/internal/netpolicy"
	"archive/zip"
	"context"
	"crypto/ed25519"
	"crypto/sha256"
	"encoding/base64"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"golang.org/x/mod/semver"
	"io"
	"net/http"
	"net/url"
	"os"
	"path/filepath"
	"runtime"
	"strings"
	"sync"
	"time"
)

// PublicKey is a pinned Ed25519 public key, injected at build time. An unsigned
// build can check versions, but must never download or apply an update.
var PublicKey = defaultPublicKey

const repositoryAPI = "https://api.github.com/repos/Andrea-Cavallo/adOmnia/releases?per_page=100"
const maxPackageSize int64 = 512 << 20

type Asset struct {
	Name   string `json:"name"`
	URL    string `json:"url"`
	SHA256 string `json:"sha256"`
	Size   int64  `json:"size"`
	OS     string `json:"os"`
	Arch   string `json:"arch"`
}
type Manifest struct {
	Version string  `json:"version"`
	Assets  []Asset `json:"assets"`
}
type Envelope struct {
	Payload   string `json:"payload"`
	Signature string `json:"signature"`
}
type releaseAsset struct {
	Name string `json:"name"`
	URL  string `json:"browser_download_url"`
}
type release struct {
	Tag        string         `json:"tag_name"`
	URL        string         `json:"html_url"`
	Notes      string         `json:"body"`
	Draft      bool           `json:"draft"`
	Prerelease bool           `json:"prerelease"`
	Assets     []releaseAsset `json:"assets"`
}
type State struct {
	Phase      string `json:"phase"`
	Version    string `json:"version"`
	Channel    string `json:"channel"`
	ReleaseURL string `json:"releaseUrl"`
	Notes      string `json:"notes"`
	Received   int64  `json:"received"`
	Total      int64  `json:"total"`
	Error      string `json:"error"`
	Trusted    bool   `json:"trusted"`
	Scheduled  bool   `json:"scheduled"`
}
type cachedReleases struct {
	ETag      string    `json:"etag"`
	CheckedAt time.Time `json:"checkedAt"`
	Releases  []release `json:"releases"`
}
type Manager struct {
	client        func(time.Duration) *http.Client
	mu            sync.Mutex
	dir, current  string
	state         State
	selected      release
	cache         cachedReleases
	cancel        context.CancelFunc
	busy          bool
	prepared      string
	asset         Asset
	failedVersion string
}

func NewManager(dir, current string) *Manager {
	cleanupCache(dir)
	m := &Manager{client: updateClient, dir: dir, current: current, state: State{Phase: "idle", Channel: "stable", Trusted: trustedKey()}}
	raw, err := os.ReadFile(filepath.Join(dir, "releases-cache.json"))
	if err == nil {
		_ = json.Unmarshal(raw, &m.cache)
	}
	if raw, err := os.ReadFile(filepath.Join(dir, "failed-update.json")); err == nil {
		var failed struct {
			Version string `json:"version"`
		}
		if json.Unmarshal(raw, &failed) == nil {
			m.failedVersion = failed.Version
		}
	}
	return m
}
func trustedKey() bool {
	k, e := base64.StdEncoding.DecodeString(PublicKey)
	return e == nil && len(k) == ed25519.PublicKeySize
}
func (m *Manager) Status() State { m.mu.Lock(); defer m.mu.Unlock(); return m.state }
func (m *Manager) Check(channel string, force bool) (State, error) {
	if channel != "stable" && channel != "beta" {
		return m.Status(), errors.New("invalid update channel")
	}
	m.mu.Lock()
	if m.busy || m.state.Scheduled {
		s := m.state
		m.mu.Unlock()
		return s, nil
	}
	if !semver.IsValid(normalizeVersion(m.current)) {
		m.state.Phase = "dev"
		s := m.state
		m.mu.Unlock()
		return s, nil
	}
	m.busy = true
	m.state.Phase = "checking"
	m.state.Channel = channel
	m.state.Error = ""
	m.mu.Unlock()
	defer func() { m.mu.Lock(); m.busy = false; m.mu.Unlock() }()
	releases, err := m.fetch(force)
	if err != nil {
		return m.fail("Could not check for updates", err)
	}
	chosen := chooseRelease(releases, m.current, channel)
	m.mu.Lock()
	defer m.mu.Unlock()
	if chosen == nil {
		m.state = State{Phase: "current", Channel: channel, Trusted: trustedKey()}
		m.selected = release{}
	} else {
		// Do not discard a verified download when checking the same version again.
		if m.selected.Tag != chosen.Tag {
			m.prepared = ""
			m.state = State{Trusted: trustedKey()}
		}
		m.selected = *chosen
		m.state.Version = chosen.Tag
		m.state.Channel = channel
		m.state.ReleaseURL = chosen.URL
		m.state.Notes = chosen.Notes
		if m.failedVersion == chosen.Tag && !force {
			m.state.Error = "Previous update failed; automatic download paused. Check now to retry manually."
		}
		if m.prepared != "" {
			m.state.Phase = "ready"
		} else {
			m.state.Phase = "available"
		}
	}
	return m.state, nil
}
func chooseRelease(releases []release, current, channel string) *release {
	var chosen *release
	for _, r := range releases {
		v := normalizeVersion(r.Tag)
		if r.Draft || !semver.IsValid(v) || CompareSemver(r.Tag, current) <= 0 {
			continue
		}
		if channel == "stable" && (r.Prerelease || semver.Prerelease(v) != "") {
			continue
		}
		complete := false
		for _, a := range r.Assets {
			if a.Name == "update-manifest.json" {
				complete = true
			}
		}
		// A release is only installable once its signed manifest has been published.
		if !complete {
			continue
		}
		if chosen == nil || CompareSemver(r.Tag, chosen.Tag) > 0 {
			copy := r
			chosen = &copy
		}
	}
	return chosen
}
func (m *Manager) fetch(force bool) ([]release, error) {
	if err := netpolicy.Allow("update", "api.github.com"); err != nil {
		return nil, err
	}
	if !force && !m.cache.CheckedAt.IsZero() && time.Since(m.cache.CheckedAt) >= 0 && time.Since(m.cache.CheckedAt) < 6*time.Hour {
		return m.cache.Releases, nil
	}
	ctx, cancel := context.WithTimeout(context.Background(), 15*time.Second)
	defer cancel()
	req, _ := http.NewRequestWithContext(ctx, "GET", repositoryAPI, nil)
	req.Header.Set("Accept", "application/vnd.github+json")
	req.Header.Set("X-GitHub-Api-Version", "2022-11-28")
	if m.cache.ETag != "" {
		req.Header.Set("If-None-Match", m.cache.ETag)
	}
	resp, err := m.client(15 * time.Second).Do(req)
	if err != nil {
		return nil, err
	}
	defer resp.Body.Close()
	if resp.StatusCode == http.StatusNotModified {
		m.cache.CheckedAt = time.Now()
		m.persistCache()
		return m.cache.Releases, nil
	}
	if resp.StatusCode != http.StatusOK {
		return nil, fmt.Errorf("release endpoint: %d", resp.StatusCode)
	}
	raw, err := io.ReadAll(io.LimitReader(resp.Body, 4<<20))
	if err != nil {
		return nil, err
	}
	var list []release
	if err = json.Unmarshal(raw, &list); err != nil {
		return nil, err
	}
	m.cache = cachedReleases{ETag: resp.Header.Get("ETag"), CheckedAt: time.Now(), Releases: list}
	m.persistCache()
	return list, nil
}
func (m *Manager) persistCache() {
	if os.MkdirAll(m.dir, 0700) == nil {
		raw, _ := json.Marshal(m.cache)
		_ = os.WriteFile(filepath.Join(m.dir, "releases-cache.json"), raw, 0600)
	}
}
func (m *Manager) fail(message string, err error) (State, error) {
	m.mu.Lock()
	defer m.mu.Unlock()
	m.state.Phase = "error"
	m.state.Error = message
	if errors.Is(err, netpolicy.ErrOffline) {
		m.state.Error = "Offline mode: updates paused"
	}
	return m.state, errors.New(m.state.Error)
}
func VerifyEnvelope(raw []byte, public string) (Manifest, error) {
	var out Manifest
	var e Envelope
	if json.Unmarshal(raw, &e) != nil {
		return out, errors.New("invalid signed manifest")
	}
	payload, pe := base64.StdEncoding.DecodeString(e.Payload)
	sig, se := base64.StdEncoding.DecodeString(e.Signature)
	key, ke := base64.StdEncoding.DecodeString(public)
	if pe != nil || se != nil || ke != nil || len(key) != ed25519.PublicKeySize || !ed25519.Verify(key, payload, sig) {
		return out, errors.New("update signature rejected")
	}
	if json.Unmarshal(payload, &out) != nil || !semver.IsValid(normalizeVersion(out.Version)) {
		return out, errors.New("invalid manifest payload")
	}
	return out, nil
}
func allowedURL(raw string) bool {
	u, e := url.Parse(raw)
	return e == nil && u.Scheme == "https" && u.User == nil && u.Host == "github.com" && strings.HasPrefix(u.Path, "/Andrea-Cavallo/adOmnia/releases/download/")
}
func (m *Manager) Download() (State, error) {
	m.mu.Lock()
	if m.busy || m.state.Scheduled {
		s := m.state
		m.mu.Unlock()
		return s, errors.New("update is busy")
	}
	if m.prepared != "" {
		s := m.state
		m.mu.Unlock()
		return s, nil
	}
	if m.selected.Tag == "" || !trustedKey() {
		m.mu.Unlock()
		return m.Status(), errors.New("No signed update is available for this build")
	}
	m.busy = true
	ctx, cancel := context.WithCancel(context.Background())
	m.cancel = cancel
	m.state.Phase = "downloading"
	m.state.Received = 0
	m.state.Error = ""
	selected := m.selected
	m.mu.Unlock()
	go func() {
		defer func() { cancel(); m.mu.Lock(); m.busy = false; m.cancel = nil; m.mu.Unlock() }()
		if err := m.download(ctx, selected); err != nil {
			if errors.Is(err, context.Canceled) {
				m.mu.Lock()
				m.state.Phase = "available"
				m.mu.Unlock()
			} else {
				_, _ = m.fail(err.Error(), err)
			}
		}
	}()
	return m.Status(), nil
}
func (m *Manager) Cancel() {
	m.mu.Lock()
	defer m.mu.Unlock()
	if m.cancel != nil {
		m.cancel()
	}
}
func (m *Manager) fetchBody(ctx context.Context, raw string, limit int64) ([]byte, error) {
	if !allowedURL(raw) {
		return nil, errors.New("untrusted update URL")
	}
	req, _ := http.NewRequestWithContext(ctx, "GET", raw, nil)
	resp, e := m.client(30 * time.Second).Do(req)
	if e != nil {
		return nil, e
	}
	defer resp.Body.Close()
	if resp.StatusCode != 200 {
		return nil, fmt.Errorf("update endpoint: %d", resp.StatusCode)
	}
	b, e := io.ReadAll(io.LimitReader(resp.Body, limit+1))
	if int64(len(b)) > limit {
		return nil, errors.New("update metadata too large")
	}
	return b, e
}
func (m *Manager) download(ctx context.Context, r release) error {
	manifestURL := ""
	for _, a := range r.Assets {
		if a.Name == "update-manifest.json" {
			manifestURL = a.URL
		}
	}
	raw, err := m.fetchBody(ctx, manifestURL, 1<<20)
	if err != nil {
		return err
	}
	manifest, err := VerifyEnvelope(raw, PublicKey)
	if err != nil {
		return err
	}
	if normalizeVersion(manifest.Version) != normalizeVersion(r.Tag) {
		return errors.New("update version mismatch")
	}
	var asset Asset
	for _, a := range manifest.Assets {
		if a.OS == runtime.GOOS && (a.Arch == runtime.GOARCH || runtime.GOOS == "darwin" && a.Arch == "universal") {
			asset = a
			break
		}
	}
	hashBytes, err := hex.DecodeString(asset.SHA256)
	if err != nil || len(hashBytes) != 32 || asset.Size <= 0 || asset.Size > maxPackageSize || !allowedURL(asset.URL) {
		return errors.New("No valid update package for this platform")
	}
	if err = os.MkdirAll(m.dir, 0700); err != nil {
		return err
	}
	f, err := os.CreateTemp(m.dir, "download-*.zip")
	if err != nil {
		return err
	}
	name := f.Name()
	defer func() { f.Close(); os.Remove(name) }()
	req, _ := http.NewRequestWithContext(ctx, "GET", asset.URL, nil)
	resp, err := m.client(20 * time.Minute).Do(req)
	if err != nil {
		return err
	}
	defer resp.Body.Close()
	if resp.StatusCode != 200 {
		return fmt.Errorf("download failed: %d", resp.StatusCode)
	}
	m.mu.Lock()
	m.state.Total = asset.Size
	m.mu.Unlock()
	h := sha256.New()
	writer := io.MultiWriter(f, h)
	buffer := make([]byte, 256<<10)
	var received int64
	reader := io.LimitReader(resp.Body, asset.Size+1)
	for {
		n, e := reader.Read(buffer)
		if n > 0 {
			if _, err = writer.Write(buffer[:n]); err != nil {
				return err
			}
			received += int64(n)
			m.mu.Lock()
			m.state.Received = received
			m.mu.Unlock()
		}
		if e == io.EOF {
			break
		}
		if e != nil {
			return e
		}
	}
	if received != asset.Size || hex.EncodeToString(h.Sum(nil)) != strings.ToLower(asset.SHA256) {
		return errors.New("Update package checksum rejected")
	}
	if err = f.Close(); err != nil {
		return err
	}
	m.mu.Lock()
	m.state.Phase = "verifying"
	m.mu.Unlock()
	stage, err := os.MkdirTemp(m.dir, "verified-*")
	if err != nil {
		return err
	}
	if err = extractPackage(name, stage); err != nil {
		os.RemoveAll(stage)
		return err
	}
	if err = ctx.Err(); err != nil {
		os.RemoveAll(stage)
		return err
	}
	if err = os.Rename(name, stage+".zip"); err != nil {
		os.RemoveAll(stage)
		return err
	}
	if err = os.WriteFile(stage+".json", raw, 0600); err != nil {
		os.Remove(stage + ".zip")
		os.RemoveAll(stage)
		return err
	}
	m.mu.Lock()
	m.prepared = stage
	m.asset = asset
	m.state.Phase = "ready"
	m.mu.Unlock()
	return nil
}

// Extract only regular files/directories, within a bounded private staging root.
// Update ZIPs never contain symlinks, devices or paths outside the package.
func extractPackage(name, root string) error {
	z, err := zip.OpenReader(name)
	if err != nil {
		return err
	}
	defer z.Close()
	var total uint64
	if len(z.File) > 20000 {
		return errors.New("update archive has too many entries")
	}
	for _, f := range z.File {
		total += f.UncompressedSize64
		if total > 1<<30 {
			return errors.New("update archive is too large")
		}
		rel := filepath.FromSlash(f.Name)
		if strings.HasPrefix(f.Name, "/") || strings.Contains(f.Name, "\\") || strings.Contains(f.Name, ":") || filepath.IsAbs(rel) || rel == ".." || strings.HasPrefix(rel, ".."+string(os.PathSeparator)) {
			return errors.New("unsafe update archive path")
		}
		target := filepath.Join(root, rel)
		resolved, _ := filepath.Rel(root, target)
		if resolved == ".." || strings.HasPrefix(resolved, ".."+string(os.PathSeparator)) {
			return errors.New("unsafe update archive path")
		}
		if f.Mode()&os.ModeSymlink != 0 || (!f.Mode().IsRegular() && !f.FileInfo().IsDir()) {
			return errors.New("unsupported update archive entry")
		}
		if f.FileInfo().IsDir() {
			if err = os.MkdirAll(target, 0700); err != nil {
				return err
			}
			continue
		}
		if err = os.MkdirAll(filepath.Dir(target), 0700); err != nil {
			return err
		}
		in, e := f.Open()
		if e != nil {
			return e
		}
		out, e := os.OpenFile(target, os.O_CREATE|os.O_EXCL|os.O_WRONLY, 0600|f.Mode().Perm()&0111)
		if e != nil {
			in.Close()
			return e
		}
		n, e := io.Copy(out, io.LimitReader(in, int64(f.UncompressedSize64)+1))
		in.Close()
		closeErr := out.Close()
		if e != nil {
			return e
		}
		if closeErr != nil {
			return closeErr
		}
		if uint64(n) != f.UncompressedSize64 {
			return errors.New("invalid archive entry size")
		}
	}
	return nil
}

func updateClient(timeout time.Duration) *http.Client {
	c := netpolicy.Client("update", timeout)
	c.CheckRedirect = func(req *http.Request, via []*http.Request) error {
		if len(via) >= 5 {
			return errors.New("too many update redirects")
		}
		host := req.URL.Hostname()
		if req.URL.Scheme != "https" || req.URL.User != nil || (host != "github.com" && host != "api.github.com" && host != "release-assets.githubusercontent.com" && host != "objects.githubusercontent.com") {
			return errors.New("untrusted update redirect")
		}
		return nil
	}
	return c
}

// Only expired updater-owned cache entries are removed. Helpers wait at most a
// day, so seven-day-old private staging paths cannot belong to an active apply.
func cleanupCache(dir string) {
	entries, err := os.ReadDir(dir)
	if err != nil {
		return
	}
	for _, entry := range entries {
		if !strings.HasPrefix(entry.Name(), "verified-") && !strings.HasPrefix(entry.Name(), "download-") {
			continue
		}
		info, err := entry.Info()
		if err != nil || time.Since(info.ModTime()) < 7*24*time.Hour {
			continue
		}
		_ = os.RemoveAll(filepath.Join(dir, entry.Name()))
	}
}
