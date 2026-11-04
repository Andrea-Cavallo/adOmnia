package git

import (
	"path/filepath"
	"runtime"
	"strings"
	"sync"
	"sync/atomic"
	"time"

	"golang.org/x/sync/singleflight"
)

// The repository state is read in bursts: one save wakes the status refresh (debounced by the
// frontend), the Git panel opens with a refresh of its own, and the changed-files lint reads the
// same state again. Each read spawns a handful of git processes, and on Windows with a real-time
// antivirus every spawn costs tens of milliseconds. This cache collapses reads that happen
// together without hiding edits:
//
//   - every command that may write drops the entries (noteGitCommand);
//   - the project watcher drops them when files change (InvalidateRepository);
//   - the TTL only covers writers outside adOmnia, such as a terminal or another editor.
const (
	repositoryCacheTTL = time.Second
	// maxCachedRepositories bounds the process-wide cache: a developer has a handful of repos.
	maxCachedRepositories = 16
)

// Package-level because GetStatus, BranchState and GetOverview are free functions called by the
// Wails facade; the value is a cache, and tests reset it through resetRepositoryCache.
var repositories repositoryCache

// workingTreeReads counts how many times readWorkingTree really ran: the cache tests assert hits.
var workingTreeReads atomic.Int64

// porcelainReads counts `git status --porcelain` runs: the overview must reuse the one read of the
// working tree instead of asking again.
var porcelainReads atomic.Int64

// historyReads counts `git log` runs: the VCS bar and the changed-files lint must not pay for the
// Git panel payload.
var historyReads atomic.Int64

type cachedValue[T any] struct {
	value    T
	storedAt time.Time
}

// cachedRepository pairs the working tree with the two extra reads only the VCS bar needs: HEAD and
// the local branch names.
type cachedRepository struct {
	tree     workingTree
	head     string
	branches []string
}

type repositoryCache struct {
	mu          sync.Mutex
	trees       map[string]cachedValue[workingTree]
	states      map[string]cachedValue[cachedRepository]
	treeBuilds  singleflight.Group
	stateBuilds singleflight.Group
}

// InvalidateRepository drops the cached reads for the repository that contains path. The project
// watcher calls it on every batch of file changes: path is the project folder, which can sit
// inside the repository, so containment is checked in both directions.
func InvalidateRepository(path string) {
	repositories.invalidate(path)
}

// noteGitCommand drops the cached reads after a command that may have written. Called by every
// git invoker (runGit, runFull, runFullWithEnv, runRaw). Classification is conservative, so an
// unknown command invalidates too. The error is ignored on purpose: a failed merge can still leave
// the index or the working tree changed.
func noteGitCommand(dir string, args []string) {
	if readOnlyGit(args) {
		return
	}
	InvalidateRepository(dir)
}

// readOnlyGit reports whether a command cannot change the working tree, the index or the refs.
// Only provably read-only commands are listed: over-invalidating costs one extra read, while a
// mutating command mistaken for a read would serve stale state.
func readOnlyGit(args []string) bool {
	if len(args) == 0 {
		return false
	}
	switch args[0] {
	case "status", "rev-parse", "rev-list", "log", "show", "diff", "ls-files", "ls-tree",
		"cat-file", "describe", "blame", "shortlog", "grep", "for-each-ref", "merge-base",
		"name-rev", "check-ignore", "check-attr", "ls-remote", "count-objects", "version":
		return true
	case "branch":
		// Listing flags never write; -d/-D/-m/-M/-c/-C/-f and the upstream flags do.
		return !hasAnyFlag(args[1:], "-d", "-D", "-m", "-M", "-c", "-C", "-f", "--delete",
			"--move", "--copy", "--force", "--set-upstream-to", "--unset-upstream", "--edit-description")
	case "remote":
		return len(args) == 1 || args[1] == "-v" || args[1] == "--verbose" || args[1] == "show" || args[1] == "get-url"
	case "stash":
		return len(args) > 1 && (args[1] == "list" || args[1] == "show")
	case "tag":
		return len(args) == 1 || hasAnyFlag(args[1:], "-l", "--list", "--contains", "--no-contains", "--points-at", "-v", "--verify")
	case "config":
		return hasAnyFlag(args[1:], "--get", "--get-all", "--get-regexp", "--list", "-l")
	case "worktree":
		return len(args) > 1 && args[1] == "list"
	}
	return false
}

