// Package activity owns local visibility/idle policy. It never stops resources;
// owners consult its conservative allowlist and retain their own lifecycle guards.
package activity

import (
	"fmt"
	"slices"
	"sync"
	"time"
)

type State string

const (
	Active     State = "Active"
	Background State = "Background"
	Idle       State = "Idle"
	Suspended  State = "Suspended"
	IdleAfter        = 5 * time.Minute
)

type Resource struct {
	Kind          string
	Restorable    bool
	UserInitiated bool
}

// Only automatic language servers can currently be released. Adding a future
// resource requires an explicit decision here; unknown kinds are protected.
func MayRelease(resource Resource) bool {
	return resource.Kind == "language-server" && resource.Restorable && !resource.UserInitiated
}

type windowReport struct {
	state  State
	scopes []string
}
type trackedResource struct {
	scope    string
	released bool
}
type Snapshot struct {
	State  State            `json:"state"`
	Scopes map[string]State `json:"scopes"`
}
type Manager struct {
	mu           sync.Mutex
	windows      map[string]windowReport
	resources    map[string]trackedResource
	alive        func(string) bool
	listeners    map[uint64]func()
	nextListener uint64
}

var Default = NewManager()

func NewManager() *Manager {
	return &Manager{windows: map[string]windowReport{}, resources: map[string]trackedResource{}}
}

// SetWindowAlive is configured by the desktop binding before first use. The
// predicate must not call back into Manager. No heartbeat/polling is required.
func (m *Manager) SetWindowAlive(alive func(string) bool) {
	m.mu.Lock()
	defer m.mu.Unlock()
	m.alive = alive
}
func (m *Manager) Report(window string, state State, scopes []string) (Snapshot, error) {
	defer m.notify()
	if window == "" || len(window) > 128 || len(scopes) > 128 || (state != Active && state != Background && state != Idle) {
		return Snapshot{}, fmt.Errorf("invalid activity report")
	}
	for _, scope := range scopes {
		if scope == "" || len(scope) > 256 {
			return Snapshot{}, fmt.Errorf("invalid activity scope")
		}
	}
	m.mu.Lock()
	defer m.mu.Unlock()
	m.pruneLocked()
	if _, exists := m.windows[window]; !exists && len(m.windows) >= 128 {
		return Snapshot{}, fmt.Errorf("too many activity reporters")
	}
	m.windows[window] = windowReport{state: state, scopes: append([]string(nil), scopes...)}
	return m.snapshotLocked(), nil
}
func (m *Manager) RemoveWindow(window string) {
	defer m.notify()
	m.mu.Lock()
	defer m.mu.Unlock()
	delete(m.windows, window)
}
func (m *Manager) pruneLocked() {
	if m.alive != nil {
		for id := range m.windows {
			if !m.alive(id) {
				delete(m.windows, id)
			}
		}
	}
}

// Subscribe observes window activity outside the manager lock. Owners unsubscribe on shutdown.
func (m *Manager) Subscribe(listener func()) func() {
	m.mu.Lock()
	if m.listeners == nil {
		m.listeners = make(map[uint64]func())
	}
	m.nextListener++
	id := m.nextListener
	m.listeners[id] = listener
	m.mu.Unlock()
	return func() { m.mu.Lock(); delete(m.listeners, id); m.mu.Unlock() }
}

func (m *Manager) notify() {
	m.mu.Lock()
	listeners := make([]func(), 0, len(m.listeners))
	for _, listener := range m.listeners {
		listeners = append(listeners, listener)
	}
	m.mu.Unlock()
	for _, listener := range listeners {
		listener()
	}
}
func (m *Manager) baseStateLocked(scope string) State {
	state := Background
	for _, window := range m.windows {
		if scope != "" && !slices.Contains(window.scopes, scope) {
			continue
		}
		if window.state == Active {
			return Active
		}
		if window.state == Idle {
			state = Idle
		}
	}
	return state
}
func (m *Manager) stateLocked(scope string) State {
	state := m.baseStateLocked(scope)
	if state == Active {
		return state
	}
	count := 0
	for _, resource := range m.resources {
		if scope != "" && resource.scope != scope {
			continue
		}
		if !resource.released {
			return state
		}
		count++
	}
	if count > 0 {
		return Suspended
	}
	return state
}
func (m *Manager) State(scope string) State {
	m.mu.Lock()
	defer m.mu.Unlock()
	m.pruneLocked()
	return m.stateLocked(scope)
}
func (m *Manager) CanSuspend(scope string, resource Resource, ready bool) bool {
	return ready && MayRelease(resource) && m.State(scope) != Active
}
func (m *Manager) Track(id, scope string) {
	m.mu.Lock()
	defer m.mu.Unlock()
	m.resources[id] = trackedResource{scope: scope}
}
func (m *Manager) Released(id string) {
	m.mu.Lock()
	defer m.mu.Unlock()
	if r, ok := m.resources[id]; ok {
		r.released = true
		m.resources[id] = r
	}
}
func (m *Manager) Forget(id string) { m.mu.Lock(); defer m.mu.Unlock(); delete(m.resources, id) }
func (m *Manager) snapshotLocked() Snapshot {
	m.pruneLocked()
	scopes := map[string]State{}
	for _, window := range m.windows {
		for _, scope := range window.scopes {
			scopes[scope] = Background
		}
	}
	for _, resource := range m.resources {
		scopes[resource.scope] = Background
	}
	for scope := range scopes {
		scopes[scope] = m.stateLocked(scope)
	}
	return Snapshot{State: m.stateLocked(""), Scopes: scopes}
}
func (m *Manager) Snapshot() Snapshot { m.mu.Lock(); defer m.mu.Unlock(); return m.snapshotLocked() }
