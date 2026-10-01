package goide

import (
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"path/filepath"
	"runtime"
	"sort"
	"strings"
	"sync"
	"time"
)

const (
	// RecoverySchemaVersion versiona lo store di recupero separatamente dallo
	// stato di sessione: un buffer perso è meno grave di una sessione persa.
	RecoverySchemaVersion = 1
	// MaxRecoveredBufferBytes limita quanto può crescere un singolo buffer
	// tenuto nello store di recupero.
	MaxRecoveredBufferBytes = 4 * 1024 * 1024
	// MaxRecoveredBuffers limita il numero totale di buffer conservati.
	MaxRecoveredBuffers = 200
	// MaxRecoveredTotalBytes limita lo store intero, riscritto a ogni aggiornamento.
	MaxRecoveredTotalBytes = 32 * 1024 * 1024
	// recoverySnapshotsPerFile: l'ultima più le due precedenti, per tollerare una snapshot corrotta.
	recoverySnapshotsPerFile = 3
	// recoveryRetention: una snapshot mai recuperata né scartata sparisce dopo due settimane.
	recoveryRetention = 14 * 24 * time.Hour
)

// WorkspaceID è un hash stabile del percorso reale del progetto: il recupero resta del progetto
// anche se la sessione Go Studio viene chiusa e riaperta con un altro ID.
func WorkspaceID(realPath string) string {
	path := filepath.ToSlash(filepath.Clean(realPath))
	if caseInsensitivePaths {
		path = strings.ToLower(path)
	}
	sum := sha256.Sum256([]byte(path))
	return hex.EncodeToString(sum[:8])
}

// recoveredSnapshot è una versione precedente dello stesso buffer.
type recoveredSnapshot struct {
	Content      string    `json:"content"`
	SnapshotHash string    `json:"snapshotHash"`
	SavedAt      time.Time `json:"savedAt"`
}

func contentHash(content string) string {
	sum := sha256.Sum256([]byte(content))
	return hex.EncodeToString(sum[:])
}

type recoveredEntry struct {
	SessionID    SessionID `json:"sessionId"`
	RelativePath string    `json:"relativePath"`
	Content      string    `json:"content"`
	DiskToken    string    `json:"diskToken"`
	SavedAt      time.Time `json:"savedAt"`
	// SnapshotHash verifica che Content non sia corrotto; Previous tiene le versioni più vecchie.
	SnapshotHash string              `json:"snapshotHash,omitempty"`
	Previous     []recoveredSnapshot `json:"previous,omitempty"`
	WorkspaceID  string              `json:"workspaceId,omitempty"`
}

// verified restituisce l'ultima snapshot integra: se la più recente è corrotta ripiega sulle precedenti.
func (e recoveredEntry) verified() (recoveredEntry, bool) {
	if e.SnapshotHash == "" || contentHash(e.Content) == e.SnapshotHash {
		return e, true
	}
	for index, previous := range e.Previous {
		if contentHash(previous.Content) == previous.SnapshotHash {
			e.Content, e.SnapshotHash, e.SavedAt, e.Previous = previous.Content, previous.SnapshotHash, previous.SavedAt, e.Previous[index+1:]
			return e, true
		}
	}
	return e, false
}

func (e recoveredEntry) bytes() int {
	total := len(e.Content)
	for _, previous := range e.Previous {
		total += len(previous.Content)
	}
	return total
}

type recoveryState struct {
	Version int              `json:"version"`
	Buffers []recoveredEntry `json:"buffers"`
}

// RecoveryManager conserva i buffer non salvati fuori dal processo, così che un
// riavvio o un crash non li perda. Non riapplica mai niente da solo: espone i
// buffer trovati e attende un recupero esplicito dell'utente.
type RecoveryManager struct {
	mu         sync.Mutex
	store      Store
	buffers    map[string]recoveredEntry
	loaded     bool
	workspaces map[SessionID]string
}

func NewRecoveryManager(store Store) *RecoveryManager {
	return &RecoveryManager{store: store, buffers: make(map[string]recoveredEntry), workspaces: make(map[SessionID]string)}
}

// caseInsensitivePaths vale per i filesystem predefiniti di Windows e macOS.
// Su Linux Foo.go e foo.go sono file distinti e non devono condividere il
// buffer di recupero, altrimenti l'uno sovrascriverebbe l'altro.
var caseInsensitivePaths = runtime.GOOS == "windows" || runtime.GOOS == "darwin"

func recoveryKey(sessionID SessionID, relativePath string) string {
	path := filepath.ToSlash(filepath.Clean(relativePath))
	if caseInsensitivePaths {
		path = strings.ToLower(path)
	}
	return string(sessionID) + "\x00" + path
}

// Configure collega lo store persistente e ne carica il contenuto.
func (m *RecoveryManager) Configure(store Store) error {
	if store == nil {
		return errors.New("store di recupero non valido")
	}
	m.mu.Lock()
	m.store = store
	m.loaded = false
	m.mu.Unlock()
	return m.Load()
}

// Load legge lo store di recupero una sola volta; un errore di lettura resta
// ritentabile alla chiamata successiva.
func (m *RecoveryManager) Load() error {
	m.mu.Lock()
	defer m.mu.Unlock()
	if m.loaded || m.store == nil {
		return nil
	}
	data, err := m.store.Load()
	if err != nil {
		return fmt.Errorf("lettura buffer di recupero fallita: %w", err)
	}
	m.loaded = true
	if len(data) == 0 {
		return nil
	}
	var state recoveryState
	if err := json.Unmarshal(data, &state); err != nil {
		// Uno store di recupero illeggibile non deve impedire l'avvio: viene
		// scartato e ricostruito, perché contiene solo copie di lavoro.
		return nil
	}
	if state.Version > RecoverySchemaVersion {
		return nil
	}
	for _, entry := range state.Buffers {
		if entry.SessionID == "" || entry.RelativePath == "" {
			continue
		}
		valid, ok := entry.verified()
		if !ok || time.Since(valid.SavedAt) > recoveryRetention {
			continue
		}
		m.buffers[recoveryKey(entry.SessionID, entry.RelativePath)] = valid
	}
	return nil
}

