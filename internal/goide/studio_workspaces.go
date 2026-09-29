package goide

import (
	"fmt"
	"strings"
	"sync"
	"time"
	"unicode/utf8"
)

// DefaultStudioWorkspaceID identifica il workspace Go Studio sempre presente, che accoglie le sessioni degli schemi precedenti.
const DefaultStudioWorkspaceID = "default"

const (
	defaultStudioWorkspaceName = "Main"
	maxStudioWorkspaces        = 20
	maxStudioWorkspaceName     = 40
)

// StudioWorkspace è un insieme con nome di progetti aperti in Go Studio.
// È separato dai workspace API di adOmnia: cambiarlo non tocca collezioni né ambienti.
type StudioWorkspace struct {
	ID        string    `json:"id"`
	Name      string    `json:"name"`
	CreatedAt time.Time `json:"createdAt"`
}

// StudioWorkspaces descrive i workspace Go Studio e quello attivo.
type StudioWorkspaces struct {
	Workspaces []StudioWorkspace `json:"workspaces"`
	ActiveID   string            `json:"activeId"`
}

type studioWorkspaceRegistry struct {
	mu     sync.RWMutex
	items  []StudioWorkspace
	active string
}

func newStudioWorkspaceRegistry() *studioWorkspaceRegistry {
	registry := &studioWorkspaceRegistry{}
	registry.replace(nil, "")
	return registry
}

func defaultStudioWorkspace() StudioWorkspace {
	return StudioWorkspace{ID: DefaultStudioWorkspaceID, Name: defaultStudioWorkspaceName}
}

// replace carica i workspace persistiti garantendo il predefinito e un attivo valido.
func (r *studioWorkspaceRegistry) replace(items []StudioWorkspace, active string) {
	r.mu.Lock()
	defer r.mu.Unlock()
	r.items = []StudioWorkspace{defaultStudioWorkspace()}
	for _, item := range items {
		if item.ID == "" || item.ID == DefaultStudioWorkspaceID {
			if item.ID == DefaultStudioWorkspaceID && strings.TrimSpace(item.Name) != "" {
				r.items[0].Name = item.Name
			}
			continue
		}
		r.items = append(r.items, item)
	}
	r.active = DefaultStudioWorkspaceID
	if r.indexLocked(active) >= 0 {
		r.active = active
	}
}

// assignSessions porta nel workspace predefinito le sessioni senza workspace o con un workspace sconosciuto.
func (r *studioWorkspaceRegistry) assignSessions(sessions []Session) []Session {
	r.mu.RLock()
	defer r.mu.RUnlock()
	result := make([]Session, 0, len(sessions))
	for _, session := range sessions {
		if r.indexLocked(session.WorkspaceID) < 0 {
			session.WorkspaceID = DefaultStudioWorkspaceID
		}
		result = append(result, session)
	}
	return result
}

func (r *studioWorkspaceRegistry) snapshot() ([]StudioWorkspace, string) {
	r.mu.RLock()
	defer r.mu.RUnlock()
	return append([]StudioWorkspace(nil), r.items...), r.active
}

func (r *studioWorkspaceRegistry) state() StudioWorkspaces {
	items, active := r.snapshot()
	return StudioWorkspaces{Workspaces: items, ActiveID: active}
}

func (r *studioWorkspaceRegistry) activeID() string {
	r.mu.RLock()
	defer r.mu.RUnlock()
	return r.active
}

func (r *studioWorkspaceRegistry) indexLocked(id string) int {
	for index, item := range r.items {
		if item.ID == id {
			return index
		}
	}
	return -1
}

func (r *studioWorkspaceRegistry) validateNameLocked(name, exceptID string) (string, error) {
	trimmed := strings.TrimSpace(name)
	if trimmed == "" || utf8.RuneCountInString(trimmed) > maxStudioWorkspaceName {
		return "", fmt.Errorf("il nome del workspace deve avere da 1 a %d caratteri", maxStudioWorkspaceName)
	}
	for _, item := range r.items {
		if item.ID != exceptID && strings.EqualFold(item.Name, trimmed) {
			return "", fmt.Errorf("esiste già un workspace chiamato %q", item.Name)
		}
	}
	return trimmed, nil
}

