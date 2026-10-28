package language

import (
	"context"
	"errors"
	"fmt"
	"regexp"
	"sync"

	"github.com/Andrea-Cavallo/adOmnia/internal/ide/project"
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
		return fmt.Errorf("invalid language ID: %q", id)
	}
	r.mu.Lock()
	defer r.mu.Unlock()
	if _, exists := r.byID[id]; exists {
		return fmt.Errorf("language %q is already registered", id)
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
// I linguaggi che implementano UnitScanner condividono una sola scansione del
// disco invece di camminare l'albero una volta ciascuno; l'ordine delle unità
// resta quello di registrazione dei linguaggi.
func (r *Registry) DetectUnits(ctx context.Context, root string) ([]project.Unit, error) {
	type detection struct {
		id    string
		units []project.Unit
		err   error
	}
	detections := make([]detection, 0, 4)
	scannerSlots := make([]int, 0, 2)
	scannerIDs := make([]string, 0, 2)
	visitors := make([]project.UnitsVisitor, 0, 2)
	for _, l := range r.All() {
		if scanner, ok := l.(UnitScanner); ok {
			visitors = append(visitors, scanner.NewUnitsVisitor(root))
			scannerSlots = append(scannerSlots, len(detections))
			scannerIDs = append(scannerIDs, l.ID())
			detections = append(detections, detection{id: l.ID()})
			continue
		}
		if detector, ok := l.(ProjectDetector); ok {
			found, err := detector.DetectUnits(ctx, root)
			detections = append(detections, detection{id: l.ID(), units: found, err: err})
		}
	}
	if len(visitors) > 0 {
		shared := make([]project.DirectoryVisitor, len(visitors))
		for index, visitor := range visitors {
			shared[index] = visitor
		}
		walkErr := project.WalkDirectories(ctx, root, project.MaxScanDirectories, shared...)
		for index, visitor := range visitors {
			found, err := visitor.Units()
			detections[scannerSlots[index]] = detection{id: scannerIDs[index], units: found, err: err}
		}
		if walkErr != nil {
			detections = append(detections, detection{id: "walk", err: walkErr})
		}
	}
	units := make([]project.Unit, 0, 4)
	var failures []error
	for _, found := range detections {
		if found.err != nil {
			failures = append(failures, fmt.Errorf("%s: %w", found.id, found.err))
		}
		units = append(units, found.units...)
	}
	return units, errors.Join(failures...)
}
