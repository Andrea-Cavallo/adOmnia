package collectionsstore

import (
	"encoding/json"
	"testing"

	"adomnia/internal/storage"
	bolt "go.etcd.io/bbolt"
)

const legacyFixture = `{"version":2,"activeWorkspaceId":"ws-b","workspaces":[{"id":"ws-a","name":"A","collections":[{"id":"a","name":"A API","children":[]}],"createdAt":"2026-01-01T00:00:00Z","updatedAt":"2026-01-02T00:00:00Z"},{"id":"ws-b","name":"B","collections":[{"id":"b","name":"B API","children":[]}],"createdAt":"2026-02-01T00:00:00Z","updatedAt":"2026-02-02T00:00:00Z"}]}`

func openTestStore(t *testing.T) {
	t.Helper()
	if err := storage.Open(t.TempDir()); err != nil {
		t.Fatalf("open storage: %v", err)
	}
	t.Cleanup(storage.Close)
}

func TestLoadCriticalMigratesLegacyAdditivelyAndIdempotently(t *testing.T) {
	openTestStore(t)
	if err := storage.Put(Bucket, LegacyKey, []byte(legacyFixture)); err != nil {
		t.Fatalf("put legacy: %v", err)
	}

	var first Critical
	if err := storage.DB().Update(func(tx *bolt.Tx) error {
		var err error
		first, err = LoadCriticalTx(tx)
		return err
	}); err != nil {
		t.Fatalf("load critical: %v", err)
	}
	if first.SchemaVersion != SchemaVersion || first.LegacyJSON != "" {
		t.Fatalf("unexpected critical payload: %#v", first)
	}
	var active map[string]any
	if err := json.Unmarshal([]byte(first.ActiveWorkspace), &active); err != nil || active["id"] != "ws-b" {
		t.Fatalf("active workspace = %#v, err %v", active, err)
	}
	legacyAfter, err := storage.Get(Bucket, LegacyKey)
	if err != nil || string(legacyAfter) != legacyFixture {
		t.Fatalf("legacy snapshot changed during migration: %v", err)
	}

	indexBefore, _ := storage.Get(Bucket, IndexKey)
	var second Critical
	if err := storage.DB().Update(func(tx *bolt.Tx) error {
		var err error
		second, err = LoadCriticalTx(tx)
		return err
	}); err != nil {
		t.Fatalf("second load: %v", err)
	}
	indexAfter, _ := storage.Get(Bucket, IndexKey)
	if string(indexBefore) != string(indexAfter) || second.ActiveWorkspace != first.ActiveWorkspace {
		t.Fatal("v3 migration was not idempotent")
	}
}

func TestSaveRebuildsLegacySnapshotAndDeletesStaleShard(t *testing.T) {
	openTestStore(t)
	if err := storage.Put(Bucket, LegacyKey, []byte(legacyFixture)); err != nil {
		t.Fatalf("put legacy: %v", err)
	}
	if err := storage.DB().Update(func(tx *bolt.Tx) error {
		_, err := LoadCriticalTx(tx)
		return err
	}); err != nil {
		t.Fatalf("migrate: %v", err)
	}

	index := `{"version":3,"activeWorkspaceId":"ws-a","workspaces":[{"id":"ws-a","name":"Renamed A","createdAt":"2026-01-01T00:00:00Z","updatedAt":"2026-03-01T00:00:00Z"}]}`
	workspaceA := `{"id":"ws-a","name":"A","collections":[{"id":"new","name":"New API","children":[]}],"createdAt":"2026-01-01T00:00:00Z","updatedAt":"2026-01-02T00:00:00Z"}`
	if err := Save(index, []string{workspaceA}); err != nil {
		t.Fatalf("save: %v", err)
	}
	if stale, _ := storage.Get(Bucket, WorkspacePrefix+"ws-b"); len(stale) != 0 {
		t.Fatal("deleted workspace shard still exists")
	}
	legacyData, _ := storage.Get(Bucket, LegacyKey)
	var legacy legacySnapshot
	if err := json.Unmarshal(legacyData, &legacy); err != nil {
		t.Fatalf("decode rebuilt legacy: %v", err)
	}
	if legacy.Version != 2 || legacy.ActiveWorkspaceID != "ws-a" || len(legacy.Workspaces) != 1 {
		t.Fatalf("unexpected legacy snapshot: %#v", legacy)
	}
	if legacy.Workspaces[0].Name != "Renamed A" || string(legacy.Workspaces[0].Collections) != `[{"id":"new","name":"New API","children":[]}]` {
		t.Fatalf("legacy workspace not updated: %#v", legacy.Workspaces[0])
	}
}

func TestInvalidV3FallsBackToLegacy(t *testing.T) {
	openTestStore(t)
	if err := storage.Put(Bucket, IndexKey, []byte(`{"version":3,"activeWorkspaceId":"missing","workspaces":[]}`)); err != nil {
		t.Fatal(err)
	}
	legacy := `{"version":1,"collections":[]}`
	if err := storage.Put(Bucket, LegacyKey, []byte(legacy)); err != nil {
		t.Fatal(err)
	}
	var critical Critical
	if err := storage.DB().Update(func(tx *bolt.Tx) error {
		var err error
		critical, err = LoadCriticalTx(tx)
		return err
	}); err != nil {
		t.Fatalf("load fallback: %v", err)
	}
	if critical.SchemaVersion != 0 || critical.LegacyJSON != legacy {
		t.Fatalf("legacy fallback not returned: %#v", critical)
	}
}
