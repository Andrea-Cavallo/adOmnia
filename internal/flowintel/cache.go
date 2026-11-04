package flowintel

import (
	"crypto/sha256"
	"encoding/hex"
	"encoding/json/v2"
	"fmt"
	"os"
	"path/filepath"
	"strings"

	"github.com/Andrea-Cavallo/adOmnia/internal/ide/graph"
)

// Persistent cache: a discovered flow graph is valid while the fingerprint of the Java/XML
// sources (and .adomnia/flows.json) does not change. The file lives in the adOmnia data folder,
// never in the project.

const flowCacheVersion = 1

type flowCache struct {
	Version   int        `json:"version"`
	Discovery *Discovery `json:"discovery"`
}

func flowCachePath(dir, root string) string {
	sum := sha256.Sum256([]byte(filepath.Clean(root)))
	return filepath.Join(dir, "flow-intel-"+hex.EncodeToString(sum[:12])+".json")
}

// LoadCached returns the saved discovery when it matches the current sources.
func LoadCached(dir, root string) (*Discovery, bool) {
	if dir == "" {
		return nil, false
	}
	data, err := os.ReadFile(flowCachePath(dir, root))
	if err != nil {
		return nil, false
	}
	var cached flowCache
	if json.Unmarshal(data, &cached) != nil || cached.Version != flowCacheVersion || cached.Discovery == nil {
		return nil, false
	}
	if cached.Discovery.Root != filepath.Clean(root) || cached.Discovery.Fingerprint == "" {
		return nil, false
	}
	fingerprint, err := graph.Fingerprint(root, flowRelevantFile)
	if err != nil || fingerprint != cached.Discovery.Fingerprint {
		return nil, false
	}
	return cached.Discovery, true
}

// SaveCached writes the discovery atomically; a failed save only costs a future rebuild.
func SaveCached(dir string, discovery *Discovery) error {
	if dir == "" || discovery == nil || discovery.Fingerprint == "" {
		return fmt.Errorf("nothing to cache")
	}
	if err := os.MkdirAll(dir, 0o700); err != nil {
		return err
	}
	data, err := json.Marshal(flowCache{Version: flowCacheVersion, Discovery: discovery})
	if err != nil {
		return err
	}
	target := flowCachePath(dir, discovery.Root)
	temporary := target + ".tmp"
	if err := os.WriteFile(temporary, data, 0o600); err != nil {
		return err
	}
	return os.Rename(temporary, target)
}

// CachedFingerprint is the stored fingerprint, for diagnostics and tests.
func CachedFingerprint(dir, root string) string {
	data, err := os.ReadFile(flowCachePath(dir, root))
	if err != nil {
		return ""
	}
	var cached flowCache
	if json.Unmarshal(data, &cached) != nil || cached.Discovery == nil {
		return ""
	}
	return strings.TrimSpace(cached.Discovery.Fingerprint)
}
