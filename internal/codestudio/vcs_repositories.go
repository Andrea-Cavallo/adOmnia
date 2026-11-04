package codestudio

import (
	"fmt"
	"path/filepath"
	"sort"
	"sync"
	"time"

	"github.com/Andrea-Cavallo/adOmnia/internal/git"
)

func (s *Service) repositoryRoots(session Session) ([]string, error) {
	if roots, ok := s.vcsRoots.get(session.ID); ok {
		return roots, nil
	}
	roots, err := discoverRepositoryRoots(session)
	if err != nil {
		return nil, err
	}
	s.vcsRoots.set(session.ID, roots)
	return roots, nil
}

// discoverRepositoryRoots walks the project looking for .git markers. The scan is the expensive
// part (a tree visit and an os.Stat per folder), and VCSStatus asked for it on every save only to
// show the repository list.
func discoverRepositoryRoots(session Session) ([]string, error) {
	roots := []string{}
	seen := map[string]bool{}
	add := func(path string) error {
		root, err := repositoryRoot(path)
		if err != nil {
			return err
		}
		if root != "" && !seen[root] {
			seen[root] = true
			roots = append(roots, root)
		}
		return nil
	}
	if err := add(session.Project.RealPath); err != nil {
		return nil, err
	}
	folders, err := git.RepositoryFolders(session.Project.RealPath)
	if err != nil {
		return nil, err
	}
	for _, folder := range folders {
		if err := add(folder); err != nil {
			return nil, err
		}
	}
	sort.Strings(roots)
	return roots, nil
}

// repositoryRootsCache keeps the repository list of a session. The topology changes only when a
// .git appears or disappears (init, clone, worktree, submodule), never on a save, so a timer is
// enough: the generation is too eager here because editing a Go file would walk the tree again.
type repositoryRootsCache struct {
	mu      sync.Mutex
	entries map[SessionID]repositoryRootsEntry
}

const (
	// repositoryRootsTTL keeps a discovered repository list: walking the project on every save only
	// to list repositories that did not change was the expensive part of VCSStatus.
	repositoryRootsTTL = 60 * time.Second
	// missingRepositoryRootsTTL keeps a "no repository" answer only briefly: `git init` from the
	// terminal must reach the VCS bar without restarting the session.
	missingRepositoryRootsTTL = 2 * time.Second
)

type repositoryRootsEntry struct {
	roots    []string
	storedAt time.Time
}

func (c *repositoryRootsCache) get(sessionID SessionID) ([]string, bool) {
	c.mu.Lock()
	defer c.mu.Unlock()
	entry, ok := c.entries[sessionID]
	if !ok {
		return nil, false
	}
	ttl := repositoryRootsTTL
	if len(entry.roots) == 0 {
		ttl = missingRepositoryRootsTTL
	}
	if time.Since(entry.storedAt) >= ttl {
		return nil, false
	}
	return entry.roots, true
}

func (c *repositoryRootsCache) set(sessionID SessionID, roots []string) {
	c.mu.Lock()
	defer c.mu.Unlock()
	if c.entries == nil {
		c.entries = map[SessionID]repositoryRootsEntry{}
	}
	c.entries[sessionID] = repositoryRootsEntry{roots: roots, storedAt: time.Now()}
}

func (c *repositoryRootsCache) forget(sessionID SessionID) {
	c.mu.Lock()
	defer c.mu.Unlock()
	delete(c.entries, sessionID)
}

func (s *Service) selectedRepository(session Session, roots []string) string {
	s.vcsMu.Lock()
	defer s.vcsMu.Unlock()
	selected := s.vcsSelected[session.ID]
	for _, root := range roots {
		if samePath(root, selected) {
			return root
		}
	}
	if len(roots) == 0 {
		return ""
	}
	// Prefer the enclosing repository when it exists, otherwise a stable first
	// child. The UI always displays the selected root and offers the full list.
	selected = roots[0]
	for _, root := range roots {
		if ensureWithinRoot(root, session.Project.RealPath) == nil {
			selected = root
			break
		}
	}
	return selected
}

// VCSSelectRepository changes only this session's Git target. Every mutation
// still validates its project-relative paths against that repository.
func (s *Service) VCSSelectRepository(sessionID, root string) (VCSStatus, error) {
	session, err := s.session(sessionID)
	if err != nil {
		return VCSStatus{}, err
	}
	roots, err := s.repositoryRoots(session)
	if err != nil {
		return VCSStatus{}, err
	}
	for _, candidate := range roots {
		if samePath(candidate, root) {
			s.vcsMu.Lock()
			if s.vcsSelected == nil {
				s.vcsSelected = map[SessionID]string{}
			}
			s.vcsSelected[session.ID] = candidate
			s.vcsMu.Unlock()
			return s.VCSStatus(sessionID)
		}
	}
	return VCSStatus{}, fmt.Errorf("repository is not part of this project")
}

func (s *Service) vcsPathsForFile(sessionID, relativePath string) (Session, vcsPaths, error) {
	session, err := s.session(sessionID)
	if err != nil {
		return Session{}, vcsPaths{}, err
	}
	absolute := filepath.Join(session.Project.RealPath, filepath.FromSlash(relativePath))
	if err := ensureWithinRoot(session.Project.RealPath, absolute); err != nil {
		return Session{}, vcsPaths{}, err
	}
	parent := filepath.Dir(absolute)
	if real, err := filepath.EvalSymlinks(parent); err == nil {
		if err := ensureWithinRoot(session.Project.RealPath, real); err != nil {
			return Session{}, vcsPaths{}, err
		}
		parent = real
	}
	root, err := repositoryRoot(parent)
	if err != nil {
		return Session{}, vcsPaths{}, err
	}
	if root == "" {
		return Session{}, vcsPaths{}, fmt.Errorf("file is not in a Git repository")
	}
	return session, vcsPaths{projectRoot: session.Project.RealPath, repoRoot: root}, nil
}
