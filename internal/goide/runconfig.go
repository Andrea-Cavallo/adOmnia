package goide

import (
	"fmt"
	"sort"
	"strings"
	"sync"
	"time"
)

const maxRunConfigurationsPerSession = 50

// RunConfigManager possiede le configurazioni Run salvate, isolate per sessione.
// I valori marcati come segreti non escono mai da questo processo verso la
// persistenza: vengono richiesti all'avvio e tenuti solo in memoria.
type RunConfigManager struct {
	mu      sync.RWMutex
	configs map[SessionID][]RunConfiguration
	counter uint64
}

func NewRunConfigManager() *RunConfigManager {
	return &RunConfigManager{configs: make(map[SessionID][]RunConfiguration)}
}

// List restituisce le configurazioni della sessione ordinate come le vede l'utente.
func (m *RunConfigManager) List(sessionID SessionID) []RunConfiguration {
	m.mu.RLock()
	defer m.mu.RUnlock()
	return cloneConfigurations(m.configs[sessionID])
}

// Get restituisce una singola configurazione della sessione indicata.
func (m *RunConfigManager) Get(sessionID SessionID, id string) (RunConfiguration, error) {
	m.mu.RLock()
	defer m.mu.RUnlock()
	for _, config := range m.configs[sessionID] {
		if config.ID == id {
			return cloneConfiguration(config), nil
		}
	}
	return RunConfiguration{}, fmt.Errorf("configurazione %q non trovata nella sessione", id)
}

