package run

import (
	"encoding/json"
	"fmt"
	"sort"
	"strings"
	"sync"
	"time"
)

const maxConfigurationsPerSession = 50

// Manager possiede le configurazioni Run salvate, isolate per sessione.
// I valori marcati come segreti non escono mai da questo processo verso la
// persistenza: vengono richiesti all'avvio e tenuti solo in memoria.
type Manager struct {
	mu        sync.RWMutex
	configs   map[SessionID][]Configuration
	counter   uint64
	normalize func(Configuration) (Configuration, error)
}

func NewManager(normalize func(Configuration) (Configuration, error)) *Manager {
	return &Manager{normalize: normalize, configs: make(map[SessionID][]Configuration)}
}

// List restituisce le configurazioni della sessione ordinate come le vede l'utente.
func (m *Manager) List(sessionID SessionID) []Configuration {
	m.mu.RLock()
	defer m.mu.RUnlock()
	return cloneConfigurations(m.configs[sessionID])
}

// Get restituisce una singola configurazione della sessione indicata.
func (m *Manager) Get(sessionID SessionID, id string) (Configuration, error) {
	m.mu.RLock()
	defer m.mu.RUnlock()
	for _, config := range m.configs[sessionID] {
		if config.ID == id {
			return cloneConfiguration(config), nil
		}
	}
	return Configuration{}, fmt.Errorf("configurazione %q non trovata nella sessione", id)
}

// Save crea o aggiorna una configurazione dopo averla validata.
func (m *Manager) Save(sessionID SessionID, config Configuration) (Configuration, error) {
	normalized, err := m.normalize(config)
	if err != nil {
		return Configuration{}, err
	}
	normalized.SessionID = sessionID
	now := time.Now().UTC()
	normalized.UpdatedAt = now

	m.mu.Lock()
	defer m.mu.Unlock()
	existing := m.configs[sessionID]
	for index, current := range existing {
		if current.ID == normalized.ID && normalized.ID != "" {
			normalized.CreatedAt = current.CreatedAt
			normalized.Order = current.Order
			existing[index] = normalized
			m.configs[sessionID] = existing
			return cloneConfiguration(normalized), nil
		}
	}
	if len(existing) >= maxConfigurationsPerSession {
		return Configuration{}, fmt.Errorf("massimo %d configurazioni per sessione", maxConfigurationsPerSession)
	}
	m.counter++
	normalized.ID = fmt.Sprintf("cfg-%d-%d", now.UnixNano(), m.counter)
	normalized.CreatedAt = now
	normalized.Order = len(existing)
	m.configs[sessionID] = append(existing, normalized)
	return cloneConfiguration(normalized), nil
}

// Duplicate crea una copia indipendente della configurazione indicata.
func (m *Manager) Duplicate(sessionID SessionID, id string) (Configuration, error) {
	source, err := m.Get(sessionID, id)
	if err != nil {
		return Configuration{}, err
	}
	source.ID = ""
	source.Name = uniqueName(m.List(sessionID), source.Name+" copy")
	return m.Save(sessionID, source)
}

// Rename cambia soltanto il nome visibile della configurazione.
func (m *Manager) Rename(sessionID SessionID, id, name string) (Configuration, error) {
	trimmed := strings.TrimSpace(name)
	if trimmed == "" {
		return Configuration{}, fmt.Errorf("il nome della configurazione non può essere vuoto")
	}
	m.mu.Lock()
	defer m.mu.Unlock()
	for index, config := range m.configs[sessionID] {
		if config.ID != id {
			continue
		}
		config.Name = trimmed
		config.UpdatedAt = time.Now().UTC()
		m.configs[sessionID][index] = config
		return cloneConfiguration(config), nil
	}
	return Configuration{}, fmt.Errorf("configurazione %q non trovata nella sessione", id)
}

// Reorder riordina le configurazioni secondo la sequenza di identificatori indicata.
func (m *Manager) Reorder(sessionID SessionID, ids []string) ([]Configuration, error) {
	m.mu.Lock()
	defer m.mu.Unlock()
	existing := m.configs[sessionID]
	position := make(map[string]int, len(ids))
	for index, id := range ids {
		position[id] = index
	}
	for _, config := range existing {
		if _, ok := position[config.ID]; !ok {
			return nil, fmt.Errorf("riordino incompleto: manca la configurazione %q", config.ID)
		}
	}
	for index, config := range existing {
		config.Order = position[config.ID]
		existing[index] = config
	}
	sort.SliceStable(existing, func(i, j int) bool { return existing[i].Order < existing[j].Order })
	// ids può contenere voci estranee o duplicate: l'ordine viene ricompattato
	// a 0..n-1 così che il prossimo Save non produca posizioni in conflitto.
	for index := range existing {
		existing[index].Order = index
	}
	m.configs[sessionID] = existing
	return cloneConfigurations(existing), nil
}

