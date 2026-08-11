// Package collectionsstore owns the sharded persistence schema for collection
// workspaces. The legacy collections/all snapshot remains available for
// downgrade and export compatibility, while startup reads only the active
// workspace payload.
package collectionsstore

import (
	"encoding/json"
	"fmt"
	"strings"

	"adomnia/internal/storage"
	bolt "go.etcd.io/bbolt"
)

const (
	SchemaVersion   = 3
	Bucket          = "collections"
	LegacyKey       = "all"
	IndexKey        = "index-v3"
	WorkspacePrefix = "workspace:"
)

type WorkspaceMeta struct {
	ID        string `json:"id"`
	Name      string `json:"name"`
	CreatedAt string `json:"createdAt"`
	UpdatedAt string `json:"updatedAt"`
}

type Index struct {
	Version           int             `json:"version"`
	ActiveWorkspaceID string          `json:"activeWorkspaceId"`
	Workspaces        []WorkspaceMeta `json:"workspaces"`
}

type workspace struct {
	ID          string          `json:"id"`
	Name        string          `json:"name"`
	Collections json.RawMessage `json:"collections"`
	CreatedAt   string          `json:"createdAt"`
	UpdatedAt   string          `json:"updatedAt"`
}

type legacySnapshot struct {
	Version           int         `json:"version"`
	ActiveWorkspaceID string      `json:"activeWorkspaceId"`
	Workspaces        []workspace `json:"workspaces"`
}

// Critical contains either a v3 index and active workspace, or the untouched
// legacy payload when migration is not possible.
type Critical struct {
	SchemaVersion   int
	IndexJSON       string
	ActiveWorkspace string
	LegacyJSON      string
}

func workspaceKey(id string) []byte {
	return []byte(WorkspacePrefix + id)
}

func decodeIndex(data []byte) (Index, error) {
	var index Index
	if err := json.Unmarshal(data, &index); err != nil {
		return Index{}, fmt.Errorf("decode collections index: %w", err)
	}
	if index.Version != SchemaVersion {
		return Index{}, fmt.Errorf("unsupported collections index version %d", index.Version)
	}
	if len(index.Workspaces) == 0 {
		return Index{}, fmt.Errorf("collections index has no workspaces")
	}
	seen := make(map[string]struct{}, len(index.Workspaces))
	activeFound := false
	for _, meta := range index.Workspaces {
		if strings.TrimSpace(meta.ID) == "" || len(meta.ID) > 512 {
			return Index{}, fmt.Errorf("invalid workspace id")
		}
		if _, exists := seen[meta.ID]; exists {
			return Index{}, fmt.Errorf("duplicate workspace id %q", meta.ID)
		}
		seen[meta.ID] = struct{}{}
		if meta.ID == index.ActiveWorkspaceID {
			activeFound = true
		}
	}
	if !activeFound {
		return Index{}, fmt.Errorf("active workspace %q not found", index.ActiveWorkspaceID)
	}
	return index, nil
}

func decodeWorkspace(data []byte) (workspace, error) {
	var value workspace
	if err := json.Unmarshal(data, &value); err != nil {
		return workspace{}, fmt.Errorf("decode collection workspace: %w", err)
	}
	if strings.TrimSpace(value.ID) == "" || len(value.ID) > 512 {
		return workspace{}, fmt.Errorf("invalid workspace id")
	}
	if len(value.Collections) == 0 {
		value.Collections = json.RawMessage("[]")
	}
	var collections []json.RawMessage
	if err := json.Unmarshal(value.Collections, &collections); err != nil {
		return workspace{}, fmt.Errorf("workspace %q collections must be an array: %w", value.ID, err)
	}
	return value, nil
}

func metadataFor(index Index, id string) (WorkspaceMeta, bool) {
	for _, meta := range index.Workspaces {
		if meta.ID == id {
			return meta, true
		}
	}
	return WorkspaceMeta{}, false
}

func applyMetadata(value workspace, meta WorkspaceMeta) workspace {
	value.ID = meta.ID
	value.Name = meta.Name
	value.CreatedAt = meta.CreatedAt
	value.UpdatedAt = meta.UpdatedAt
	return value
}

func marshalWorkspace(value workspace, meta WorkspaceMeta) ([]byte, error) {
	return json.Marshal(applyMetadata(value, meta))
}

func criticalFromV3(bucket *bolt.Bucket, indexData []byte) (Critical, error) {
	index, err := decodeIndex(indexData)
	if err != nil {
		return Critical{}, err
	}
	activeData := bucket.Get(workspaceKey(index.ActiveWorkspaceID))
	active, err := decodeWorkspace(activeData)
	if err != nil || active.ID != index.ActiveWorkspaceID {
		return Critical{}, fmt.Errorf("active collection workspace is unavailable")
	}
	meta, _ := metadataFor(index, active.ID)
	normalized, err := marshalWorkspace(active, meta)
	if err != nil {
		return Critical{}, err
	}
	return Critical{
		SchemaVersion:   SchemaVersion,
		IndexJSON:       string(indexData),
		ActiveWorkspace: string(normalized),
	}, nil
}

