package goide

import (
	"encoding/json"
	"fmt"
	"sort"
	"sync"
	"time"
)

// Restart policy di una configurazione Run dopo un crash di adOmnia.
const (
	RestartPolicyPrompt = "prompt" // predefinita: si propone il rilancio, l'utente conferma
	RestartPolicyNever  = "never"  // mai rilanciata (migration, script con effetti collaterali)
	RestartPolicyAlways = "always" // rilanciata da sola, solo se l'utente l'ha scelto per quella configurazione
)

func normalizeRestartPolicy(policy string) (string, error) {
	switch policy {
	case "", RestartPolicyPrompt:
		return "", nil
	case RestartPolicyNever, RestartPolicyAlways:
		return policy, nil
	default:
		return "", fmt.Errorf("restart policy non valida: %q (prompt, never, always)", policy)
	}
}

// ProcessDescriptor è il minimo per riconoscere e rilanciare un'esecuzione interrotta da un crash.
// Non contiene segreti: il rilancio passa dalla configurazione, che li richiede di nuovo.
type ProcessDescriptor struct {
	RunID            RunID     `json:"runId"`
	SessionID        SessionID `json:"sessionId"`
	ConfigID         string    `json:"configId"`
	ConfigName       string    `json:"configName"`
	Kind             string    `json:"kind"`
	Command          string    `json:"command"`
	WorkingDirectory string    `json:"workingDirectory"`
	RestartPolicy    string    `json:"restartPolicy"`
	StartedAt        time.Time `json:"startedAt"`
}

type supervisorState struct {
	Version int                 `json:"version"`
	Running []ProcessDescriptor `json:"running"`
}

// ProcessSupervisor tiene, fuori dalla UI e su disco, l'elenco delle esecuzioni avviate dalle
// configurazioni. Una chiusura pulita lo svuota: ciò che resta all'avvio è stato interrotto da un crash.
type ProcessSupervisor struct {
	mu          sync.Mutex
	store       Store
	running     map[RunID]ProcessDescriptor
	interrupted []ProcessDescriptor
}

func NewProcessSupervisor() *ProcessSupervisor {
	return &ProcessSupervisor{running: make(map[RunID]ProcessDescriptor)}
}

// Configure collega lo store e raccoglie le esecuzioni rimaste dall'avvio precedente.
func (p *ProcessSupervisor) Configure(store Store) error {
	p.mu.Lock()
	defer p.mu.Unlock()
	p.store = store
	data, err := store.Load()
	if err != nil {
		return fmt.Errorf("lettura del supervisore fallita: %w", err)
	}
	var state supervisorState
	if len(data) > 0 && json.Unmarshal(data, &state) == nil {
		p.interrupted = append([]ProcessDescriptor(nil), state.Running...)
		sort.Slice(p.interrupted, func(i, j int) bool { return p.interrupted[i].StartedAt.Before(p.interrupted[j].StartedAt) })
	}
	return p.persistLocked()
}

// Track registra un'esecuzione partita da una configurazione salvata.
func (p *ProcessSupervisor) Track(descriptor ProcessDescriptor) {
	p.mu.Lock()
	defer p.mu.Unlock()
	p.running[descriptor.RunID] = descriptor
	_ = p.persistLocked()
}

// Finish toglie un'esecuzione terminata (da sola, con Stop o con lo shutdown pulito).
func (p *ProcessSupervisor) Finish(runID RunID) {
	p.mu.Lock()
	defer p.mu.Unlock()
	if _, ok := p.running[runID]; !ok {
		return
	}
	delete(p.running, runID)
	_ = p.persistLocked()
}

// Clear segna la chiusura pulita: nessuna esecuzione risulterà interrotta al prossimo avvio.
func (p *ProcessSupervisor) Clear() {
	p.mu.Lock()
	defer p.mu.Unlock()
	p.running = make(map[RunID]ProcessDescriptor)
	_ = p.persistLocked()
}

// Interrupted elenca le esecuzioni ancora in corso quando adOmnia si è chiusa in modo anomalo.
func (p *ProcessSupervisor) Interrupted() []ProcessDescriptor {
	p.mu.Lock()
	defer p.mu.Unlock()
	return append([]ProcessDescriptor(nil), p.interrupted...)
}

// Dismiss toglie un'esecuzione interrotta dalla proposta (rilanciata o ignorata dall'utente).
func (p *ProcessSupervisor) Dismiss(runID RunID) {
	p.mu.Lock()
	defer p.mu.Unlock()
	kept := p.interrupted[:0]
	for _, descriptor := range p.interrupted {
		if descriptor.RunID != runID {
			kept = append(kept, descriptor)
		}
	}
	p.interrupted = kept
}

func (p *ProcessSupervisor) persistLocked() error {
	if p.store == nil {
		return nil
	}
	running := make([]ProcessDescriptor, 0, len(p.running))
	for _, descriptor := range p.running {
		running = append(running, descriptor)
	}
	sort.Slice(running, func(i, j int) bool { return running[i].StartedAt.Before(running[j].StartedAt) })
	data, err := json.Marshal(supervisorState{Version: 1, Running: running})
	if err != nil {
		return err
	}
	return p.store.Save(data)
}

// ConfigureSupervisorStore collega il supervisore dei processi allo store persistente.
func (s *Service) ConfigureSupervisorStore(store Store) error {
	return s.supervisor.Configure(store)
}

// InterruptedProcesses elenca le esecuzioni interrotte dal crash dell'avvio precedente.
func (s *Service) InterruptedProcesses() []ProcessDescriptor {
	return s.supervisor.Interrupted()
}

// DismissInterruptedProcess chiude la proposta di rilancio per un'esecuzione.
func (s *Service) DismissInterruptedProcess(runID string) {
	s.supervisor.Dismiss(RunID(runID))
}

func (s *Service) trackConfiguredRun(config RunConfiguration, execution Execution) {
	s.supervisor.Track(ProcessDescriptor{
		RunID: execution.ID, SessionID: execution.SessionID, ConfigID: config.ID, ConfigName: config.Name,
		Kind: string(config.Kind), Command: execution.Command, WorkingDirectory: execution.WorkingDirectory,
		RestartPolicy: config.RestartPolicy, StartedAt: execution.StartedAt,
	})
}
