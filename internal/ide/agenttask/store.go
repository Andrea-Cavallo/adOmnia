package agenttask

import (
	"encoding/json/v2"
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"sort"
	"sync"
	"unicode/utf8"

	"github.com/Andrea-Cavallo/adOmnia/internal/airedact"
	"github.com/Andrea-Cavallo/adOmnia/internal/ide/fileio"
)

const (
	maxStoredTasks  = 200
	maxStoredEvents = 500
	maxEventBytes   = 32 * 1024
)

type Store interface {
	Load() (Snapshot, error)
	Save(Snapshot) error
}

type FileStore struct {
	mu   sync.Mutex
	path string
}

func NewFileStore(path string) *FileStore {
	return &FileStore{path: filepath.Clean(path)}
}

func (store *FileStore) Load() (Snapshot, error) {
	store.mu.Lock()
	defer store.mu.Unlock()
	data, err := os.ReadFile(store.path) // #nosec G703 -- configured user-data file, not a renderer-provided path
	if errors.Is(err, os.ErrNotExist) {
		return Snapshot{Version: CurrentVersion, Tasks: []Task{}}, nil
	}
	if err != nil {
		return Snapshot{}, fmt.Errorf("read agent tasks: %w", err)
	}
	var snapshot Snapshot
	if err := json.Unmarshal(data, &snapshot); err != nil {
		return Snapshot{}, fmt.Errorf("agent task store is corrupt and was left unchanged: %w", err)
	}
	if snapshot.Version != CurrentVersion {
		return Snapshot{}, fmt.Errorf("agent task store version %d is not supported; the file was left unchanged", snapshot.Version)
	}
	for _, task := range snapshot.Tasks {
		if err := task.Validate(); err != nil {
			return Snapshot{}, fmt.Errorf("agent task store contains an invalid task: %w", err)
		}
	}
	return snapshot, nil
}

func (store *FileStore) Save(snapshot Snapshot) error {
	store.mu.Lock()
	defer store.mu.Unlock()
	if snapshot.Version != CurrentVersion {
		return fmt.Errorf("cannot save agent task store version %d", snapshot.Version)
	}
	snapshot = pruneSnapshot(snapshot)
	for _, task := range snapshot.Tasks {
		if err := task.Validate(); err != nil {
			return fmt.Errorf("cannot save invalid agent task: %w", err)
		}
	}
	data, err := json.Marshal(snapshot)
	if err != nil {
		return fmt.Errorf("encode agent tasks: %w", err)
	}
	data = []byte(airedact.Redact(string(data)))
	if err := os.MkdirAll(filepath.Dir(store.path), 0o700); err != nil {
		return fmt.Errorf("create agent task data folder: %w", err)
	}
	if err := fileio.AtomicWriteFile(store.path, data, 0o600); err != nil {
		return fmt.Errorf("save agent tasks: %w", err)
	}
	return nil
}

func pruneSnapshot(snapshot Snapshot) Snapshot {
	sort.SliceStable(snapshot.Tasks, func(left, right int) bool {
		return snapshot.Tasks[left].UpdatedAt.After(snapshot.Tasks[right].UpdatedAt)
	})
	if len(snapshot.Tasks) > maxStoredTasks {
		kept := snapshot.Tasks[:0]
		for _, task := range snapshot.Tasks {
			if task.Active() || len(kept) < maxStoredTasks {
				kept = append(kept, task)
			}
		}
		snapshot.Tasks = kept
	}
	for taskIndex := range snapshot.Tasks {
		for attemptIndex := range snapshot.Tasks[taskIndex].Attempts {
			events := snapshot.Tasks[taskIndex].Attempts[attemptIndex].Events
			for eventIndex := range events {
				events[eventIndex].Message = redactAndLimit(events[eventIndex].Message)
			}
			if len(events) > maxStoredEvents {
				events = append([]Event(nil), events[len(events)-maxStoredEvents:]...)
			}
			snapshot.Tasks[taskIndex].Attempts[attemptIndex].Events = events
		}
	}
	return snapshot
}

func redactAndLimit(message string) string {
	message = airedact.Redact(message)
	if len(message) > maxEventBytes {
		end := maxEventBytes
		for end > 0 && !utf8.ValidString(message[:end]) {
			end--
		}
		message = message[:end] + "… [truncated]"
	}
	return message
}
