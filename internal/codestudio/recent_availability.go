package codestudio

import (
	"os"
	"sync"
	"time"
)

// recentCheckTTL bounds the filesystem checks behind the recent-project list:
// each path is re-verified at most once per interval.
var recentCheckTTL = 15 * time.Second

// recentAvailabilityCache memoizza i controlli di esistenza dei progetti
// recenti. La cache è limitata a maxRecentProjects voci: la controllata da più
// tempo viene scartata, così elenchi ripetuti non moltiplicano gli os.Stat.
type recentAvailabilityCache struct {
	mu    sync.Mutex
	seq   uint64
	known map[string]recentAvailability
}

type recentAvailability struct {
	available bool
	checkedAt time.Time
	// order breaks ties between checks in the same clock tick when evicting.
	order uint64
}

// available reports whether the path is a local directory, re-checking it at
// most once per recentCheckTTL. os.Stat runs outside the cache lock: an
// unreachable network drive can take seconds and must not block other work.
func (s *Service) recentAvailability(path string) bool {
	now := time.Now()
	s.recentChecks.mu.Lock()
	entry, known := s.recentChecks.known[path]
	if known && now.Sub(entry.checkedAt) < recentCheckTTL {
		s.recentChecks.mu.Unlock()
		return entry.available
	}
	s.recentChecks.mu.Unlock()

	info, err := os.Stat(path)
	available := err == nil && info.IsDir()

	s.recentChecks.mu.Lock()
	defer s.recentChecks.mu.Unlock()
	if s.recentChecks.known == nil {
		s.recentChecks.known = make(map[string]recentAvailability, maxRecentProjects)
	}
	if _, exists := s.recentChecks.known[path]; !exists && len(s.recentChecks.known) >= maxRecentProjects {
		oldest, oldestOrder := "", uint64(0)
		for key, value := range s.recentChecks.known {
			if oldest == "" || value.order < oldestOrder {
				oldest, oldestOrder = key, value.order
			}
		}
		delete(s.recentChecks.known, oldest)
	}
	s.recentChecks.seq++
	s.recentChecks.known[path] = recentAvailability{available: available, checkedAt: now, order: s.recentChecks.seq}
	return available
}

// forgetRecentAvailability drops a cached check, e.g. when a recent entry is
// removed before its TTL expires.
func (s *Service) forgetRecentAvailability(path string) {
	s.recentChecks.mu.Lock()
	delete(s.recentChecks.known, path)
	s.recentChecks.mu.Unlock()
}