func migrateLegacy(bucket *bolt.Bucket, legacyData []byte) (Critical, error) {
	if len(legacyData) == 0 {
		return Critical{}, nil
	}
	var legacy struct {
		Version           int               `json:"version"`
		ActiveWorkspaceID string            `json:"activeWorkspaceId"`
		Workspaces        []json.RawMessage `json:"workspaces"`
	}
	if err := json.Unmarshal(legacyData, &legacy); err != nil || legacy.Version < 2 || len(legacy.Workspaces) == 0 {
		return Critical{LegacyJSON: string(legacyData)}, nil
	}

	index := Index{Version: SchemaVersion, ActiveWorkspaceID: legacy.ActiveWorkspaceID}
	workspaceData := make(map[string][]byte, len(legacy.Workspaces))
	for _, raw := range legacy.Workspaces {
		value, err := decodeWorkspace(raw)
		if err != nil {
			return Critical{LegacyJSON: string(legacyData)}, nil
		}
		if _, duplicate := workspaceData[value.ID]; duplicate {
			return Critical{LegacyJSON: string(legacyData)}, nil
		}
		workspaceData[value.ID] = append([]byte(nil), raw...)
		index.Workspaces = append(index.Workspaces, WorkspaceMeta{
			ID: value.ID, Name: value.Name, CreatedAt: value.CreatedAt, UpdatedAt: value.UpdatedAt,
		})
	}
	if _, ok := workspaceData[index.ActiveWorkspaceID]; !ok {
		index.ActiveWorkspaceID = index.Workspaces[0].ID
	}
	indexData, err := json.Marshal(index)
	if err != nil {
		return Critical{}, err
	}
	for id, data := range workspaceData {
		if err := bucket.Put(workspaceKey(id), data); err != nil {
			return Critical{}, err
		}
	}
	if err := bucket.Put([]byte(IndexKey), indexData); err != nil {
		return Critical{}, err
	}
	return criticalFromV3(bucket, indexData)
}

// LoadCriticalTx reads or migrates collections inside the caller's bootstrap
// transaction. Migration is additive: collections/all is never removed.
func LoadCriticalTx(tx *bolt.Tx) (Critical, error) {
	bucket := tx.Bucket([]byte(Bucket))
	if bucket == nil {
		return Critical{}, fmt.Errorf("collections bucket not found")
	}
	if indexData := bucket.Get([]byte(IndexKey)); len(indexData) > 0 {
		critical, err := criticalFromV3(bucket, indexData)
		if err == nil {
			return critical, nil
		}
	}
	return migrateLegacy(bucket, bucket.Get([]byte(LegacyKey)))
}

// LoadWorkspace returns one workspace, applying the current index metadata so
// rename-only updates do not require loading its collection payload first.
func LoadWorkspace(id string) (string, error) {
	if storage.DB() == nil {
		return "", fmt.Errorf("storage not initialized")
	}
	var result []byte
	err := storage.DB().View(func(tx *bolt.Tx) error {
		bucket := tx.Bucket([]byte(Bucket))
		index, err := decodeIndex(bucket.Get([]byte(IndexKey)))
		if err != nil {
			return err
		}
		meta, ok := metadataFor(index, id)
		if !ok {
			return fmt.Errorf("workspace %q not found", id)
		}
		value, err := decodeWorkspace(bucket.Get(workspaceKey(id)))
		if err != nil || value.ID != id {
			return fmt.Errorf("workspace %q payload unavailable", id)
		}
		result, err = marshalWorkspace(value, meta)
		return err
	})
	if err != nil {
		return "", fmt.Errorf("load collection workspace: %w", err)
	}
	return string(result), nil
}

// Save writes the index and changed workspace payloads atomically, removes
// stale shards, and rebuilds collections/all as a complete v2 snapshot.
func Save(indexJSON string, workspaceJSON []string) error {
	if storage.DB() == nil {
		return fmt.Errorf("storage not initialized")
	}
	index, err := decodeIndex([]byte(indexJSON))
	if err != nil {
		return err
	}
	changed := make(map[string]workspace, len(workspaceJSON))
	for _, raw := range workspaceJSON {
		value, err := decodeWorkspace([]byte(raw))
		if err != nil {
			return err
		}
		if _, ok := metadataFor(index, value.ID); !ok {
			return fmt.Errorf("workspace %q missing from index", value.ID)
		}
		changed[value.ID] = value
	}
	indexData, err := json.Marshal(index)
	if err != nil {
		return err
	}

	err = storage.DB().Update(func(tx *bolt.Tx) error {
		bucket := tx.Bucket([]byte(Bucket))
		if bucket == nil {
			return fmt.Errorf("collections bucket not found")
		}
		if err := bucket.Put([]byte(IndexKey), indexData); err != nil {
			return err
		}
		for id, value := range changed {
			meta, _ := metadataFor(index, id)
			data, err := marshalWorkspace(value, meta)
			if err != nil {
				return err
			}
			if err := bucket.Put(workspaceKey(id), data); err != nil {
				return err
			}
		}

		allowed := make(map[string]struct{}, len(index.Workspaces))
		for _, meta := range index.Workspaces {
			allowed[meta.ID] = struct{}{}
		}
		cursor := bucket.Cursor()
		prefix := []byte(WorkspacePrefix)
		for key, _ := cursor.Seek(prefix); key != nil && strings.HasPrefix(string(key), WorkspacePrefix); key, _ = cursor.Next() {
			id := strings.TrimPrefix(string(key), WorkspacePrefix)
			if _, ok := allowed[id]; !ok {
				if err := cursor.Delete(); err != nil {
					return err
				}
			}
		}

		legacy := legacySnapshot{Version: 2, ActiveWorkspaceID: index.ActiveWorkspaceID}
		for _, meta := range index.Workspaces {
			value, err := decodeWorkspace(bucket.Get(workspaceKey(meta.ID)))
			if err != nil || value.ID != meta.ID {
				return fmt.Errorf("workspace %q payload unavailable", meta.ID)
			}
			legacy.Workspaces = append(legacy.Workspaces, applyMetadata(value, meta))
		}
		legacyData, err := json.Marshal(legacy)
		if err != nil {
			return err
		}
		return bucket.Put([]byte(LegacyKey), legacyData)
	})
	if err != nil {
		return fmt.Errorf("save collection workspaces: %w", err)
	}
	return nil
}
