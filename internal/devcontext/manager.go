package devcontext

import (
	"context"
	"errors"
	"fmt"
	"io/fs"
	"os"
	"path"
	"path/filepath"
	"sort"
	"strings"
	"sync"
	"time"
)

const (
	maxVisitedFiles = 120_000
	maxFileBytes    = 2 << 20
	maxReadBytes    = 5 << 20
	scanTimeout     = 30 * time.Second
)

var errFileLimit = errors.New("file limit reached")

type RootResolver func(sessionID string) (string, error)
type ChangeFunc func(sessionID string, version int64)

type fileResult struct {
	Entities []Entity
	Warnings []string
	ModTime  time.Time
}

type sessionState struct {
	scan     sync.Mutex // one scan per session at a time
	mu       sync.Mutex // guards the fields below
	root     string
	files    map[string]fileResult
	warnings []string
	version  int64
	scanned  time.Time
}

// Manager keeps one in-memory context per gO session.
type Manager struct {
	resolveRoot RootResolver
	onChange    ChangeFunc
	timeout     time.Duration
	mu          sync.Mutex
	sessions    map[string]*sessionState
}

func NewManager(resolveRoot RootResolver, onChange ChangeFunc) *Manager {
	return &Manager{resolveRoot: resolveRoot, onChange: onChange, timeout: scanTimeout, sessions: map[string]*sessionState{}}
}

func (m *Manager) state(sessionID string) *sessionState {
	m.mu.Lock()
	defer m.mu.Unlock()
	st, ok := m.sessions[sessionID]
	if !ok {
		st = &sessionState{}
		m.sessions[sessionID] = st
	}
	return st
}

func (m *Manager) existing(sessionID string) *sessionState {
	m.mu.Lock()
	defer m.mu.Unlock()
	return m.sessions[sessionID]
}

// Get returns the cached snapshot, scanning the session on first use.
func (m *Manager) Get(sessionID string) (Snapshot, error) {
	st := m.state(sessionID)
	st.mu.Lock()
	ready := st.files != nil
	st.mu.Unlock()
	if ready {
		return st.snapshot(sessionID), nil
	}
	st.scan.Lock()
	defer st.scan.Unlock()
	st.mu.Lock()
	ready = st.files != nil // a concurrent first Get may have finished the scan
	st.mu.Unlock()
	if ready {
		return st.snapshot(sessionID), nil
	}
	return m.rescanLocked(sessionID, st)
}

func (m *Manager) Rescan(sessionID string) (Snapshot, error) {
	st := m.state(sessionID)
	st.scan.Lock()
	defer st.scan.Unlock()
	return m.rescanLocked(sessionID, st)
}

// rescanLocked runs a full scan; the caller holds st.scan.
func (m *Manager) rescanLocked(sessionID string, st *sessionState) (Snapshot, error) {
	root, err := m.resolveRoot(sessionID)
	if err != nil {
		return Snapshot{}, err
	}
	ctx, cancel := context.WithTimeout(context.Background(), m.timeout)
	defer cancel()
	env := rootEnv(root)
	files := map[string]fileResult{}
	walkErr := walkInteresting(ctx, root, func(rel string, _ time.Time) {
		files[rel] = scanFile(root, rel, env)
	})
	st.mu.Lock()
	st.root, st.files, st.warnings = root, files, walkWarnings(walkErr)
	st.version++
	st.scanned = time.Now()
	version := st.version
	st.mu.Unlock()
	m.notify(sessionID, version)
	return st.snapshot(sessionID), nil
}

// Invalidate rescans one saved file. A root .env change also refreshes
// compose files, because they interpolate its values.
func (m *Manager) Invalidate(sessionID, rel string) {
	st := m.existing(sessionID)
	if st == nil {
		return
	}
	st.scan.Lock()
	defer st.scan.Unlock()
	st.mu.Lock()
	root, ready := st.root, st.files != nil
	st.mu.Unlock()
	if !ready {
		return
	}
	m.refresh(sessionID, st, root, withComposeIfEnv(st, []string{filepath.ToSlash(rel)}))
}

