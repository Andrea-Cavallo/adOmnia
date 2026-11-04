package codestudio

import (
	"errors"
	"strconv"
	"sync"
	"sync/atomic"
	"testing"
)

// analysisProbe counts fingerprints and builds of one cached analysis.
type analysisProbe struct {
	fingerprints atomic.Int64
	builds       atomic.Int64
}

func (p *analysisProbe) request(sessionID string, generation uint64, watchedFully bool, fingerprint string) analysisRequest[string] {
	return analysisRequest[string]{
		sessionID:    sessionID,
		generation:   generation,
		watchedFully: watchedFully,
		fingerprint: func() (string, error) {
			p.fingerprints.Add(1)
			return fingerprint, nil
		},
		build: func() (string, error) {
			return strconv.FormatInt(p.builds.Add(1), 10), nil
		},
	}
}

func TestAnalysisCacheServesTheGenerationWithoutFingerprinting(t *testing.T) {
	cache := &analysisCache[string]{}
	probe := &analysisProbe{}

	first, err := cache.load(probe.request("s", 0, true, "f1"))
	if err != nil || first != "1" {
		t.Fatalf("first load = %q err=%v, want 1", first, err)
	}
	if probe.fingerprints.Load() != 1 || probe.builds.Load() != 1 {
		t.Fatalf("after first load: fingerprints=%d builds=%d, want 1/1", probe.fingerprints.Load(), probe.builds.Load())
	}

	// Same generation and a complete watcher: neither the tree walk nor the build run again.
	second, err := cache.load(probe.request("s", 0, true, "f1"))
	if err != nil || second != "1" {
		t.Fatalf("second load = %q err=%v, want the cached 1", second, err)
	}
	if probe.fingerprints.Load() != 1 || probe.builds.Load() != 1 {
		t.Fatalf("cache hit walked or rebuilt: fingerprints=%d builds=%d", probe.fingerprints.Load(), probe.builds.Load())
	}
}

func TestAnalysisCacheVerifyKeepsValueWhenFingerprintMatches(t *testing.T) {
	cache := &analysisCache[string]{}
	probe := &analysisProbe{}

	if _, err := cache.load(probe.request("s", 0, true, "f1")); err != nil {
		t.Fatal(err)
	}
	// An unrelated edit bumped the generation: the analysis is re-verified, not rebuilt.
	value, err := cache.load(probe.request("s", 1, true, "f1"))
	if err != nil || value != "1" {
		t.Fatalf("verified load = %q err=%v, want 1", value, err)
	}
	if probe.fingerprints.Load() != 2 || probe.builds.Load() != 1 {
		t.Fatalf("verify should fingerprint once more and keep the value: fingerprints=%d builds=%d", probe.fingerprints.Load(), probe.builds.Load())
	}
	// The verified generation is now the current one, so the next call is a plain hit.
	if _, err := cache.load(probe.request("s", 1, true, "f1")); err != nil {
		t.Fatal(err)
	}
	if probe.fingerprints.Load() != 2 {
		t.Fatalf("fingerprints = %d, want 2 after the fast path", probe.fingerprints.Load())
	}
}

func TestAnalysisCacheRebuildsWhenTheFingerprintChanges(t *testing.T) {
	cache := &analysisCache[string]{}
	probe := &analysisProbe{}

	if _, err := cache.load(probe.request("s", 0, true, "f1")); err != nil {
		t.Fatal(err)
	}
	value, err := cache.load(probe.request("s", 1, true, "f2"))
	if err != nil || value != "2" {
		t.Fatalf("load after edit = %q err=%v, want the rebuilt 2", value, err)
	}
}

func TestAnalysisCacheValidatesByFingerprintWithoutACompleteWatcher(t *testing.T) {
	cache := &analysisCache[string]{}
	probe := &analysisProbe{}

	if _, err := cache.load(probe.request("s", 0, false, "f1")); err != nil {
		t.Fatal(err)
	}
	// Without a complete watcher the generation says nothing: the fingerprint decides.
	if _, err := cache.load(probe.request("s", 0, false, "f1")); err != nil {
		t.Fatal(err)
	}
	if probe.fingerprints.Load() != 2 || probe.builds.Load() != 1 {
		t.Fatalf("fingerprints=%d builds=%d, want 2/1", probe.fingerprints.Load(), probe.builds.Load())
	}
}

func TestAnalysisCacheDoesNotCacheErrors(t *testing.T) {
	cache := &analysisCache[string]{}
	failures := map[string]error{}
	var builds atomic.Int64
	fingerprint := func() (string, error) { return "f1", nil }
	build := func() (string, error) {
		builds.Add(1)
		if err := failures["now"]; err != nil {
			delete(failures, "now")
			return "", err
		}
		return "ok", nil
	}
	failures["now"] = errors.New("toolchain busy")

	if _, err := cache.load(analysisRequest[string]{sessionID: "s", watchedFully: true, fingerprint: fingerprint, build: build}); err == nil {
		t.Fatal("expected the first load to return the build error")
	}
	value, err := cache.load(analysisRequest[string]{sessionID: "s", watchedFully: true, fingerprint: fingerprint, build: build})
	if err != nil || value != "ok" {
		t.Fatalf("second load = %q err=%v, want a retry", value, err)
	}
	if builds.Load() != 2 {
		t.Fatalf("builds = %d, want 2 (the error was not cached)", builds.Load())
	}
}

func TestAnalysisCacheCoalescesConcurrentLoads(t *testing.T) {
	cache := &analysisCache[string]{}
	entered := make(chan struct{})
	release := make(chan struct{})
	var once sync.Once
	var builds atomic.Int64
	request := func() analysisRequest[string] {
		return analysisRequest[string]{
			sessionID:    "s",
			watchedFully: true,
			fingerprint:  func() (string, error) { return "f1", nil },
			build: func() (string, error) {
				builds.Add(1)
				once.Do(func() { close(entered) })
				<-release
				return "value", nil
			},
		}
	}

	var group sync.WaitGroup
	for range 8 {
		group.Go(func() {
			if value, err := cache.load(request()); err != nil || value != "value" {
				t.Errorf("load = %q err=%v", value, err)
			}
		})
	}
	<-entered
	close(release)
	group.Wait()
	if builds.Load() != 1 {
		t.Fatalf("builds = %d, want 1 (concurrent callers share the build)", builds.Load())
	}
}

func TestAnalysisCacheForgetDropsTheSession(t *testing.T) {
	cache := &analysisCache[string]{}
	probe := &analysisProbe{}

	if _, err := cache.load(probe.request("s", 0, true, "f1")); err != nil {
		t.Fatal(err)
	}
	cache.forget("s")
	if _, err := cache.load(probe.request("s", 0, true, "f1")); err != nil {
		t.Fatal(err)
	}
	if probe.builds.Load() != 2 {
		t.Fatalf("builds = %d, want 2 after forget", probe.builds.Load())
	}
}
