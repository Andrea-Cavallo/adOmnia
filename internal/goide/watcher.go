package goide

import (
	"errors"
	"io/fs"
	"os"
	"path/filepath"
	"sort"
	"sync"
	"sync/atomic"
	"time"

	"github.com/fsnotify/fsnotify"
)

const (
	// watchDebounce raggruppa le raffiche di eventi (salvataggi, git checkout) in una sola notifica.
	watchDebounce = 150 * time.Millisecond
	// watchMaxLatency evita che una raffica continua rimandi la notifica all'infinito.
	watchMaxLatency = time.Second
	// maxWatchedDirectories limita i watch per progetto: oltre, il progetto resta osservato solo in parte.
	maxWatchedDirectories = 4000
	// maxBatchPaths oltre questa soglia il batch diventa overflow: il frontend ricontrolla tutto.
	maxBatchPaths = 500
)

// DiskChangeKind segue workspace/didChangeWatchedFiles: 1 creato, 2 modificato, 3 eliminato.
type DiskChangeKind int

const (
	FileCreated DiskChangeKind = 1
	FileChanged DiskChangeKind = 2
	FileDeleted DiskChangeKind = 3
)

// DiskChange è un file del progetto cambiato su disco.
type DiskChange struct {
	Path         string         `json:"path"`
	RelativePath string         `json:"relativePath"`
	Kind         DiskChangeKind `json:"kind"`
}

// FilesChanged è il payload dell'evento files.changed: modifiche raggruppate, o overflow se troppe.
type FilesChanged struct {
	Changes  []DiskChange `json:"changes"`
	Overflow bool         `json:"overflow"`
	// Limited indica che il progetto supera il limite di cartelle osservate.
	Limited bool `json:"limited"`
}

// WatchManager osserva le cartelle dei progetti aperti, una sessione per watcher, senza mai eseguire nulla.
type WatchManager struct {
	mu       sync.Mutex
	sessions map[SessionID]*sessionWatch
	sink     func(SessionID, FilesChanged)
}

type sessionWatch struct {
	root     string
	watcher  *fsnotify.Watcher
	done     chan struct{}
	stopped  chan struct{}
	watched  atomic.Int64
	limited  atomic.Bool
	pending  map[string]DiskChangeKind
	overflow bool
}

func NewWatchManager(sink func(SessionID, FilesChanged)) *WatchManager {
	return &WatchManager{sessions: make(map[SessionID]*sessionWatch), sink: sink}
}

// Watch avvia l'osservazione del progetto se non è già attiva; è idempotente.
func (m *WatchManager) Watch(sessionID SessionID, root string) error {
	m.mu.Lock()
	defer m.mu.Unlock()
	if _, exists := m.sessions[sessionID]; exists {
		return nil
	}
	watcher, err := fsnotify.NewWatcher()
	if err != nil {
		return err
	}
	state := &sessionWatch{root: root, watcher: watcher, done: make(chan struct{}), stopped: make(chan struct{}), pending: map[string]DiskChangeKind{}}
	state.addTree(root)
	m.sessions[sessionID] = state
	go m.run(sessionID, state)
	return nil
}

// Stop ferma l'osservazione della sessione e attende la fine del goroutine.
func (m *WatchManager) Stop(sessionID SessionID) {
	m.mu.Lock()
	state, ok := m.sessions[sessionID]
	delete(m.sessions, sessionID)
	m.mu.Unlock()
	if !ok {
		return
	}
	close(state.done)
	<-state.stopped
}

// Shutdown ferma tutti i watcher.
func (m *WatchManager) Shutdown() {
	m.mu.Lock()
	ids := make([]SessionID, 0, len(m.sessions))
	for id := range m.sessions {
		ids = append(ids, id)
	}
	m.mu.Unlock()
	for _, id := range ids {
		m.Stop(id)
	}
}

// Watching indica se la sessione è osservata (per i test e la diagnostica).
func (m *WatchManager) Watching(sessionID SessionID) bool {
	m.mu.Lock()
	defer m.mu.Unlock()
	_, ok := m.sessions[sessionID]
	return ok
}