// Remember registra il contenuto corrente di un buffer non salvato.
func (m *RecoveryManager) Remember(sessionID SessionID, relativePath, content, diskToken string) error {
	if sessionID == "" || strings.TrimSpace(relativePath) == "" {
		return fmt.Errorf("buffer di recupero senza sessione o percorso")
	}
	if len(content) > MaxRecoveredBufferBytes {
		return fmt.Errorf("buffer troppo grande per il recupero automatico (%d byte)", len(content))
	}
	m.mu.Lock()
	defer m.mu.Unlock()
	key := recoveryKey(sessionID, relativePath)
	previous, exists := m.buffers[key]
	if !exists && len(m.buffers) >= MaxRecoveredBuffers {
		return fmt.Errorf("troppi buffer in recupero: salva o chiudi qualche file")
	}
	history := []recoveredSnapshot(nil)
	if exists && previous.Content != content {
		history = append([]recoveredSnapshot{{Content: previous.Content, SnapshotHash: previous.SnapshotHash, SavedAt: previous.SavedAt}}, previous.Previous...)
		if len(history) > recoverySnapshotsPerFile-1 {
			history = history[:recoverySnapshotsPerFile-1]
		}
	} else if exists {
		history = previous.Previous
	}
	entry := recoveredEntry{
		SessionID: sessionID, RelativePath: relativePath, Content: content, DiskToken: diskToken,
		SavedAt: time.Now().UTC(), SnapshotHash: contentHash(content), Previous: history,
		WorkspaceID: m.workspaces[sessionID],
	}
	// Lo spazio serve prima all'ultima versione: le snapshot vecchie si sacrificano per farla entrare.
	for m.totalBytesLocked()-previous.bytes()+entry.bytes() > MaxRecoveredTotalBytes && len(entry.Previous) > 0 {
		entry.Previous = entry.Previous[:len(entry.Previous)-1]
	}
	if m.totalBytesLocked()-previous.bytes()+entry.bytes() > MaxRecoveredTotalBytes {
		return fmt.Errorf("spazio di recupero esaurito: salva qualche file per proteggere i nuovi buffer")
	}
	m.buffers[key] = entry
	return m.persistLocked()
}

// BindWorkspace lega la sessione al suo workspace e adotta i buffer lasciati dallo stesso
// progetto sotto una sessione precedente (chiusa e riaperta, o ricreata dopo un crash).
func (m *RecoveryManager) BindWorkspace(sessionID SessionID, workspaceID string) {
	m.mu.Lock()
	defer m.mu.Unlock()
	m.workspaces[sessionID] = workspaceID
	adopted := false
	for key, entry := range m.buffers {
		if entry.WorkspaceID != workspaceID || entry.SessionID == sessionID {
			continue
		}
		target := recoveryKey(sessionID, entry.RelativePath)
		if _, taken := m.buffers[target]; taken {
			continue
		}
		delete(m.buffers, key)
		entry.SessionID = sessionID
		m.buffers[target] = entry
		adopted = true
	}
	if adopted {
		_ = m.persistLocked()
	}
}

// Forget rimuove un buffer dal recupero, tipicamente dopo un salvataggio riuscito.
func (m *RecoveryManager) Forget(sessionID SessionID, relativePath string) error {
	m.mu.Lock()
	defer m.mu.Unlock()
	key := recoveryKey(sessionID, relativePath)
	if _, exists := m.buffers[key]; !exists {
		return nil
	}
	delete(m.buffers, key)
	return m.persistLocked()
}

// ForgetSession rimuove i buffer della sola sessione indicata.
func (m *RecoveryManager) ForgetSession(sessionID SessionID) error {
	m.mu.Lock()
	defer m.mu.Unlock()
	removed := false
	for key, entry := range m.buffers {
		if entry.SessionID == sessionID {
			delete(m.buffers, key)
			removed = true
		}
	}
	if !removed {
		return nil
	}
	return m.persistLocked()
}

// List restituisce i buffer recuperabili della sessione, dal più recente.
func (m *RecoveryManager) List(sessionID SessionID) []recoveredEntry {
	m.mu.Lock()
	defer m.mu.Unlock()
	entries := make([]recoveredEntry, 0, 4)
	for _, entry := range m.buffers {
		if entry.SessionID == sessionID {
			entries = append(entries, entry)
		}
	}
	sort.Slice(entries, func(i, j int) bool { return entries[i].SavedAt.After(entries[j].SavedAt) })
	return entries
}

func (m *RecoveryManager) totalBytesLocked() int {
	total := 0
	for _, entry := range m.buffers {
		total += entry.bytes()
	}
	return total
}

func (m *RecoveryManager) persistLocked() error {
	if m.store == nil {
		return nil
	}
	entries := make([]recoveredEntry, 0, len(m.buffers))
	for _, entry := range m.buffers {
		entries = append(entries, entry)
	}
	sort.Slice(entries, func(i, j int) bool { return entries[i].SavedAt.Before(entries[j].SavedAt) })
	data, err := json.Marshal(recoveryState{Version: RecoverySchemaVersion, Buffers: entries})
	if err != nil {
		return fmt.Errorf("serializzazione buffer di recupero fallita: %w", err)
	}
	return m.store.Save(data)
}
