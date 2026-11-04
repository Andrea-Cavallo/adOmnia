package flowintel

import (
	"os"
	"path/filepath"
	"testing"
)

func TestFlowCacheRoundTripAndInvalidation(t *testing.T) {
	root := flowWorkspace(t)
	dir := t.TempDir()
	discovery, err := Discover(root)
	if err != nil {
		t.Fatal(err)
	}
	if err := SaveCached(dir, discovery); err != nil {
		t.Fatal(err)
	}
	cached, ok := LoadCached(dir, root)
	if !ok || cached.Fingerprint != discovery.Fingerprint {
		t.Fatalf("cache not loaded: %+v", cached)
	}
	// A source change invalidates the cache (size/mtime are in the fingerprint).
	writeFlowFile(t, root, "src/com/acme/Extra.java", "package com.acme;\npublic class Extra {\n}\n")
	if _, ok := LoadCached(dir, root); ok {
		t.Fatal("the cache survived a source change")
	}
	// A cache from another root is not reused.
	if _, ok := LoadCached(dir, t.TempDir()); ok {
		t.Fatal("a cache for another workspace must not load")
	}
	if err := os.Remove(filepath.Join(dir, "missing")); err != nil {
		_ = err
	}
	if CachedFingerprint(dir, root) != discovery.Fingerprint {
		t.Fatal("the stored fingerprint changed")
	}
}
