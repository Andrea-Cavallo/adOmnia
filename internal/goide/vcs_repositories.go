package goide

import (
	"adomnia/internal/git"
	"fmt"
	"path/filepath"
	"sort"
)

func (s *Service) repositoryRoots(session Session) ([]string, error) {
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
