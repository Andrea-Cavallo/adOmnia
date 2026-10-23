package process

import (
	"adomnia/internal/jsonutil"
	"encoding/json/v2"
	"os"
	"path/filepath"
	"runtime"
	"strings"
	"sync"
)

// Registro locale dei processi figli gestiti da adOmnia (gopls, debug adapter).
// Un crash dell'applicazione li lascia vivi e nessuno li riconduce: all'avvio lo
// sweep termina i figli registrati da un'istanza precedente che sono ancora in
// vita (REFACTOR.md voci 2 e 14).
//
// L'identità del figlio è (PID, nome eseguibile): se il PID è stato riassegnato
// dal sistema a un processo con un nome diverso, lo sweep lo lascia in pace.

// ManagedChild è un processo figlio registrato all'avvio.
type ManagedChild struct {
	PID  int    `json:"pid"`
	Name string `json:"name"`
}

// Registry persiste l'elenco dei figli gestiti in un piccolo file JSON.
type Registry struct {
	mu       sync.Mutex
	path     string
	children []ManagedChild
}

// OpenRegistry carica il registro dal file (assente = nessun figlio noto).
func OpenRegistry(path string) *Registry {
	registry := &Registry{path: path}
	data, err := os.ReadFile(path)
	if err != nil {
		return registry
	}
	var stored struct {
		Children []ManagedChild `json:"children"`
	}
	if json.Unmarshal(data, &stored) == nil {
		registry.children = stored.Children
	}
	return registry
}

// Add registra un figlio e salva il registro.
func (r *Registry) Add(pid int, name string) {
	if r == nil || pid <= 0 {
		return
	}
	r.mu.Lock()
	defer r.mu.Unlock()
	for _, child := range r.children {
		if child.PID == pid {
			return
		}
	}
	r.children = append(r.children, ManagedChild{PID: pid, Name: name})
	r.saveLocked()
}

// Remove dimentica un figlio terminato.
func (r *Registry) Remove(pid int) {
	if r == nil {
		return
	}
	r.mu.Lock()
	defer r.mu.Unlock()
	for index, child := range r.children {
		if child.PID == pid {
			r.children = append(r.children[:index], r.children[index+1:]...)
			r.saveLocked()
			return
		}
	}
}

// Children restituisce una copia dei figli registrati.
func (r *Registry) Children() []ManagedChild {
	if r == nil {
		return nil
	}
	r.mu.Lock()
	defer r.mu.Unlock()
	return append([]ManagedChild(nil), r.children...)
}

// Sweep termina i figli di un'istanza precedente ancora in vita e dimentica
// tutti i figli registrati (vivi o morti: l'applicazione corrente non li possiede).
// Ritorna i figli effettivamente terminati.
func (r *Registry) Sweep() []ManagedChild {
	if r == nil {
		return nil
	}
	killed := sweepManagedChildren(r.Children(), lookupProcess, TerminateTreeByPID)
	r.mu.Lock()
	r.children = nil
	r.saveLocked()
	r.mu.Unlock()
	return killed
}

// sweepManagedChildren è la logica pura dello sweep: un figlio viene terminato
// solo se è vivo e il nome del processo coincide con quello registrato all'avvio.
func sweepManagedChildren(children []ManagedChild, lookup func(pid int) (string, bool), kill func(pid int) error) []ManagedChild {
	var killed []ManagedChild
	for _, child := range children {
		name, alive := lookup(child.PID)
		if !alive || !sameProcessName(child.Name, name) {
			continue
		}
		if err := kill(child.PID); err == nil {
			killed = append(killed, child)
		}
	}
	return killed
}

// sameProcessName confronta i nomi degli eseguibili: su Windows i nomi hanno
// ".exe" e il confronto non è case-sensitive.
func sameProcessName(expected, actual string) bool {
	normalize := func(value string) string {
		value = strings.ToLower(filepath.Base(value))
		if runtime.GOOS == "windows" {
			value = strings.TrimSuffix(value, ".exe")
		}
		return value
	}
	return normalize(expected) != "" && normalize(expected) == normalize(actual)
}

func (r *Registry) saveLocked() {
	data, err := jsonutil.Marshal(struct {
		Children []ManagedChild `json:"children"`
	}{Children: r.children})
	if err != nil || r.path == "" {
		return
	}
	if len(r.children) == 0 {
		_ = os.Remove(r.path)
		return
	}
	_ = os.WriteFile(r.path, data, 0o600)
}

var (
	managedMu       sync.Mutex
	managedRegistry *Registry
)

// SetManagedRegistry installa il registro condiviso (una sola volta, all'avvio).
// Senza registro le funzioni di registrazione sono no-op: i test restano isolati.
func SetManagedRegistry(registry *Registry) {
	managedMu.Lock()
	defer managedMu.Unlock()
	managedRegistry = registry
}

// RegisterManagedChild registra un figlio appena avviato (gopls, debug adapter).
func RegisterManagedChild(pid int, name string) {
	managedMu.Lock()
	registry := managedRegistry
	managedMu.Unlock()
	if registry != nil && pid > 0 {
		// Best effort: registry sweep remains available if OS containment is denied.
		containManagedChild(pid)
	}
	registry.Add(pid, name)
}

// ReleaseManagedChild dimentica un figlio terminato correttamente.
func ReleaseManagedChild(pid int) {
	managedMu.Lock()
	registry := managedRegistry
	managedMu.Unlock()
	registry.Remove(pid)
}