// CheckStale compares modification times with a fresh walk (cheap: no
// parsing) and rescans only what changed, including new and deleted files.
func (m *Manager) CheckStale(sessionID string) (bool, error) {
	st := m.existing(sessionID)
	if st == nil {
		return false, nil
	}
	st.scan.Lock()
	defer st.scan.Unlock()
	st.mu.Lock()
	root := st.root
	known := make(map[string]time.Time, len(st.files))
	for rel, f := range st.files {
		known[rel] = f.ModTime
	}
	st.mu.Unlock()
	if root == "" {
		return false, nil
	}
	ctx, cancel := context.WithTimeout(context.Background(), m.timeout)
	defer cancel()
	current := map[string]time.Time{}
	if err := walkInteresting(ctx, root, func(rel string, mod time.Time) { current[rel] = mod }); err != nil {
		return false, nil // partial walk: never delete entities based on it
	}
	var changed []string
	for rel, mod := range current {
		if old, ok := known[rel]; !ok || !old.Equal(mod) {
			changed = append(changed, rel)
		}
	}
	for rel := range known {
		if _, ok := current[rel]; !ok {
			changed = append(changed, rel)
		}
	}
	if len(changed) == 0 {
		return false, nil
	}
	m.refresh(sessionID, st, root, withComposeIfEnv(st, changed))
	return true, nil
}

func (m *Manager) Drop(sessionID string) {
	m.mu.Lock()
	defer m.mu.Unlock()
	delete(m.sessions, sessionID)
}

// ReadFile returns a contract document (OAS, proto, WSDL) inside the root.
func (m *Manager) ReadFile(sessionID, rel string) (string, error) {
	root, err := m.resolveRoot(sessionID)
	if err != nil {
		return "", err
	}
	if filepath.IsAbs(rel) {
		return "", fmt.Errorf("path outside the project: %s", rel)
	}
	clean := path.Clean(filepath.ToSlash(rel))
	if clean == ".." || strings.HasPrefix(clean, "../") {
		return "", fmt.Errorf("path outside the project: %s", rel)
	}
	if !readable(clean) || !m.isContract(sessionID, clean) {
		return "", fmt.Errorf("%s is not a contract file", rel)
	}
	full := filepath.Join(root, filepath.FromSlash(clean))
	if real, err := filepath.EvalSymlinks(full); err == nil {
		realRoot, rootErr := filepath.EvalSymlinks(root)
		if rootErr != nil || !strings.HasPrefix(real, realRoot+string(filepath.Separator)) {
			return "", fmt.Errorf("path outside the project: %s", rel)
		}
	}
	info, err := os.Stat(full)
	if err != nil {
		return "", err
	}
	if info.Size() > maxReadBytes {
		return "", fmt.Errorf("%s is larger than 5 MB", rel)
	}
	data, err := os.ReadFile(full)
	return string(data), err
}

// isContract reports whether rel produced a contract entity in the session
// snapshot, so ReadFile never serves compose files or other YAML with secrets.
func (m *Manager) isContract(sessionID, rel string) bool {
	if _, err := m.Get(sessionID); err != nil {
		return false
	}
	st := m.existing(sessionID)
	if st == nil {
		return false
	}
	st.mu.Lock()
	defer st.mu.Unlock()
	for _, e := range st.files[rel].Entities {
		if e.Kind == "contract" {
			return true
		}
	}
	return false
}

func (m *Manager) refresh(sessionID string, st *sessionState, root string, rels []string) {
	env := rootEnv(root)
	updates := map[string]*fileResult{}
	for _, rel := range rels {
		if !interesting(rel) {
			continue
		}
		if _, err := os.Stat(filepath.Join(root, filepath.FromSlash(rel))); err != nil {
			updates[rel] = nil
			continue
		}
		r := scanFile(root, rel, env)
		updates[rel] = &r
	}
	if len(updates) == 0 {
		return
	}
	st.mu.Lock()
	for rel, r := range updates {
		if r == nil {
			delete(st.files, rel)
		} else {
			st.files[rel] = *r
		}
	}
	st.version++
	version := st.version
	st.mu.Unlock()
	m.notify(sessionID, version)
}

