package goide

import (
	"bufio"
	"crypto/rand"
	"encoding/hex"
	"fmt"
	"io"
	"os"
	"path/filepath"
	"regexp"
	"sort"
	"strings"
	"sync"
	"time"
)

const maxModuleScanDirectories = 4_000

var projectNamePattern = regexp.MustCompile(`^[A-Za-z0-9][A-Za-z0-9._-]{0,79}$`)

type WorkspaceManager struct {
	mu       sync.RWMutex
	sessions map[SessionID]Session
}

func NewWorkspaceManager() *WorkspaceManager {
	return &WorkspaceManager{sessions: make(map[SessionID]Session)}
}

// OpenProject registra una cartella locale senza eseguire comandi o modificarne il contenuto.
func (m *WorkspaceManager) OpenProject(path string) (Session, error) {
	root, realRoot, err := resolveProjectRoot(path)
	if err != nil {
		return Session{}, err
	}

	now := time.Now().UTC()
	project := inspectProject(root, realRoot)
	m.mu.Lock()
	defer m.mu.Unlock()
	for _, existing := range m.sessions {
		if samePath(existing.Project.RealPath, realRoot) {
			return existing, nil
		}
	}
	session := Session{
		ID:        SessionID(newID("session")),
		Project:   project,
		OpenedAt:  now,
		UpdatedAt: now,
	}
	m.sessions[session.ID] = session
	return session, nil
}

// ListSessions restituisce una copia ordinata per apertura delle sessioni correnti.
func (m *WorkspaceManager) ListSessions() []Session {
	m.mu.RLock()
	items := make([]Session, 0, len(m.sessions))
	for _, session := range m.sessions {
		items = append(items, session)
	}
	m.mu.RUnlock()
	for i := 0; i < len(items); i++ {
		for j := i + 1; j < len(items); j++ {
			if items[j].OpenedAt.Before(items[i].OpenedAt) {
				items[i], items[j] = items[j], items[i]
			}
		}
	}
	return items
}

// GetSession restituisce una copia della sessione richiesta.
func (m *WorkspaceManager) GetSession(id SessionID) (Session, error) {
	m.mu.RLock()
	session, ok := m.sessions[id]
	m.mu.RUnlock()
	if !ok {
		return Session{}, fmt.Errorf("sessione Go Studio non trovata")
	}
	return session, nil
}

// CreateProjectDirectory crea una nuova cartella vuota sotto il parent selezionato.
func (m *WorkspaceManager) CreateProjectDirectory(parentPath, name string) (string, error) {
	parent, _, err := resolveProjectRoot(parentPath)
	if err != nil {
		return "", err
	}
	trimmedName := strings.TrimSpace(name)
	if !projectNamePattern.MatchString(trimmedName) || trimmedName == "." || trimmedName == ".." {
		return "", fmt.Errorf("nome progetto non valido: usa lettere, numeri, punto, trattino o underscore")
	}
	target := filepath.Join(parent, trimmedName)
	if err := ensureWithinRoot(parent, target); err != nil {
		return "", err
	}
	if _, err := os.Stat(target); err == nil {
		return "", fmt.Errorf("esiste già un file o una cartella con questo nome")
	} else if !os.IsNotExist(err) {
		return "", fmt.Errorf("impossibile verificare la destinazione: %w", err)
	}
	if err := os.Mkdir(target, 0o755); err != nil {
		return "", fmt.Errorf("impossibile creare la cartella del progetto: %w", err)
	}
	return target, nil
}

// SetToolAuthorization modifica esclusivamente il consenso all'uso degli strumenti per la sessione indicata.
func (m *WorkspaceManager) SetToolAuthorization(id SessionID, allowed bool) (Session, error) {
	m.mu.Lock()
	defer m.mu.Unlock()
	session, ok := m.sessions[id]
	if !ok {
		return Session{}, fmt.Errorf("sessione Go Studio non trovata")
	}
	state := AuthorizationOpened
	if allowed {
		state = AuthorizationPermitted
	}
	session.Project.Authorization = state
	session.UpdatedAt = time.Now().UTC()
	m.sessions[id] = session
	return session, nil
}

// CloseSession rimuove la sessione in memoria senza toccare la cartella del progetto.
func (m *WorkspaceManager) CloseSession(id SessionID) bool {
	m.mu.Lock()
	defer m.mu.Unlock()
	if _, ok := m.sessions[id]; !ok {
		return false
	}
	delete(m.sessions, id)
	return true
}

