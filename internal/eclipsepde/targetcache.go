package eclipsepde

import (
	"crypto/sha256"
	"encoding/hex"
	"fmt"
	"io/fs"
	"os"
	"path/filepath"
	"strings"
	"sync"
)

// maxCachedTargets bounds the process-wide index cache: a project uses one target,
// a few open projects use a few. The oldest entry goes first.
const maxCachedTargets = 8

// targetIndexCache keeps the bundle index of a target across BuildReport calls:
// reading a thousand jar manifests takes seconds, statting them takes milliseconds.
// An entry is reused only while the fingerprint of its files is unchanged.
var targetIndexCache = &indexCache{entries: map[string]cachedIndex{}}

type cachedIndex struct {
	fingerprint string
	index       *BundleIndex
}

type indexCache struct {
	mu      sync.Mutex
	entries map[string]cachedIndex
	order   []string
}

// cacheKeyOf identifies a target by what it is and where it is.
func cacheKeyOf(profile TargetProfile) string {
	path, err := filepath.Abs(profile.Path)
	if err != nil {
		path = profile.Path
	}
	return string(profile.Kind) + "\x00" + filepath.Clean(path)
}

// cachedProfileIndex returns the index of the profile, from the cache when its
// fingerprint still matches. The returned index is shared: callers must not modify it.
func cachedProfileIndex(profile TargetProfile) (*BundleIndex, error) {
	fingerprint, err := profileFingerprint(profile)
	if err != nil {
		return nil, err
	}
	key := cacheKeyOf(profile)
	if index, ok := targetIndexCache.get(key, fingerprint); ok {
		return index, nil
	}
	index, err := indexProfile(profile)
	if err != nil {
		return nil, err
	}
	targetIndexCache.put(key, cachedIndex{fingerprint: fingerprint, index: index})
	return index, nil
}

// InvalidateTargetIndex drops the cached index of the target at path (every
// kind); an empty path drops them all. The next report reads the manifests again.
func InvalidateTargetIndex(path string) {
	targetIndexCache.mu.Lock()
	defer targetIndexCache.mu.Unlock()
	clean := ""
	if path != "" {
		abs, err := filepath.Abs(path)
		if err != nil {
			abs = path
		}
		clean = "\x00" + filepath.Clean(abs)
	}
	kept := targetIndexCache.order[:0]
	for _, key := range targetIndexCache.order {
		if clean == "" || strings.HasSuffix(key, clean) {
			delete(targetIndexCache.entries, key)
			continue
		}
		kept = append(kept, key)
	}
	targetIndexCache.order = kept
}

func (c *indexCache) get(key, fingerprint string) (*BundleIndex, bool) {
	c.mu.Lock()
	defer c.mu.Unlock()
	entry, ok := c.entries[key]
	if !ok || entry.fingerprint != fingerprint {
		return nil, false
	}
	return entry.index, true
}

func (c *indexCache) put(key string, entry cachedIndex) {
	c.mu.Lock()
	defer c.mu.Unlock()
	if _, exists := c.entries[key]; !exists {
		c.order = append(c.order, key)
	}
	c.entries[key] = entry
	for len(c.order) > maxCachedTargets {
		delete(c.entries, c.order[0])
		c.order = c.order[1:]
	}
}

// profileFingerprint hashes the name, size and modification time of every file
// the index reads: the .target file, the jars and the exploded manifests of each
// directory, and the downloaded p2 bundles. It never opens a jar.
func profileFingerprint(profile TargetProfile) (string, error) {
	hash := sha256.New()
	if profile.Kind != TargetEclipseDefinition {
		if err := fingerprintDirectory(hash, profile.Path); err != nil {
			return "", err
		}
		return hex.EncodeToString(hash.Sum(nil)), nil
	}
	if err := fingerprintFile(hash, profile.Path); err != nil {
		return "", err
	}
	definition, err := ReadTargetDefinition(profile.Path)
	if err != nil {
		return "", err
	}
	for _, directory := range definitionDirectories(profile.Path, definition) {
		// A missing location is a warning of the index, and part of the fingerprint.
		if err := fingerprintDirectory(hash, directory); err != nil {
			fmt.Fprintf(hash, "missing %s\n", directory)
		}
	}
	for _, jar := range downloadedP2Bundles(profile.Path) {
		if err := fingerprintFile(hash, jar); err != nil {
			fmt.Fprintf(hash, "missing %s\n", jar)
		}
	}
	return hex.EncodeToString(hash.Sum(nil)), nil
}

type hashWriter interface{ Write([]byte) (int, error) }

func fingerprintFile(hash hashWriter, path string) error {
	info, err := os.Stat(path)
	if err != nil {
		return err
	}
	_, err = fmt.Fprintf(hash, "%s %d %d\n", path, info.Size(), info.ModTime().UnixNano())
	return err
}

func fingerprintDirectory(hash hashWriter, root string) error {
	if _, err := os.Stat(root); err != nil {
		return err
	}
	return filepath.WalkDir(root, func(path string, entry fs.DirEntry, err error) error {
		if err != nil {
			fmt.Fprintf(hash, "unreadable %s\n", path)
			return nil
		}
		if entry.IsDir() || !indexedFile(path, entry.Name()) {
			return nil
		}
		info, err := entry.Info()
		if err != nil {
			fmt.Fprintf(hash, "unreadable %s\n", path)
			return nil
		}
		_, err = fmt.Fprintf(hash, "%s %d %d\n", path, info.Size(), info.ModTime().UnixNano())
		return err
	})
}

// indexedFile reports the files the index reads: jars and exploded manifests.
func indexedFile(path, name string) bool {
	return strings.EqualFold(filepath.Ext(path), ".jar") || strings.EqualFold(name, "MANIFEST.MF")
}
