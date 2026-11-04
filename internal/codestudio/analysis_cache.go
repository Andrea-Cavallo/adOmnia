package codestudio

import (
	"sync"

	"golang.org/x/sync/singleflight"
)

// analysisCache keeps the result of an expensive analysis per session while the files it reads
// stay the same. It follows the workspace graph: the watcher generation is the fast path (a
// complete watcher that saw no relevant change makes the entry valid without walking the tree),
// and the fingerprint covers everything else, including a partial watcher.
//
// The sections that need it are the ones that run `go list` (architecture) or parse every package
// and .proto file (documentation) whenever a panel opens.
type analysisCache[T any] struct {
	mu      sync.Mutex
	entries map[string]analysisEntry[T]
	builds  singleflight.Group
}

type analysisEntry[T any] struct {
	value       T
	fingerprint string
	generation  uint64
}

// maxCachedAnalyses bounds the cache: a value per open session, and a few extra so switching
// between two projects does not throw the other one away.
const maxCachedAnalyses = 8

// analysisRequest is what a cached analysis needs: who it is for, the two validity signals, and
// the two functions that recompute the fingerprint and the value.
type analysisRequest[T any] struct {
	sessionID    string
	generation   uint64
	watchedFully bool
	fingerprint  func() (string, error)
	build        func() (T, error)
}

// load serves the cached value, re-fingerprints it, or rebuilds it. Concurrent callers for the
// same session share one build.
func (c *analysisCache[T]) load(request analysisRequest[T]) (T, error) {
	if value, ok := c.current(request.sessionID, request.generation, request.watchedFully); ok {
		return value, nil
	}
	built, err, _ := c.builds.Do(request.sessionID, func() (any, error) {
		if value, ok := c.current(request.sessionID, request.generation, request.watchedFully); ok {
			return value, nil
		}
		fingerprint, err := request.fingerprint()
		if err != nil {
			return nil, err
		}
		if value, ok := c.matching(request.sessionID, fingerprint, request.generation); ok {
			return value, nil
		}
		value, err := request.build()
		if err != nil {
			return nil, err
		}
		c.store(request.sessionID, value, fingerprint, request.generation)
		return value, nil
	})
	if err != nil {
		var zero T
		return zero, err
	}
	return built.(T), nil
}

// current is the fast path: the entry was built or verified at the current generation and the
// watcher is complete, so no file changed since then.
func (c *analysisCache[T]) current(sessionID string, generation uint64, watchedFully bool) (T, bool) {
	var zero T
	if !watchedFully {
		return zero, false
	}
	c.mu.Lock()
	defer c.mu.Unlock()
	entry, ok := c.entries[sessionID]
	if !ok || entry.generation != generation {
		return zero, false
	}
	return entry.value, true
}

// matching keeps the value when only the generation moved but the files are the same (an edit
// that does not touch what the analysis reads), and marks it verified at the new generation.
func (c *analysisCache[T]) matching(sessionID, fingerprint string, generation uint64) (T, bool) {
	var zero T
	c.mu.Lock()
	defer c.mu.Unlock()
	entry, ok := c.entries[sessionID]
	if !ok || entry.fingerprint != fingerprint {
		return zero, false
	}
	entry.generation = generation
	c.entries[sessionID] = entry
	return entry.value, true
}

func (c *analysisCache[T]) store(sessionID string, value T, fingerprint string, generation uint64) {
	c.mu.Lock()
	defer c.mu.Unlock()
	if c.entries == nil {
		c.entries = map[string]analysisEntry[T]{}
	}
	if len(c.entries) >= maxCachedAnalyses {
		c.entries = map[string]analysisEntry[T]{}
	}
	c.entries[sessionID] = analysisEntry[T]{value: value, fingerprint: fingerprint, generation: generation}
}

func (c *analysisCache[T]) forget(sessionID string) {
	c.mu.Lock()
	defer c.mu.Unlock()
	delete(c.entries, sessionID)
}

// analysisCaches groups the cached analyses: both are read from the same Go sources, so they share
// the validity signals but not the values.
type analysisCaches struct {
	architecture  analysisCache[ArchitectureResult]
	documentation analysisCache[DocumentationReport]
}

func (c *analysisCaches) forget(sessionID string) {
	c.architecture.forget(sessionID)
	c.documentation.forget(sessionID)
}