// ReplaceSessions ripristina sessioni persistite dopo averne ricontrollato le cartelle.
func (m *WorkspaceManager) ReplaceSessions(sessions []Session) {
	m.mu.Lock()
	defer m.mu.Unlock()
	m.sessions = make(map[SessionID]Session, len(sessions))
	for _, session := range sessions {
		if session.ID == "" || session.Project.RealPath == "" {
			continue
		}
		info, err := os.Stat(session.Project.RealPath)
		if err != nil || !info.IsDir() {
			continue
		}
		m.sessions[session.ID] = session
	}
}

func resolveProjectRoot(path string) (string, string, error) {
	trimmed := strings.TrimSpace(path)
	if trimmed == "" {
		return "", "", fmt.Errorf("seleziona una cartella di progetto")
	}
	abs, err := filepath.Abs(filepath.Clean(trimmed))
	if err != nil {
		return "", "", fmt.Errorf("percorso progetto non valido: %w", err)
	}
	info, err := os.Stat(abs)
	if err != nil {
		return "", "", fmt.Errorf("impossibile aprire la cartella del progetto: %w", err)
	}
	if !info.IsDir() {
		return "", "", fmt.Errorf("il percorso selezionato non è una cartella")
	}
	directory, err := os.Open(abs)
	if err != nil {
		return "", "", fmt.Errorf("la cartella del progetto non è accessibile: %w", err)
	}
	_, readErr := directory.Readdirnames(1)
	closeErr := directory.Close()
	if readErr != nil && readErr != io.EOF {
		return "", "", fmt.Errorf("la cartella del progetto non è leggibile: %w", readErr)
	}
	if closeErr != nil {
		return "", "", fmt.Errorf("chiusura della cartella del progetto fallita: %w", closeErr)
	}
	realRoot, err := filepath.EvalSymlinks(abs)
	if err != nil {
		return "", "", fmt.Errorf("impossibile risolvere la cartella del progetto: %w", err)
	}
	return abs, realRoot, nil
}

func inspectProject(root, realRoot string) Project {
	project := Project{
		ID:            newID("project"),
		Name:          filepath.Base(root),
		RootPath:      root,
		RealPath:      realRoot,
		Modules:       []GoModule{},
		Authorization: AuthorizationOpened,
	}
	project.Modules = discoverModules(root)
	for _, module := range project.Modules {
		if samePath(module.Path, root) {
			project.GoModPath = filepath.Join(root, "go.mod")
			break
		}
	}
	goWork := filepath.Join(root, "go.work")
	if info, err := os.Stat(goWork); err == nil && !info.IsDir() {
		project.GoWorkPath = goWork
	}
	return project
}

func discoverModules(root string) []GoModule {
	modules := make([]GoModule, 0, 4)
	visited := 0
	_ = filepath.WalkDir(root, func(path string, entry os.DirEntry, walkErr error) error {
		if walkErr != nil {
			if entry != nil && entry.IsDir() {
				return filepath.SkipDir
			}
			return nil
		}
		if entry.IsDir() {
			if path != root && isIgnoredDirectory(entry.Name()) {
				return filepath.SkipDir
			}
			visited++
			if visited > maxModuleScanDirectories {
				return filepath.SkipAll
			}
			return nil
		}
		if !strings.EqualFold(entry.Name(), "go.mod") {
			return nil
		}
		modules = append(modules, GoModule{Path: filepath.Dir(path), ModulePath: readModulePath(path)})
		return nil
	})
	sort.Slice(modules, func(i, j int) bool { return modules[i].Path < modules[j].Path })
	return modules
}

func readModulePath(path string) string {
	file, err := os.Open(path)
	if err != nil {
		return ""
	}
	defer file.Close()
	scanner := bufio.NewScanner(file)
	for scanner.Scan() {
		line := strings.TrimSpace(scanner.Text())
		if strings.HasPrefix(line, "module ") {
			return strings.TrimSpace(strings.TrimPrefix(line, "module "))
		}
	}
	return ""
}

func samePath(left, right string) bool {
	return strings.EqualFold(filepath.Clean(left), filepath.Clean(right))
}

func newID(prefix string) string {
	random := make([]byte, 12)
	if _, err := rand.Read(random); err != nil {
		return fmt.Sprintf("%s-%d", prefix, time.Now().UnixNano())
	}
	return prefix + "-" + hex.EncodeToString(random)
}