// Delete rimuove una configurazione e ricompatta l'ordinamento.
func (m *Manager) Delete(sessionID SessionID, id string) error {
	m.mu.Lock()
	defer m.mu.Unlock()
	existing := m.configs[sessionID]
	for index, config := range existing {
		if config.ID != id {
			continue
		}
		existing = append(existing[:index], existing[index+1:]...)
		for position := range existing {
			existing[position].Order = position
		}
		m.configs[sessionID] = existing
		return nil
	}
	return fmt.Errorf("configurazione %q non trovata nella sessione", id)
}

// CloseSession rilascia le configurazioni della sola sessione chiusa.
func (m *Manager) CloseSession(sessionID SessionID) {
	m.mu.Lock()
	delete(m.configs, sessionID)
	m.mu.Unlock()
}

// Replace ripristina le configurazioni persistite, scartando quelle non valide.
func (m *Manager) Replace(configs []Configuration) {
	m.mu.Lock()
	defer m.mu.Unlock()
	m.configs = make(map[SessionID][]Configuration)
	for _, config := range configs {
		if config.SessionID == "" || config.ID == "" {
			continue
		}
		normalized, err := m.normalize(config)
		if err != nil {
			continue
		}
		normalized.ID = config.ID
		normalized.SessionID = config.SessionID
		normalized.CreatedAt = config.CreatedAt
		normalized.UpdatedAt = config.UpdatedAt
		normalized.Order = config.Order
		m.configs[config.SessionID] = append(m.configs[config.SessionID], normalized)
	}
	for sessionID, configs := range m.configs {
		sort.SliceStable(configs, func(i, j int) bool { return configs[i].Order < configs[j].Order })
		m.configs[sessionID] = configs
	}
}

// Snapshot restituisce tutte le configurazioni in forma persistibile, senza valori segreti.
func (m *Manager) Snapshot() []Configuration {
	m.mu.RLock()
	defer m.mu.RUnlock()
	sessions := make([]SessionID, 0, len(m.configs))
	for sessionID := range m.configs {
		sessions = append(sessions, sessionID)
	}
	sort.Slice(sessions, func(i, j int) bool { return sessions[i] < sessions[j] })
	all := make([]Configuration, 0, len(m.configs))
	for _, sessionID := range sessions {
		for _, config := range m.configs[sessionID] {
			all = append(all, redactConfiguration(config))
		}
	}
	return all
}

func cloneConfiguration(config Configuration) Configuration {
	data, _ := json.Marshal(config)
	var cloned Configuration
	_ = json.Unmarshal(data, &cloned)
	return cloned
}
func cloneConfigurations(configs []Configuration) []Configuration {
	result := make([]Configuration, 0, len(configs))
	for _, config := range configs {
		result = append(result, cloneConfiguration(config))
	}
	return result
}
func redactConfiguration(config Configuration) Configuration {
	config = cloneConfiguration(config)
	for i, entry := range config.Environment {
		if entry.Secret {
			config.Environment[i].Value = ""
		}
	}
	for i, entry := range config.Docker.BuildArgs {
		if entry.Secret {
			config.Docker.BuildArgs[i].Value = ""
		}
	}
	return config
}
func uniqueName(existing []Configuration, candidate string) string {
	taken := make(map[string]struct{}, len(existing))
	for _, config := range existing {
		taken[config.Name] = struct{}{}
	}
	if _, clash := taken[candidate]; !clash {
		return candidate
	}
	for suffix := 2; suffix < 100; suffix++ {
		name := fmt.Sprintf("%s %d", candidate, suffix)
		if _, clash := taken[name]; !clash {
			return name
		}
	}
	return candidate
}

func (m *Manager) Import(sessionID SessionID, config Configuration) bool {
	normalized, err := m.normalize(config)
	if err != nil {
		return false
	}
	normalized.ID, normalized.SessionID, normalized.Shared = config.ID, sessionID, true
	m.mu.Lock()
	defer m.mu.Unlock()
	existing := m.configs[sessionID]
	for index, current := range existing {
		if current.ID != config.ID {
			continue
		}
		normalized.Pinned, normalized.RestartOnSave = current.Pinned, current.RestartOnSave
		normalized.Order, normalized.CreatedAt, normalized.UpdatedAt = current.Order, current.CreatedAt, current.UpdatedAt
		// I segreti non sono nel file: si tiene la versione locale senza perderli.
		if sameSharedContent(current, normalized) {
			return false
		}
		existing[index] = normalized
		return true
	}
	if len(existing) >= maxConfigurationsPerSession {
		return false
	}
	normalized.Order = len(existing)
	m.configs[sessionID] = append(existing, normalized)
	return true
}
func sameSharedContent(left, right Configuration) bool {
	a, _ := json.Marshal(redactConfiguration(left))
	b, _ := json.Marshal(redactConfiguration(right))
	return string(a) == string(b)
}