func (r *studioWorkspaceRegistry) create(name string) (StudioWorkspace, error) {
	r.mu.Lock()
	defer r.mu.Unlock()
	if len(r.items) >= maxStudioWorkspaces {
		return StudioWorkspace{}, fmt.Errorf("massimo %d workspace Go Studio", maxStudioWorkspaces)
	}
	trimmed, err := r.validateNameLocked(name, "")
	if err != nil {
		return StudioWorkspace{}, err
	}
	workspace := StudioWorkspace{ID: newID("workspace"), Name: trimmed, CreatedAt: time.Now().UTC()}
	r.items = append(r.items, workspace)
	return workspace, nil
}

func (r *studioWorkspaceRegistry) rename(id, name string) error {
	r.mu.Lock()
	defer r.mu.Unlock()
	index := r.indexLocked(id)
	if index < 0 {
		return fmt.Errorf("workspace Go Studio non trovato")
	}
	trimmed, err := r.validateNameLocked(name, id)
	if err != nil {
		return err
	}
	r.items[index].Name = trimmed
	return nil
}

func (r *studioWorkspaceRegistry) remove(id string) error {
	r.mu.Lock()
	defer r.mu.Unlock()
	if id == DefaultStudioWorkspaceID {
		return fmt.Errorf("il workspace predefinito non si può eliminare")
	}
	index := r.indexLocked(id)
	if index < 0 {
		return fmt.Errorf("workspace Go Studio non trovato")
	}
	r.items = append(r.items[:index], r.items[index+1:]...)
	if r.active == id {
		r.active = DefaultStudioWorkspaceID
	}
	return nil
}

func (r *studioWorkspaceRegistry) activate(id string) error {
	r.mu.Lock()
	defer r.mu.Unlock()
	if r.indexLocked(id) < 0 {
		return fmt.Errorf("workspace Go Studio non trovato")
	}
	r.active = id
	return nil
}

// ListStudioWorkspaces restituisce i workspace Go Studio e quello attivo.
func (s *Service) ListStudioWorkspaces() (StudioWorkspaces, error) {
	if err := s.restore(); err != nil {
		return StudioWorkspaces{}, err
	}
	return s.studioWorkspaces.state(), nil
}

// CreateStudioWorkspace crea un workspace Go Studio vuoto e lo rende attivo.
func (s *Service) CreateStudioWorkspace(name string) (StudioWorkspaces, error) {
	return s.changeStudioWorkspaces(func() error {
		workspace, err := s.studioWorkspaces.create(name)
		if err != nil {
			return err
		}
		return s.studioWorkspaces.activate(workspace.ID)
	})
}

// RenameStudioWorkspace rinomina un workspace Go Studio; i nomi sono unici senza distinzione di maiuscole.
func (s *Service) RenameStudioWorkspace(id, name string) (StudioWorkspaces, error) {
	return s.changeStudioWorkspaces(func() error { return s.studioWorkspaces.rename(id, name) })
}

// DeleteStudioWorkspace elimina un workspace vuoto: i progetti aperti vanno chiusi prima, con il loro flusso di salvataggio.
func (s *Service) DeleteStudioWorkspace(id string) (StudioWorkspaces, error) {
	return s.changeStudioWorkspaces(func() error {
		for _, session := range s.workspace.ListSessions() {
			if session.WorkspaceID == id {
				return fmt.Errorf("chiudi prima i progetti aperti in questo workspace")
			}
		}
		return s.studioWorkspaces.remove(id)
	})
}

// SetActiveStudioWorkspace cambia il workspace mostrato; le sessioni degli altri restano aperte e i loro processi continuano.
func (s *Service) SetActiveStudioWorkspace(id string) (StudioWorkspaces, error) {
	return s.changeStudioWorkspaces(func() error { return s.studioWorkspaces.activate(id) })
}

func (s *Service) changeStudioWorkspaces(change func() error) (StudioWorkspaces, error) {
	if err := s.restore(); err != nil {
		return StudioWorkspaces{}, err
	}
	if err := change(); err != nil {
		return StudioWorkspaces{}, err
	}
	if err := s.saveState(); err != nil {
		return StudioWorkspaces{}, err
	}
	state := s.studioWorkspaces.state()
	s.emit("workspaces.changed", "", "", state)
	return state, nil
}
