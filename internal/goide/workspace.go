package goide

import (
	"context"
	"crypto/rand"
	"encoding/hex"
	"fmt"
	"io"
	"os"
	"path/filepath"
	"regexp"
	"strings"
	"sync"
	"time"

	"adomnia/internal/ide/language"
	"adomnia/internal/ide/project"
	"adomnia/internal/languages/golang"
)

var projectNamePattern = regexp.MustCompile(`^[A-Za-z0-9][A-Za-z0-9._-]{0,79}$`)

type WorkspaceManager struct {
	mu        sync.RWMutex
	sessions  map[SessionID]Session
	languages *language.Registry
}

func NewWorkspaceManager(languages *language.Registry) *WorkspaceManager {
	return &WorkspaceManager{sessions: make(map[SessionID]Session), languages: languages}
}

// OpenProject registra una cartella locale nel workspace Go Studio indicato, senza eseguire comandi.
// Lo stesso progetto può essere aperto in workspace diversi: ciascuno ha la propria sessione.
func (m *WorkspaceManager) OpenProject(path, workspaceID string) (Session, error) {
	root, realRoot, err := resolveProjectRoot(path)
	if err != nil {
		return Session{}, err
	}

	now := time.Now().UTC()
	project := inspectProject(m.languages, root, realRoot)
	m.mu.Lock()
	defer m.mu.Unlock()
	for _, existing := range m.sessions {
		if existing.WorkspaceID == workspaceID && samePath(existing.Project.RealPath, realRoot) {
			return existing, nil
		}
	}
	session := Session{
		ID:          SessionID(newID("session")),
		Project:     project,
		WorkspaceID: workspaceID,
		OpenedAt:    now,
		UpdatedAt:   now,
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

// RefreshProject rilegge moduli e go.work del progetto (es. dopo go work init/use).
func (m *WorkspaceManager) RefreshProject(id SessionID) (Session, error) {
	m.mu.Lock()
	defer m.mu.Unlock()
	session, ok := m.sessions[id]
	if !ok {
		return Session{}, fmt.Errorf("sessione Go Studio non trovata")
	}
	fresh := inspectProject(m.languages, session.Project.RootPath, session.Project.RealPath)
	session.Project.Units = fresh.Units
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
		if session.Project.Units == nil {
			// Sessione salvata prima delle unità (campi goModPath/modules ora rimossi): rileggi il progetto.
			session.Project.Units = inspectProject(m.languages, session.Project.RootPath, session.Project.RealPath).Units
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

// inspectProject chiede ai language adapter le unità del progetto, senza eseguire comandi.
func inspectProject(languages *language.Registry, root, realRoot string) Project {
	result := Project{
		ID:            newID("project"),
		Name:          filepath.Base(root),
		RootPath:      root,
		RealPath:      realRoot,
		Authorization: AuthorizationOpened,
	}
	// La detection di un linguaggio non blocca l'apertura: un detector in errore restituisce
	// comunque le unità trovate (come prima, quando gli errori del walk venivano ignorati).
	result.Units, _ = languages.DetectUnits(context.Background(), root)
	if result.Units == nil {
		result.Units = []project.Unit{}
	}
	return result
}

// goLayout è la vista Go di un progetto: moduli, go.work e cartelle sciolte, derivati dalle unità.
type goLayout struct {
	GoModPath   string
	GoWorkPath  string
	Modules     []GoModule
	LooseGoDirs []string
}

func goLayoutOf(source Project) goLayout {
	target := goLayout{Modules: []GoModule{}}
	for _, unit := range source.Units {
		if unit.Language != golang.ID {
			continue
		}
		switch unit.Kind {
		case golang.UnitModule:
			target.Modules = append(target.Modules, GoModule{Path: unit.Root, ModulePath: unit.Name})
			if samePath(unit.Root, source.RootPath) {
				target.GoModPath = filepath.Join(source.RootPath, "go.mod")
			}
		case golang.UnitWorkspace:
			target.GoWorkPath = unit.Manifest
		case golang.UnitLoose:
			if rel, err := filepath.Rel(source.RootPath, unit.Root); err == nil {
				target.LooseGoDirs = append(target.LooseGoDirs, filepath.ToSlash(rel))
			}
		}
	}
	return target
}

func newID(prefix string) string {
	random := make([]byte, 12)
	if _, err := rand.Read(random); err != nil {
		return fmt.Sprintf("%s-%d", prefix, time.Now().UnixNano())
	}
	return prefix + "-" + hex.EncodeToString(random)
}
