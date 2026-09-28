package goide

import (
	"encoding/json"
	"fmt"
)

const PersistenceSchemaVersion = 2

type Store interface {
	Load() ([]byte, error)
	Save([]byte) error
}

type persistedState struct {
	Version  int             `json:"version"`
	Sessions []Session       `json:"sessions"`
	Recent   []RecentProject `json:"recent,omitempty"`
}

type Persistence struct {
	store Store
}

func NewPersistence(store Store) *Persistence {
	return &Persistence{store: store}
}

// LoadState carica lo schema persistito e migra in memoria le versioni precedenti.
func (p *Persistence) LoadState() (persistedState, error) {
	if p == nil || p.store == nil {
		return persistedState{Version: PersistenceSchemaVersion}, nil
	}
	data, err := p.store.Load()
	if err != nil || len(data) == 0 {
		return persistedState{Version: PersistenceSchemaVersion}, err
	}
	var state persistedState
	if err := json.Unmarshal(data, &state); err != nil {
		return persistedState{}, fmt.Errorf("stato Go Studio non valido: %w", err)
	}
	if state.Version > PersistenceSchemaVersion {
		return persistedState{}, fmt.Errorf("schema Go Studio %d non supportato", state.Version)
	}
	if state.Version < 2 && len(state.Recent) == 0 {
		for _, session := range state.Sessions {
			state.Recent = append(state.Recent, RecentProject{
				Name: session.Project.Name, RootPath: session.Project.RootPath,
				RealPath: session.Project.RealPath, Available: true, OpenedAt: session.UpdatedAt,
			})
		}
	}
	state.Version = PersistenceSchemaVersion
	return state, nil
}

// SaveState salva metadati di sessione e recenti senza contenuti dei file o credenziali.
func (p *Persistence) SaveState(sessions []Session, recent []RecentProject) error {
	if p == nil || p.store == nil {
		return nil
	}
	data, err := json.Marshal(persistedState{Version: PersistenceSchemaVersion, Sessions: sessions, Recent: recent})
	if err != nil {
		return fmt.Errorf("serializzazione stato Go Studio fallita: %w", err)
	}
	return p.store.Save(data)
}