// Save crea o aggiorna una configurazione dopo averla validata.
func (m *RunConfigManager) Save(sessionID SessionID, config RunConfiguration) (RunConfiguration, error) {
	normalized, err := normalizeConfiguration(config)
	if err != nil {
		return RunConfiguration{}, err
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
	if len(existing) >= maxRunConfigurationsPerSession {
		return RunConfiguration{}, fmt.Errorf("massimo %d configurazioni per sessione", maxRunConfigurationsPerSession)
	}
	m.counter++
	normalized.ID = fmt.Sprintf("cfg-%d-%d", now.UnixNano(), m.counter)
	normalized.CreatedAt = now
	normalized.Order = len(existing)
	m.configs[sessionID] = append(existing, normalized)
	return cloneConfiguration(normalized), nil
}

// Duplicate crea una copia indipendente della configurazione indicata.
func (m *RunConfigManager) Duplicate(sessionID SessionID, id string) (RunConfiguration, error) {
	source, err := m.Get(sessionID, id)
	if err != nil {
		return RunConfiguration{}, err
	}
	source.ID = ""
	source.Name = uniqueName(m.List(sessionID), source.Name+" copy")
	return m.Save(sessionID, source)
}

// Rename cambia soltanto il nome visibile della configurazione.
func (m *RunConfigManager) Rename(sessionID SessionID, id, name string) (RunConfiguration, error) {
	trimmed := strings.TrimSpace(name)
	if trimmed == "" {
		return RunConfiguration{}, fmt.Errorf("il nome della configurazione non può essere vuoto")
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
	return RunConfiguration{}, fmt.Errorf("configurazione %q non trovata nella sessione", id)
}

// Reorder riordina le configurazioni secondo la sequenza di identificatori indicata.
func (m *RunConfigManager) Reorder(sessionID SessionID, ids []string) ([]RunConfiguration, error) {
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
	m.configs[sessionID] = existing
	return cloneConfigurations(existing), nil
}

// Delete rimuove una configurazione e ricompatta l'ordinamento.
func (m *RunConfigManager) Delete(sessionID SessionID, id string) error {
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
func (m *RunConfigManager) CloseSession(sessionID SessionID) {
	m.mu.Lock()
	delete(m.configs, sessionID)
	m.mu.Unlock()
}

// Replace ripristina le configurazioni persistite, scartando quelle non valide.
func (m *RunConfigManager) Replace(configs []RunConfiguration) {
	m.mu.Lock()
	defer m.mu.Unlock()
	m.configs = make(map[SessionID][]RunConfiguration)
	for _, config := range configs {
		if config.SessionID == "" || config.ID == "" {
			continue
		}
		normalized, err := normalizeConfiguration(config)
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
func (m *RunConfigManager) Snapshot() []RunConfiguration {
	m.mu.RLock()
	defer m.mu.RUnlock()
	sessions := make([]SessionID, 0, len(m.configs))
	for sessionID := range m.configs {
		sessions = append(sessions, sessionID)
	}
	sort.Slice(sessions, func(i, j int) bool { return sessions[i] < sessions[j] })
	all := make([]RunConfiguration, 0, len(m.configs))
	for _, sessionID := range sessions {
		for _, config := range m.configs[sessionID] {
			all = append(all, redactConfiguration(config))
		}
	}
	return all
}

// normalizeConfiguration valida e ripulisce una configurazione prima di salvarla o avviarla.
func normalizeConfiguration(config RunConfiguration) (RunConfiguration, error) {
	config.Name = strings.TrimSpace(config.Name)
	if config.Name == "" {
		return RunConfiguration{}, fmt.Errorf("il nome della configurazione non può essere vuoto")
	}
	if config.Kind == "" {
		config.Kind = RunKindPackage
	}
	switch config.Kind {
	case RunKindPackage, RunKindBuild, RunKindTest:
		config.Target = strings.TrimSpace(config.Target)
		if config.Target == "" {
			config.Target = "."
		}
		config.Files = nil
		config.BinaryPath = ""
	case RunKindFiles:
		files := make([]string, 0, len(config.Files))
		for _, file := range config.Files {
			trimmed := strings.TrimSpace(file)
			if trimmed == "" {
				continue
			}
			if !strings.HasSuffix(strings.ToLower(trimmed), ".go") {
				return RunConfiguration{}, fmt.Errorf("la lista file accetta solo sorgenti Go: %q", trimmed)
			}
			files = append(files, trimmed)
		}
		if len(files) == 0 {
			return RunConfiguration{}, fmt.Errorf("indica almeno un file Go da eseguire")
		}
		config.Files = files
		config.Target = ""
		config.BinaryPath = ""
	case RunKindBinary:
		config.BinaryPath = strings.TrimSpace(config.BinaryPath)
		if config.BinaryPath == "" {
			return RunConfiguration{}, fmt.Errorf("indica il binario compilato da eseguire")
		}
		config.Target = ""
		config.Files = nil
	default:
		return RunConfiguration{}, fmt.Errorf("tipo di configurazione %q non supportato", config.Kind)
	}
	config.WorkingDirectory = strings.TrimSpace(config.WorkingDirectory)
	config.GoArguments = trimArguments(config.GoArguments)
	config.ProgramArguments = trimArguments(config.ProgramArguments)
	config.BuildTags = trimArguments(config.BuildTags)

	seen := make(map[string]struct{}, len(config.Environment))
	environment := make([]EnvironmentEntry, 0, len(config.Environment))
	for _, entry := range config.Environment {
		key := strings.TrimSpace(entry.Key)
		if key == "" {
			continue
		}
		if strings.ContainsAny(key, "=\x00") {
			return RunConfiguration{}, fmt.Errorf("nome di variabile non valido: %q", key)
		}
		if _, duplicate := seen[key]; duplicate {
			return RunConfiguration{}, fmt.Errorf("variabile duplicata: %q", key)
		}
		seen[key] = struct{}{}
		environment = append(environment, EnvironmentEntry{Key: key, Value: entry.Value, Secret: entry.Secret})
	}
	config.Environment = environment
	return config, nil
}

// redactConfiguration azzera i valori segreti mantenendo le chiavi dichiarate.
// ponytail: i segreti restano richiesti a runtime; il passaggio a riferimenti
// vault veri va fatto quando Go Studio sarà collegato a internal/vault.
func redactConfiguration(config RunConfiguration) RunConfiguration {
	clone := cloneConfiguration(config)
	for index, entry := range clone.Environment {
		if entry.Secret {
			clone.Environment[index].Value = ""
		}
	}
	return clone
}

func cloneConfiguration(config RunConfiguration) RunConfiguration {
	clone := config
	clone.Files = append([]string(nil), config.Files...)
	clone.GoArguments = append([]string(nil), config.GoArguments...)
	clone.ProgramArguments = append([]string(nil), config.ProgramArguments...)
	clone.BuildTags = append([]string(nil), config.BuildTags...)
	clone.Environment = append([]EnvironmentEntry(nil), config.Environment...)
	return clone
}

func cloneConfigurations(configs []RunConfiguration) []RunConfiguration {
	clones := make([]RunConfiguration, 0, len(configs))
	for _, config := range configs {
		clones = append(clones, cloneConfiguration(config))
	}
	return clones
}

func trimArguments(values []string) []string {
	trimmed := make([]string, 0, len(values))
	for _, value := range values {
		if candidate := strings.TrimSpace(value); candidate != "" {
			trimmed = append(trimmed, candidate)
		}
	}
	return trimmed
}

func uniqueName(existing []RunConfiguration, candidate string) string {
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
