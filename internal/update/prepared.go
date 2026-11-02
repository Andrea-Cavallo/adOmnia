package update

import (
	"context"
	"os"
	"path/filepath"
	"strings"
)

const preparedDownloadFile = "ready-download.txt"

func (m *Manager) rememberPrepared(stage string) {
	path := filepath.Join(m.dir, preparedDownloadFile)
	if err := os.WriteFile(path+".tmp", []byte(filepath.Base(stage)), 0600); err == nil {
		_ = os.Rename(path+".tmp", path)
	}
}

// Reuse only a complete, signed package for the selected release. The helper
// rechecks the archive and extracts it afresh before replacing the application.
func (m *Manager) reusePrepared(ctx context.Context, r release) bool {
	rawName, err := os.ReadFile(filepath.Join(m.dir, preparedDownloadFile))
	if err != nil {
		return false
	}
	name := string(rawName)
	if filepath.Base(name) != name || !strings.HasPrefix(name, "verified-") || strings.ContainsAny(name, `/\`) {
		return false
	}
	stage := filepath.Join(m.dir, name)
	info, err := os.Lstat(stage)
	if err != nil || !info.IsDir() || info.Mode()&os.ModeSymlink != 0 {
		return false
	}
	raw, err := os.ReadFile(stage + ".json")
	if err != nil {
		return false
	}
	manifest, err := VerifyEnvelope(raw, PublicKey)
	if err != nil || normalizeVersion(manifest.Version) != normalizeVersion(r.Tag) || CompareSemver(r.Tag, m.current) <= 0 {
		return false
	}
	asset, err := platformAsset(manifest)
	if err != nil || asset.Size > maxPackageSize || !allowedURL(asset.URL) {
		return false
	}
	if err := verifyArchive(stage+".zip", asset); err != nil || ctx.Err() != nil {
		return false
	}
	m.mu.Lock()
	m.prepared, m.asset = stage, asset
	m.state.Phase = "verifying"
	m.state.Received, m.state.Total = asset.Size, asset.Size
	m.mu.Unlock()
	return true
}
