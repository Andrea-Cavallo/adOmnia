package goide

import (
	"fmt"
	"strings"

	"adomnia/internal/storage"
)

const boltBucket = "goide"

// BoltStore persists one Go Studio blob under a key of the shared bbolt DB.
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
		return fmt.Errorf("archivio locale non inizializzato")
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