func (m *Manager) notify(sessionID string, version int64) {
	if m.onChange != nil {
		m.onChange(sessionID, version)
	}
}

func withComposeIfEnv(st *sessionState, rels []string) []string {
	for _, rel := range rels {
		if path.Dir(rel) == "." && isDotenv(path.Base(rel)) {
			st.mu.Lock()
			for known := range st.files {
				if isCompose(path.Base(known)) {
					rels = append(rels, known)
				}
			}
			st.mu.Unlock()
			return rels
		}
	}
	return rels
}

func (st *sessionState) snapshot(sessionID string) Snapshot {
	st.mu.Lock()
	defer st.mu.Unlock()
	rels := make([]string, 0, len(st.files))
	for rel := range st.files {
		rels = append(rels, rel)
	}
	sort.Strings(rels) // deterministic "first writer wins" in merge
	groups := make([][]Entity, 0, len(rels))
	warnings := append([]string{}, st.warnings...)
	for _, rel := range rels {
		groups = append(groups, st.files[rel].Entities)
		warnings = append(warnings, st.files[rel].Warnings...)
	}
	return Snapshot{SessionID: sessionID, Root: st.root, Version: st.version, Entities: merge(groups...), Warnings: warnings, ScannedAt: st.scanned}
}

func walkInteresting(ctx context.Context, root string, visit func(rel string, mod time.Time)) error {
	visited := 0
	return filepath.WalkDir(root, func(p string, d fs.DirEntry, err error) error {
		if err != nil {
			return nil // unreadable entries are skipped
		}
		if ctx.Err() != nil {
			return ctx.Err()
		}
		if d.IsDir() {
			if p != root && (skippedDirs[d.Name()] || strings.HasPrefix(d.Name(), ".")) {
				return filepath.SkipDir
			}
			return nil
		}
		if visited++; visited > maxVisitedFiles {
			return errFileLimit
		}
		rel, err := filepath.Rel(root, p)
		if err != nil {
			return nil
		}
		rel = filepath.ToSlash(rel)
		if !interesting(rel) {
			return nil
		}
		info, err := d.Info()
		if err != nil {
			return nil
		}
		visit(rel, info.ModTime())
		return nil
	})
}

func walkWarnings(err error) []string {
	switch {
	case errors.Is(err, context.DeadlineExceeded):
		return []string{"scan timed out: results are partial"}
	case errors.Is(err, errFileLimit):
		return []string{"more than 120000 files: results are partial"}
	}
	return nil
}

func scanFile(root, rel string, env map[string]string) fileResult {
	full := filepath.Join(root, filepath.FromSlash(rel))
	info, err := os.Stat(full)
	if err != nil {
		return fileResult{Warnings: []string{rel + ": " + err.Error()}}
	}
	if info.Size() > maxFileBytes {
		return fileResult{ModTime: info.ModTime()}
	}
	data, err := os.ReadFile(full)
	if err != nil {
		return fileResult{ModTime: info.ModTime(), Warnings: []string{rel + ": " + err.Error()}}
	}
	entities, warnings := detectFile(rel, data, env)
	return fileResult{Entities: entities, Warnings: warnings, ModTime: info.ModTime()}
}

// rootEnv holds raw .env values for compose interpolation. It never leaves
// the backend.
func rootEnv(root string) map[string]string {
	env := map[string]string{}
	data, err := os.ReadFile(filepath.Join(root, ".env"))
	if err != nil {
		return env
	}
	for _, e := range parseDotenv(data) {
		env[e.Key] = e.Value
	}
	return env
}
