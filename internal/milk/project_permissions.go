package milk

import (
	"encoding/json/jsontext"
	"encoding/json/v2"
	"fmt"
	"os"
	"path/filepath"
	"runtime"
	"strings"
	"sync"

	"github.com/Andrea-Cavallo/adOmnia/internal/jsonutil"
)

// Project rules live in the adOmnia data folder, never in the repository: a committed
// "allow shell" would grant it to everyone who clones the project.
const projectPermissionsFileName = "agent-project-permissions.json"

// ProjectPermissionStore keeps the permission rules of each project, shared by every agent.
// A task worktree uses the rules of the project it was created from.
type ProjectPermissionStore struct {
	mu   sync.Mutex
	path string
}

func NewProjectPermissionStore(directory string) *ProjectPermissionStore {
	return &ProjectPermissionStore{path: filepath.Join(directory, projectPermissionsFileName)}
}

// Rules returns the rules of the project that contains root (none when unset or unreadable).
func (s *ProjectPermissionStore) Rules(root string) map[string]string {
	if root == "" {
		return nil
	}
	s.mu.Lock()
	defer s.mu.Unlock()
	return s.load()[projectKey(root)]
}

// Save replaces the rules of root's project; only allow and deny are stored, "ask" is the default.
func (s *ProjectPermissionStore) Save(root string, rules map[string]string) (map[string]string, error) {
	if strings.TrimSpace(root) == "" {
		return nil, fmt.Errorf("project folder is required")
	}
	clean, err := validatePermissionRules(rules)
	if err != nil {
		return nil, err
	}
	s.mu.Lock()
	defer s.mu.Unlock()
	all := s.load()
	if len(clean) == 0 {
		delete(all, projectKey(root))
	} else {
		all[projectKey(root)] = clean
	}
	return clean, s.write(all)
}

// Forget drops the rules of root's project: revoking trust invalidates what was decided under it.
func (s *ProjectPermissionStore) Forget(root string) error {
	s.mu.Lock()
	defer s.mu.Unlock()
	all := s.load()
	if _, exists := all[projectKey(root)]; !exists {
		return nil
	}
	delete(all, projectKey(root))
	return s.write(all)
}

func (s *ProjectPermissionStore) load() map[string]map[string]string {
	all := map[string]map[string]string{}
	data, err := os.ReadFile(s.path)
	if err != nil || json.Unmarshal(data, &all) != nil {
		return map[string]map[string]string{}
	}
	for key, rules := range all {
		if valid, err := validatePermissionRules(rules); err == nil {
			all[key] = valid
		} else {
			delete(all, key) // a hand-edited invalid entry falls back to asking
		}
	}
	return all
}

func (s *ProjectPermissionStore) write(all map[string]map[string]string) error {
	data, err := jsonutil.Marshal(all, jsontext.WithIndent("  "))
	if err != nil {
		return err
	}
	if err := os.MkdirAll(filepath.Dir(s.path), 0o700); err != nil {
		return fmt.Errorf("cannot create settings folder: %w", err)
	}
	temporary := s.path + ".tmp"
	if err := os.WriteFile(temporary, data, 0o600); err != nil {
		return fmt.Errorf("cannot write project permission rules: %w", err)
	}
	if err := os.Rename(temporary, s.path); err != nil {
		_ = os.Remove(temporary)
		return fmt.Errorf("cannot save project permission rules: %w", err)
	}
	return nil
}

// projectKey is the main worktree of root's repository (root itself outside Git worktrees),
// cleaned and, on case-insensitive Windows paths, lower-cased.
func projectKey(root string) string {
	path := mainWorktree(filepath.Clean(root))
	if resolved, err := filepath.EvalSymlinks(path); err == nil {
		path = resolved
	}
	if runtime.GOOS == "windows" {
		path = strings.ToLower(path)
	}
	return path
}

// mainWorktree follows a linked worktree's ".git" file ("gitdir: <main>/.git/worktrees/<name>").
func mainWorktree(root string) string {
	data, err := os.ReadFile(filepath.Join(root, ".git"))
	if err != nil {
		return root // a directory (main worktree) or no repository
	}
	gitdir, found := strings.CutPrefix(strings.TrimSpace(string(data)), "gitdir:")
	if !found {
		return root
	}
	gitdir = filepath.Clean(strings.TrimSpace(gitdir))
	if !filepath.IsAbs(gitdir) {
		gitdir = filepath.Join(root, gitdir)
	}
	worktrees := filepath.Dir(gitdir)
	if filepath.Base(worktrees) != "worktrees" || filepath.Base(filepath.Dir(worktrees)) != ".git" {
		return root
	}
	return filepath.Dir(filepath.Dir(worktrees))
}

// combinePermission: an explicit deny at either level wins, then an allow at either level.
func combinePermission(agent, project string) string {
	switch {
	case agent == RuleDeny || project == RuleDeny:
		return RuleDeny
	case agent == RuleAllow || project == RuleAllow:
		return RuleAllow
	default:
		return RuleAsk
	}
}
