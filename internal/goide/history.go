package goide

import (
	"encoding/json"
	"fmt"
	"path"
	"sort"
	"strings"
	"sync"
	"time"
)

const (
	historySchemaVersion      = 1
	maxHistoryRevisionsByFile = 20
	maxHistoryRevisionBytes   = 2 * 1024 * 1024
	maxHistoryTotalBytes      = 32 * 1024 * 1024
	historyRetention          = 14 * 24 * time.Hour
)

// sensitiveHistoryPatterns: file che non entrano mai nella local history, perché spesso contengono segreti.
var sensitiveHistoryPatterns = []string{".env", ".env.*", "*.pem", "*.key", "*.p12", "*.pfx", "*.jks", "*.keystore", "id_rsa*", "id_ed25519*", ".netrc", "*.kdbx"}

// HistoryRevision è una versione salvata di un file, senza contenuto.
type HistoryRevision struct {
	ID      string    `json:"id"`
	Label   string    `json:"label"`
	SavedAt time.Time `json:"savedAt"`
	Bytes   int       `json:"bytes"`
}

type historyEntry struct {
	SessionID    SessionID `json:"sessionId"`
	RelativePath string    `json:"relativePath"`
	HistoryRevision
	Content string `json:"content"`
}

type historyState struct {
	Version   int            `json:"version"`
	Revisions []historyEntry `json:"revisions"`
}

// LocalHistory conserva le versioni salvate dei file per sessione, con limiti di numero, dimensione e tempo.
type LocalHistory struct {
	mu        sync.Mutex
	store     Store
	revisions []historyEntry
	loaded    bool
	now       func() time.Time
}

func NewLocalHistory(store Store) *LocalHistory {
	return &LocalHistory{store: store, now: time.Now}
}

func isSensitiveForHistory(relativePath string) bool {
	name := strings.ToLower(path.Base(relativePath))
	for _, pattern := range sensitiveHistoryPatterns {
		if matched, _ := path.Match(pattern, name); matched {
			return true
		}
	}
	return false
}

func (h *LocalHistory) loadLocked() error {
	if h.loaded || h.store == nil {
		h.loaded = true
		return nil
	}
	h.loaded = true
	data, err := h.store.Load()
	if err != nil || len(data) == 0 {
		return err
	}
	var state historyState
	if err := json.Unmarshal(data, &state); err != nil || state.Version != historySchemaVersion {
		return nil
	}
	h.revisions = state.Revisions
	h.pruneLocked()
	return nil
}

// pruneLocked applica ritenzione, numero massimo per file e dimensione totale (le più vecchie escono per prime).
func (h *LocalHistory) pruneLocked() {
	cutoff := h.now().Add(-historyRetention)
	sort.SliceStable(h.revisions, func(left, right int) bool { return h.revisions[left].SavedAt.After(h.revisions[right].SavedAt) })
	perFile := map[string]int{}
	total := 0
	kept := h.revisions[:0]
	for _, revision := range h.revisions {
		key := string(revision.SessionID) + "\x00" + revision.RelativePath
		if revision.SavedAt.Before(cutoff) || perFile[key] >= maxHistoryRevisionsByFile || total+len(revision.Content) > maxHistoryTotalBytes {
			continue
		}
		perFile[key]++
		total += len(revision.Content)
		kept = append(kept, revision)
	}
	h.revisions = kept
}

func (h *LocalHistory) persistLocked() error {
	if h.store == nil {
		return nil
	}
	data, err := json.Marshal(historyState{Version: historySchemaVersion, Revisions: h.revisions})
	if err != nil {
		return err
	}
	return h.store.Save(data)
}

func (h *LocalHistory) latestLocked(sessionID SessionID, relativePath string) *historyEntry {
	for index := range h.revisions {
		if h.revisions[index].SessionID == sessionID && h.revisions[index].RelativePath == relativePath {
			return &h.revisions[index]
		}
	}
	return nil
}

// Record aggiunge una versione se diversa dall'ultima; i file sensibili o troppo grandi non vengono mai conservati.
func (h *LocalHistory) Record(sessionID SessionID, relativePath, content, label string) error {
	if relativePath == "" || isSensitiveForHistory(relativePath) || len(content) > maxHistoryRevisionBytes {
		return nil
	}
	h.mu.Lock()
	defer h.mu.Unlock()
	if err := h.loadLocked(); err != nil {
		return err
	}
	if latest := h.latestLocked(sessionID, relativePath); latest != nil && latest.Content == content {
		return nil
	}
	now := h.now().UTC()
	h.revisions = append([]historyEntry{{
		SessionID: sessionID, RelativePath: relativePath, Content: content,
		HistoryRevision: HistoryRevision{ID: newID("rev"), Label: label, SavedAt: now, Bytes: len(content)},
	}}, h.revisions...)
	h.pruneLocked()
	return h.persistLocked()
}

// Has indica se il file ha già versioni in cronologia.
func (h *LocalHistory) Has(sessionID SessionID, relativePath string) bool {
	h.mu.Lock()
	defer h.mu.Unlock()
	_ = h.loadLocked()
	return h.latestLocked(sessionID, relativePath) != nil
}

// List restituisce le versioni del file dalla più recente, senza contenuto.
func (h *LocalHistory) List(sessionID SessionID, relativePath string) ([]HistoryRevision, error) {
	h.mu.Lock()
	defer h.mu.Unlock()
	if err := h.loadLocked(); err != nil {
		return nil, err
	}
	h.pruneLocked()
	result := make([]HistoryRevision, 0)
	for _, revision := range h.revisions {
		if revision.SessionID == sessionID && revision.RelativePath == relativePath {
			result = append(result, revision.HistoryRevision)
		}
	}
	return result, nil
}

// Content restituisce il testo di una versione.
func (h *LocalHistory) Content(sessionID SessionID, relativePath, revisionID string) (string, error) {
	h.mu.Lock()
	defer h.mu.Unlock()
	if err := h.loadLocked(); err != nil {
		return "", err
	}
	for _, revision := range h.revisions {
		if revision.SessionID == sessionID && revision.RelativePath == relativePath && revision.ID == revisionID {
			return revision.Content, nil
		}
	}
	return "", fmt.Errorf("versione non più disponibile nella local history")
}

// ForgetSession elimina la cronologia di un progetto chiuso.
func (h *LocalHistory) ForgetSession(sessionID SessionID) error {
	h.mu.Lock()
	defer h.mu.Unlock()
	if err := h.loadLocked(); err != nil {
		return err
	}
	kept := h.revisions[:0]
	for _, revision := range h.revisions {
		if revision.SessionID != sessionID {
			kept = append(kept, revision)
		}
	}
	h.revisions = kept
	return h.persistLocked()
}