func hasAnyFlag(args []string, flags ...string) bool {
	for _, arg := range args {
		for _, flag := range flags {
			if arg == flag || strings.HasPrefix(arg, flag+"=") {
				return true
			}
		}
	}
	return false
}

func cachedTree(repoPath string) (workingTree, error) {
	key := repositoryKey(repoPath)
	if tree, ok := repositories.tree(key); ok {
		return tree, nil
	}
	built, err, _ := repositories.treeBuilds.Do(key, func() (any, error) {
		// A concurrent reader may have filled the entry while this call waited for the flight.
		if tree, ok := repositories.tree(key); ok {
			return tree, nil
		}
		tree, err := readWorkingTree(repoPath)
		if err != nil {
			return nil, err
		}
		repositories.storeTree(key, tree)
		return tree, nil
	})
	if err != nil {
		return workingTree{}, err
	}
	return built.(workingTree), nil
}

func cachedState(repoPath string) (cachedRepository, error) {
	key := repositoryKey(repoPath)
	if state, ok := repositories.state(key); ok {
		return state, nil
	}
	built, err, _ := repositories.stateBuilds.Do(key, func() (any, error) {
		if state, ok := repositories.state(key); ok {
			return state, nil
		}
		tree, err := cachedTree(repoPath)
		if err != nil {
			return nil, err
		}
		state := cachedRepository{tree: tree, head: headCommit(repoPath), branches: localBranches(repoPath)}
		repositories.storeState(key, state)
		return state, nil
	})
	if err != nil {
		return cachedRepository{}, err
	}
	return built.(cachedRepository), nil
}

func (c *repositoryCache) tree(key string) (workingTree, bool) {
	c.mu.Lock()
	defer c.mu.Unlock()
	entry, ok := c.trees[key]
	if !ok || time.Since(entry.storedAt) > repositoryCacheTTL {
		return workingTree{}, false
	}
	return entry.value, true
}

func (c *repositoryCache) storeTree(key string, tree workingTree) {
	c.mu.Lock()
	defer c.mu.Unlock()
	if c.trees == nil || len(c.trees) >= maxCachedRepositories {
		c.trees = map[string]cachedValue[workingTree]{}
	}
	c.trees[key] = cachedValue[workingTree]{value: tree, storedAt: time.Now()}
}

func (c *repositoryCache) state(key string) (cachedRepository, bool) {
	c.mu.Lock()
	defer c.mu.Unlock()
	entry, ok := c.states[key]
	if !ok || time.Since(entry.storedAt) > repositoryCacheTTL {
		return cachedRepository{}, false
	}
	return entry.value, true
}

func (c *repositoryCache) storeState(key string, state cachedRepository) {
	c.mu.Lock()
	defer c.mu.Unlock()
	if c.states == nil || len(c.states) >= maxCachedRepositories {
		c.states = map[string]cachedValue[cachedRepository]{}
	}
	c.states[key] = cachedValue[cachedRepository]{value: state, storedAt: time.Now()}
}

func (c *repositoryCache) invalidate(path string) {
	key := repositoryKey(path)
	c.mu.Lock()
	defer c.mu.Unlock()
	for cached := range c.trees {
		if sameRepository(cached, key) {
			delete(c.trees, cached)
		}
	}
	for cached := range c.states {
		if sameRepository(cached, key) {
			delete(c.states, cached)
		}
	}
}

// resetRepositoryCache empties the cache: tests that write files without going through git must
// not read the result of the previous call.
func resetRepositoryCache() {
	repositories.mu.Lock()
	repositories.trees = nil
	repositories.states = nil
	repositories.mu.Unlock()
}

var caseInsensitivePaths = runtime.GOOS == "windows" || runtime.GOOS == "darwin"

func repositoryKey(path string) string {
	key := filepath.Clean(path)
	if caseInsensitivePaths {
		key = strings.ToLower(key)
	}
	return key
}

// sameRepository reports whether two cleaned paths belong to the same repository: one may be the
// project folder inside the other.
func sameRepository(a, b string) bool {
	return a == b || pathContains(a, b) || pathContains(b, a)
}

func pathContains(root, candidate string) bool {
	relative, err := filepath.Rel(root, candidate)
	if err != nil || relative == "." {
		return false
	}
	return relative != ".." && !strings.HasPrefix(relative, ".."+string(filepath.Separator))
}
