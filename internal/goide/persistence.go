package goide

import (
	"encoding/json"
	"fmt"
)

const PersistenceSchemaVersion = 1

type Store interface {
	Load() ([]byte, error)
	Save([]byte) error
}

type persistedState struct {
	Version  int       `json:"version"`
	Sessions []Session `json:"sessions"`
}

type Persistence struct {
	store Store
}

func NewPersistence(store Store) *Persistence {
	return &Persistence{store: store}
}

// LoadSessions carica lo schema persistito e rifiuta versioni future non supportate.
func (p *Persistence) LoadSessions() ([]Session, error) {
	if p == nil || p.store == nil {
		return nil, nil
	}
	data, err := p.store.Load()
	if err != nil || len(data) == 0 {
		return nil, err
	}
	var state persistedState
	if err := json.Unmarshal(data, &state); err != nil {
		return nil, fmt.Errorf("stato Go Studio non valido: %w", err)
	}
	if state.Version > PersistenceSchemaVersion {
		return nil, fmt.Errorf("schema Go Studio %d non supportato", state.Version)
	}
	return state.Sessions, nil
}

// SaveSessions salva metadati di sessione versionati senza contenuti dei file o credenziali.
func (p *Persistence) SaveSessions(sessions []Session) error {
	if p == nil || p.store == nil {
		return nil
	}
	data, err := json.Marshal(persistedState{Version: PersistenceSchemaVersion, Sessions: sessions})
	if err != nil {
		return fmt.Errorf("serializzazione stato Go Studio fallita: %w", err)
	}
	return p.store.Save(data)
}
