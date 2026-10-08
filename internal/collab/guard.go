package collab

import (
	"sync"
	"time"
)

const (
	guardFreeAttempts = 5
	guardBaseBackoff  = 30 * time.Second
	guardMaxBackoff   = 10 * time.Minute
)

// bruteGuard blocca gli IP che sbagliano troppi token (backoff esponenziale).
type bruteGuard struct {
	mu      sync.Mutex
	entries map[string]*guardEntry
	now     func() time.Time
}

type guardEntry struct {
	fails int
	until time.Time
}

func newBruteGuard() *bruteGuard {
	return &bruteGuard{entries: map[string]*guardEntry{}, now: time.Now}
}

func (g *bruteGuard) allowed(ip string) bool {
	g.mu.Lock()
	defer g.mu.Unlock()
	e := g.entries[ip]
	return e == nil || !g.now().Before(e.until)
}

func (g *bruteGuard) fail(ip string) {
	g.mu.Lock()
	defer g.mu.Unlock()
	e := g.entries[ip]
	if e == nil {
		e = &guardEntry{}
		g.entries[ip] = e
	}
	e.fails++
	if e.fails < guardFreeAttempts {
		return
	}
	backoff := guardBaseBackoff << min(e.fails-guardFreeAttempts, 5)
	e.until = g.now().Add(min(backoff, guardMaxBackoff))
}

func (g *bruteGuard) success(ip string) {
	g.mu.Lock()
	defer g.mu.Unlock()
	delete(g.entries, ip)
}
