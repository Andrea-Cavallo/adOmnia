package codestudio

import (
	"testing"
	"time"
)

func TestRepositoryRootsCacheExpires(t *testing.T) {
	cache := &repositoryRootsCache{}
	if _, ok := cache.get("s"); ok {
		t.Fatal("empty cache should miss")
	}

	cache.set("s", []string{"/repo"})
	if roots, ok := cache.get("s"); !ok || len(roots) != 1 || roots[0] != "/repo" {
		t.Fatalf("fresh entry: roots=%v ok=%v", roots, ok)
	}

	// Age the entry past the TTL: a repository list is re-discovered, not kept forever.
	cache.mu.Lock()
	entry := cache.entries["s"]
	entry.storedAt = time.Now().Add(-repositoryRootsTTL - time.Second)
	cache.entries["s"] = entry
	cache.mu.Unlock()
	if _, ok := cache.get("s"); ok {
		t.Fatal("expired entry should miss")
	}
}

func TestRepositoryRootsCacheExpiresAnEmptyListSooner(t *testing.T) {
	cache := &repositoryRootsCache{}
	cache.set("s", []string{})

	// A project without a repository is re-checked quickly, so `git init` shows up.
	cache.mu.Lock()
	entry := cache.entries["s"]
	entry.storedAt = time.Now().Add(-missingRepositoryRootsTTL - time.Second)
	cache.entries["s"] = entry
	cache.mu.Unlock()
	if _, ok := cache.get("s"); ok {
		t.Fatal("a missing-repository answer should expire sooner")
	}
}

func TestRepositoryRootsCacheForget(t *testing.T) {
	cache := &repositoryRootsCache{}
	cache.set("s", []string{"/repo"})
	cache.forget("s")
	if _, ok := cache.get("s"); ok {
		t.Fatal("forget should drop the session")
	}
}
