package goide

import (
	"encoding/json"
	"fmt"
)

const PersistenceSchemaVersion = 4

type Store interface {
	Load() ([]byte, error)
	Save([]byte) error
}

type persistedState struct {
	Version    int                       `json:"version"`
	Sessions   []Session                 `json:"sessions"`
	Recent     []RecentProject           `json:"recent,omitempty"`
	RunConfigs []RunConfiguration        `json:"runConfigs,omitempty"`
	SessionUI  map[SessionID]SessionView `json:"sessionUi,omitempty"`
	// Workspaces e ActiveWorkspace arrivano con lo schema 4; gli schemi precedenti migrano nel workspace predefinito.
	Workspaces      []StudioWorkspace `json:"workspaces,omitempty"`
	ActiveWorkspace string            `json:"activeWorkspace,omitempty"`
	// Toolchains e GlobalToolchain sono campi opzionali: gli stati precedenti restano validi senza migrazione.
	Toolchains      map[SessionID]ToolchainConfiguration `json:"toolchains,omitempty"`
	GlobalToolchain *ToolchainConfiguration              `json:"globalToolchain,omitempty"`
	// DetectedToolchains è la cache dell'ultimo rilevamento riuscito: al riavvio l'SDK è subito disponibile.
	DetectedToolchains map[SessionID]ToolchainInfo `json:"detectedToolchains,omitempty"`
	// TrustedPaths: cartelle (percorso reale) già autorizzate; riaprirle non richiede un nuovo consenso.
	TrustedPaths []string `json:"trustedPaths,omitempty"`
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
	if err != nil {
		return persistedState{}, fmt.Errorf("lettura stato Go Studio fallita: %w", err)
	}
	empty := persistedState{Version: PersistenceSchemaVersion, SessionUI: make(map[SessionID]SessionView)}
	if len(data) == 0 {
		return empty, nil
	}
	var state persistedState
	if err := json.Unmarshal(data, &state); err != nil {
		// Lo stato contiene solo metadati (sessioni, recenti, layout): uno
		// store illeggibile non deve rendere Go Studio inutilizzabile per
		// sempre. Si riparte vuoti e il primo salvataggio lo ricostruisce.
		return empty, nil
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
	if state.SessionUI == nil {
		state.SessionUI = make(map[SessionID]SessionView)
	}
	state.Version = PersistenceSchemaVersion
	return state, nil
}

// SaveState salva metadati di sessione, recenti, configurazioni Run e layout,
// senza contenuti dei file, valori segreti o credenziali.
func (p *Persistence) SaveState(snapshot persistedState) error {
	if p == nil || p.store == nil {
		return nil
	}
	snapshot.Version = PersistenceSchemaVersion
	data, err := json.Marshal(snapshot)
	if err != nil {
		return fmt.Errorf("serializzazione stato Go Studio fallita: %w", err)
	}
	return p.store.Save(data)
}
