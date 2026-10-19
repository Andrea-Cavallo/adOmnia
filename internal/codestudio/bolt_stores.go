package codestudio

import (
	"fmt"
	"strings"

	"adomnia/internal/storage"
)

const boltBucket = "goide"

// BoltStore persists one Code Studio blob under a key of the shared bbolt DB.
// Session state, local history and supervisor state each use their own key so
// one cannot grow the others.
type BoltStore struct {
	Key string
	// DeleteEmpty removes the key when an empty blob is saved.
	DeleteEmpty bool
}

var (
	StateBoltStore      = BoltStore{Key: "state"}
	HistoryBoltStore    = BoltStore{Key: "localHistory"}
	SupervisorBoltStore = BoltStore{Key: "supervisor"}
	// RecoveryBoltStore keeps unsaved buffers away from the session state.
	RecoveryBoltStore = BoltRecoveryStore{BoltStore{Key: "recovery", DeleteEmpty: true}}
)

// SessionViewPrefix keeps one session layout per key so saving tabs never
// rewrites every session. The state blob keeps mirroring them: a build without
// per-session persistence still restores the last mirrored layouts.
const SessionViewPrefix = "session-view:"

// LoadSessionViews reads every persisted session layout.
func (BoltStore) LoadSessionViews() (map[SessionID][]byte, error) {
	if storage.DB() == nil {
		return nil, nil
	}
	keys, err := storage.List(boltBucket, SessionViewPrefix)
	if err != nil {
		return nil, err
	}
	views := make(map[SessionID][]byte, len(keys))
	for _, key := range keys {
		data, err := storage.Get(boltBucket, key)
		if err != nil {
			return nil, err
		}
		views[SessionID(strings.TrimPrefix(key, SessionViewPrefix))] = data
	}
	return views, nil
}

// SaveSessionView persists one session layout under its own key.
func (BoltStore) SaveSessionView(sessionID SessionID, data []byte) error {
	return saveBolt(SessionViewPrefix+string(sessionID), data, true)
}

// DeleteSessionView removes the persisted layout of a closed session.
func (BoltStore) DeleteSessionView(sessionID SessionID) error {
	if storage.DB() == nil {
		return nil
	}
	return storage.Delete(boltBucket, SessionViewPrefix+string(sessionID))
}

func (s BoltStore) Load() ([]byte, error) {
	if storage.DB() == nil {
		return nil, nil
	}
	return storage.Get(boltBucket, s.Key)
}

func (s BoltStore) Save(data []byte) error {
	return saveBolt(s.Key, data, s.DeleteEmpty)
}

func saveBolt(key string, data []byte, deleteEmpty bool) error {
	if storage.DB() == nil {
		return fmt.Errorf("local store not initialized")
	}
	if deleteEmpty && len(data) == 0 {
		return storage.Delete(boltBucket, key)
	}
	return storage.Put(boltBucket, key, data)
}

// BoltRecoveryStore also keeps one recovery/<workspace-id> key per project.
type BoltRecoveryStore struct{ BoltStore }

func (BoltRecoveryStore) LoadWorkspaces() (map[string][]byte, error) {
	if storage.DB() == nil {
		return nil, nil
	}
	keys, err := storage.List(boltBucket, RecoveryWorkspacePrefix)
	if err != nil {
		return nil, err
	}
	workspaces := make(map[string][]byte, len(keys))
	for _, key := range keys {
		data, err := storage.Get(boltBucket, key)
		if err != nil {
			return nil, err
		}
		workspaces[strings.TrimPrefix(key, RecoveryWorkspacePrefix)] = data
	}
	return workspaces, nil
}

func (BoltRecoveryStore) SaveWorkspace(workspaceID string, data []byte) error {
	return saveBolt(RecoveryWorkspacePrefix+workspaceID, data, true)
}