// addTree aggiunge la cartella e le sottocartelle non ignorate, fino al limite.
func (w *sessionWatch) addTree(root string) {
	_ = filepath.WalkDir(root, func(path string, entry fs.DirEntry, err error) error {
		if err != nil || !entry.IsDir() {
			return nil
		}
		if path != w.root && isIgnoredDirectory(entry.Name()) {
			return filepath.SkipDir
		}
		if w.watched.Load() >= maxWatchedDirectories {
			w.limited.Store(true)
			return filepath.SkipAll
		}
		if w.watcher.Add(path) == nil {
			w.watched.Add(1)
		}
		return nil
	})
}

func (m *WatchManager) run(sessionID SessionID, state *sessionWatch) {
	defer close(state.stopped)
	defer state.watcher.Close()
	var debounce, deadline <-chan time.Time
	flush := func() {
		debounce, deadline = nil, nil
		batch := state.drain()
		if (len(batch.Changes) > 0 || batch.Overflow) && m.sink != nil {
			m.sink(sessionID, batch)
		}
	}
	for {
		select {
		case <-state.done:
			return
		case event, ok := <-state.watcher.Events:
			if !ok {
				return
			}
			state.record(event)
			debounce = time.After(watchDebounce)
			if deadline == nil {
				deadline = time.After(watchMaxLatency)
			}
		case err, ok := <-state.watcher.Errors:
			if !ok {
				return
			}
			if errors.Is(err, fsnotify.ErrEventOverflow) {
				state.overflow = true
				debounce = time.After(watchDebounce)
			}
		case <-debounce:
			flush()
		case <-deadline:
			flush()
		}
	}
}

// record accumula l'evento; le cartelle nuove entrano subito nell'osservazione.
func (w *sessionWatch) record(event fsnotify.Event) {
	kind := FileChanged
	switch {
	case event.Has(fsnotify.Create):
		kind = FileCreated
		if info, err := os.Stat(event.Name); err == nil && info.IsDir() && !isIgnoredDirectory(info.Name()) {
			w.addTree(event.Name)
		}
	case event.Has(fsnotify.Remove), event.Has(fsnotify.Rename):
		kind = FileDeleted
	case event.Has(fsnotify.Chmod):
		return
	}
	if w.overflow {
		return
	}
	if previous, seen := w.pending[event.Name]; seen && previous == FileCreated {
		// Creato e sparito nella stessa finestra (file temporanei dei salvataggi atomici): nessuna notizia.
		if kind == FileDeleted {
			delete(w.pending, event.Name)
			return
		}
		kind = FileCreated
	}
	w.pending[event.Name] = kind
	if len(w.pending) > maxBatchPaths {
		w.overflow = true
		w.pending = map[string]DiskChangeKind{}
	}
}

func (w *sessionWatch) drain() FilesChanged {
	batch := FilesChanged{Changes: make([]DiskChange, 0, len(w.pending)), Overflow: w.overflow, Limited: w.limited.Load()}
	for path, kind := range w.pending {
		relative := relativeWithin(w.root, path)
		if relative == "" {
			continue
		}
		batch.Changes = append(batch.Changes, DiskChange{Path: path, RelativePath: relative, Kind: kind})
	}
	sort.Slice(batch.Changes, func(left, right int) bool {
		return batch.Changes[left].RelativePath < batch.Changes[right].RelativePath
	})
	w.pending = map[string]DiskChangeKind{}
	w.overflow = false
	return batch
}

// WatcherStatus descrive quanto del progetto è osservato: oltre il limite le modifiche esterne possono sfuggire.
type WatcherStatus struct {
	Watching    bool `json:"watching"`
	Directories int  `json:"directories"`
	Limited     bool `json:"limited"`
	Limit       int  `json:"limit"`
}

// Status restituisce lo stato dell'osservazione della sessione.
func (m *WatchManager) Status(sessionID SessionID) WatcherStatus {
	m.mu.Lock()
	state := m.sessions[sessionID]
	m.mu.Unlock()
	if state == nil {
		return WatcherStatus{Limit: maxWatchedDirectories}
	}
	return WatcherStatus{Watching: true, Directories: int(state.watched.Load()), Limited: state.limited.Load(), Limit: maxWatchedDirectories}
}
