// Package flight unifica le chiamate concorrenti equivalenti: finché una è in corso, chi chiede la stessa chiave
// attende e riceve lo stesso risultato invece di rilanciare il lavoro (es. `go list` identici).
package flight

import "sync"

// Group deduplica per chiave. Il valore zero è pronto all'uso.
type Group[T any] struct {
	mu    sync.Mutex
	calls map[string]*call[T]
}

type call[T any] struct {
	done  chan struct{}
	value T
	err   error
}

// Do esegue fn una sola volta per chiave alla volta; i chiamanti concorrenti condividono valore ed errore.
// Una volta terminata, la chiave si libera: la chiamata successiva rilancia fn (la cache è a carico del chiamante).
func (g *Group[T]) Do(key string, fn func() (T, error)) (T, error) {
	g.mu.Lock()
	if g.calls == nil {
		g.calls = map[string]*call[T]{}
	}
	if running, ok := g.calls[key]; ok {
		g.mu.Unlock()
		<-running.done
		return running.value, running.err
	}
	current := &call[T]{done: make(chan struct{})}
	g.calls[key] = current
	g.mu.Unlock()

	defer func() {
		g.mu.Lock()
		delete(g.calls, key)
		g.mu.Unlock()
		close(current.done)
	}()
	current.value, current.err = fn()
	return current.value, current.err
}
