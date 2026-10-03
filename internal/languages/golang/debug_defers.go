package golang

import (
	"fmt"
	"regexp"
	"strings"
)

// deferWrapperSuffix toglie il wrapper generato dal compilatore (main.f.deferwrap1 → main.f).
var deferWrapperSuffix = regexp.MustCompile(`\.deferwrap\d+$`)

// maxPendingDefers limita la catena letta dal runtime (ogni defer costa qualche richiesta DAP).
const maxPendingDefers = 32

// PendingDefer è un defer registrato a runtime e non ancora eseguito.
type PendingDefer struct {
	// Order è la posizione di esecuzione: 1 parte per primo al ritorno o durante un panic.
	Order int `json:"order"`
	// Location è la riga dell'istruzione defer; Location.Name è la funzione che l'ha registrato.
	Location   *DebugFrame `json:"location,omitempty"`
	SourceLine string      `json:"sourceLine,omitempty"`
	// Wrapper è la funzione che il runtime chiamerà (per Go ≥ 1.18 un wrapper come main.f.deferwrap1).
	Wrapper string `json:"wrapper,omitempty"`
}

// PendingDefers legge la catena runtime.curg._defer della goroutine: i defer davvero registrati,
// nell'ordine in cui verranno eseguiti. Nei build di debug (-N -l, quelli di dlv debug/test) i
// defer open-coded sono disattivati, quindi la catena è completa; in un binario ottimizzato
// (attach, remote) i defer open-coded non compaiono.
func (m *DebugExtensions) PendingDefers(id DebugSessionID, threadID int) ([]PendingDefer, error) {
	frames, err := m.StackTraceLimit(id, threadID, 1)
	if err != nil {
		return nil, err
	}
	if len(frames) == 0 {
		return nil, fmt.Errorf("la goroutine non ha frame da cui leggere il runtime")
	}
	frameID := frames[0].ID
	sources := newSourceLineCache()
	defers := []PendingDefer{}
	expression := "runtime.curg._defer"
	for len(defers) < maxPendingDefers {
		empty, err := m.Evaluate(id, expression+" == nil", frameID, "watch")
		if err != nil {
			return nil, fmt.Errorf("catena dei defer non leggibile: %w", err)
		}
		if strings.TrimSpace(empty.Result) != "false" {
			break
		}
		entry := PendingDefer{Order: len(defers) + 1}
		if wrapper, err := m.Evaluate(id, expression+".fn", frameID, "watch"); err == nil {
			entry.Wrapper = strings.TrimSpace(wrapper.Result)
		}
		if pc, err := m.evaluateUint(id, expression+".pc", frameID); err == nil && pc != 0 {
			if location, err := m.callSiteBefore(id, pc); err == nil && location != nil {
				entry.Location = location
				if location.Path != "" {
					entry.SourceLine = strings.TrimSpace(sources.line(location.Path, location.Line))
				}
			}
		}
		if entry.Location != nil && entry.Location.Name == "" {
			entry.Location.Name = deferWrapperSuffix.ReplaceAllString(entry.Wrapper, "")
		}
		defers = append(defers, entry)
		expression += ".link"
	}
	return defers, nil
}

// DebugPendingDefers restituisce i defer registrati a runtime dalla goroutine, in ordine di esecuzione.
