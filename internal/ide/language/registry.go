package language

import (
	"context"
	"errors"
	"fmt"
	"regexp"
	"sync"

	"adomnia/internal/ide/project"
)

var idPattern = regexp.MustCompile(`^[a-z][a-z0-9+#._-]{0,31}$`)

// Registry conserva i linguaggi registrati. Non è globale: ogni servizio IDE ne ha uno proprio.
type Registry struct {
	mu        sync.RWMutex
	languages []Language
	byID      map[string]Language
}

func NewRegistry() *Registry {
	return &Registry{byID: make(map[string]Language)}
}

// Register aggiunge un linguaggio; ID non valido o duplicato è un errore di programmazione (fail-fast).
func (r *Registry) Register(l Language) error {
	if l == nil {
		return errors.New("linguaggio nullo")
	}
	id := l.ID()
	if !idPattern.MatchString(id) {
		return fmt.Errorf("ID linguaggio non valido: %q", id)
	}
	r.mu.Lock()
	defer r.mu.Unlock()
	if _, exists := r.byID[id]; exists {
		return fmt.Errorf("linguaggio %q già registrato", id)
	}
	r.byID[id] = l
	r.languages = append(r.languages, l)
	return nil
}

func (r *Registry) Get(id string) (Language, bool) {
	r.mu.RLock()
	defer r.mu.RUnlock()
	l, ok := r.byID[id]
	return l, ok
}

// Unregister removes an optional adapter. Built-in ownership is enforced by the host.
func (r *Registry) Unregister(id string) {
	r.mu.Lock()
	defer r.mu.Unlock()
	delete(r.byID, id)
	for i, adapter := range r.languages {
		if adapter.ID() == id {
			r.languages = append(r.languages[:i], r.languages[i+1:]...)
			break
		}
	}
}

// All restituisce i linguaggi in ordine di registrazione (deterministico per UI e test).
func (r *Registry) All() []Language {
	r.mu.RLock()
	defer r.mu.RUnlock()
	return append([]Language(nil), r.languages...)
}

// ForPath restituisce il linguaggio che possiede il file e il suo languageId LSP; il primo
// DocumentSelector registrato che lo riconosce vince.
func (r *Registry) ForPath(path string) (Language, string, bool) {
	for _, l := range r.All() {
		selector, ok := l.(DocumentSelector)
		if !ok {
			continue
		}
		if languageID, ok := selector.DocumentLanguageID(path); ok {
			return l, languageID, true
		}
	}
	return nil, "", false
}

// DetectUnits chiede a ogni ProjectDetector le unità sotto root. Un detector che fallisce non
// nasconde quelle degli altri: le unità trovate tornano comunque, gli errori sono uniti.
func (r *Registry) DetectUnits(ctx context.Context, root string) ([]project.Unit, error) {
	units := make([]project.Unit, 0, 4)
	var failures []error
	// ponytail: una scansione del disco per linguaggio; condividere un solo walk quando i detector saranno più d'uno.
	for _, l := range r.All() {
		detector, ok := l.(ProjectDetector)
		if !ok {
			continue
		}
		found, err := detector.DetectUnits(ctx, root)
		if err != nil {
			failures = append(failures, fmt.Errorf("%s: %w", l.ID(), err))
		}
		units = append(units, found...)
	}
	return units, errors.Join(failures...)
}
