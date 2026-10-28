package collectionsstore

import (
	"bytes"
	jsonv1 "encoding/json"
	"encoding/json/v2"
	"testing"

	"github.com/Andrea-Cavallo/adOmnia/internal/storage"
	bolt "go.etcd.io/bbolt"
)

const legacyFixture = `{"version":2,"activeWorkspaceId":"ws-b","workspaces":[{"id":"ws-a","name":"A","collections":[{"id":"a","name":"A API","children":[]}],"createdAt":"2026-01-01T00:00:00Z","updatedAt":"2026-01-02T00:00:00Z"},{"id":"ws-b","name":"B","collections":[{"id":"b","name":"B API","children":[]}],"createdAt":"2026-02-01T00:00:00Z","updatedAt":"2026-02-02T00:00:00Z"}]}`

func TestWorkspaceNormalizationPreservesRawCollections(t *testing.T) {
	raw := `[{ "body": "<script> & ", "number": 12345678901234567890 }]`
	value, err := decodeWorkspace([]byte(`{"id":"a","collections":` + raw + `}`))
	if err != nil {
		t.Fatal(err)
	}
	encoded, err := marshalWorkspace(value, WorkspaceMeta{ID: "a", Name: "renamed \"workspace\""})
	if err != nil {
		t.Fatal(err)
	}
	var result workspace
	if err := json.Unmarshal(encoded, &result); err != nil {
		t.Fatal(err)
	}
	if string(result.Collections) != raw || result.Name != "renamed \"workspace\"" {
		t.Fatalf("unexpected normalized workspace: %s", encoded)
	}
	for _, invalid := range []string{`{"id":"a","collections":{}}`, `{"id":"a","collections":[invalid]}`, `{"id":"a","collections":[],"tree":{}}`, `{"id":"a","collections":[],"tree":"x"}`} {
		if _, err := decodeWorkspace([]byte(invalid)); err == nil {
			t.Fatalf("accepted invalid workspace: %s", invalid)
		}
	}
}

func TestWorkspaceTreeProjectionIsSeparateFromRequestContents(t *testing.T) {
	tree := `[{"id":"col","name":"API","children":[{"id":"req","name":"Get","type":"request","method":"GET","url":"https://example.test"}]}]`
	collections := `[{"id":"col","name":"API","children":[{"id":"req","name":"Get","type":"request","method":"GET","url":"https://example.test","headers":[],"bodies":[{"raw":"{\"large\":1}"}]}]}]`
	value, err := decodeWorkspace([]byte(`{"id":"a","tree":` + tree + `,"collections":` + collections + `}`))
	if err != nil {
		t.Fatal(err)
	}
	encoded, err := marshalWorkspace(value, WorkspaceMeta{ID: "a", Name: "A"})
	if err != nil {
		t.Fatal(err)
	}
	var result workspace
	if err := json.Unmarshal(encoded, &result); err != nil {
		t.Fatal(err)
	}
	if string(result.Tree) != tree || string(result.Collections) != collections {
		t.Fatalf("tree projection and request contents were not preserved: %s", encoded)
	}
	payload, err := marshalWorkspacePayload(value, WorkspaceMeta{ID: "a", Name: "A"})
	if err != nil {
		t.Fatal(err)
	}
	var shell map[string]jsonv1.RawMessage
	if err := json.Unmarshal(payload.Workspace, &shell); err != nil {
		t.Fatal(err)
	}
	if _, hasCollections := shell["collections"]; hasCollections {
		t.Fatalf("structured payload leaked request contents into the tree shell: %s", payload.Workspace)
	}
	if string(shell["tree"]) != tree || payload.CollectionsJSON != collections {
		t.Fatalf("unexpected structured payload: %s / %s", payload.Workspace, payload.CollectionsJSON)
	}
}

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
	workspaceA := `{"id":"ws-a","name":"A","tree":[{"id":"new","name":"New API","children":[]}],"collections":[{"id":"new","name":"New API","children":[]}],"createdAt":"2026-01-01T00:00:00Z","updatedAt":"2026-01-02T00:00:00Z"}`
	if err := Save(index, []string{workspaceA}); err != nil {
		t.Fatalf("save: %v", err)
	}
	if stale, _ := storage.Get(Bucket, WorkspacePrefix+"ws-b"); len(stale) != 0 {
		t.Fatal("deleted workspace shard still exists")
	}
	// The snapshot rebuild is deferred: the save path itself never re-encodes
	// every workspace. The flush is the synchronous escape hatch.
	if err := FlushLegacySnapshot(); err != nil {
		t.Fatalf("flush legacy snapshot: %v", err)
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
	if bytes.Contains(legacyData, []byte(`"tree"`)) {
		t.Fatalf("tree projection leaked into the v2 downgrade snapshot: %s", legacyData)
	}
}

func TestDeferredLegacyRebuildStaysCompleteAcrossSaves(t *testing.T) {
	openTestStore(t)
	index := `{"version":3,"activeWorkspaceId":"ws-a","workspaces":[{"id":"ws-a","name":"A","createdAt":"2026-01-01T00:00:00Z","updatedAt":"2026-03-01T00:00:00Z"},{"id":"ws-b","name":"B","createdAt":"2026-02-01T00:00:00Z","updatedAt":"2026-03-01T00:00:00Z"}]}`
	workspaceA := `{"id":"ws-a","name":"A","tree":[{"id":"a","name":"A API","children":[]}],"collections":[{"id":"a","name":"A API","children":[]}],"createdAt":"2026-01-01T00:00:00Z","updatedAt":"2026-01-02T00:00:00Z"}`
	workspaceB := `{"id":"ws-b","name":"B","tree":[{"id":"b","name":"B API","children":[]}],"collections":[{"id":"b","name":"B API","children":[]}],"createdAt":"2026-02-01T00:00:00Z","updatedAt":"2026-02-02T00:00:00Z"}`
	if err := Save(index, []string{workspaceA, workspaceB}); err != nil {
		t.Fatalf("save: %v", err)
	}
	if err := Save(index, []string{workspaceA}); err != nil {
		t.Fatalf("second save: %v", err)
	}
	if err := FlushLegacySnapshot(); err != nil {
		t.Fatalf("flush: %v", err)
	}
	legacyData, _ := storage.Get(Bucket, LegacyKey)
	var legacy legacySnapshot
	if err := json.Unmarshal(legacyData, &legacy); err != nil {
		t.Fatalf("decode legacy: %v", err)
	}
	if len(legacy.Workspaces) != 2 {
		t.Fatalf("deferred snapshot is not complete: %#v", legacy.Workspaces)
	}
}

func TestLoadWorkspacePayloadSplitsTreeFromRequestContents(t *testing.T) {
	openTestStore(t)
	index := `{"version":3,"activeWorkspaceId":"ws-a","workspaces":[{"id":"ws-a","name":"A","createdAt":"2026-01-01T00:00:00Z","updatedAt":"2026-03-01T00:00:00Z"}]}`
	tree := `[{"id":"req","name":"Get","type":"request","method":"GET","url":"https://example.test"}]`
	collections := `[{"id":"req","name":"Get","type":"request","method":"GET","url":"https://example.test","bodies":[{"raw":"payload"}]}]`
	if err := Save(index, []string{`{"id":"ws-a","name":"A","tree":` + tree + `,"collections":` + collections + `,"createdAt":"2026-01-01T00:00:00Z","updatedAt":"2026-01-02T00:00:00Z"}`}); err != nil {
		t.Fatalf("save: %v", err)
	}
	payload, err := LoadWorkspacePayload("ws-a")
	if err != nil {
		t.Fatalf("load payload: %v", err)
	}
	if payload.CollectionsJSON != collections {
		t.Fatalf("request contents = %s", payload.CollectionsJSON)
	}
	var shell workspace
	if err := json.Unmarshal(payload.Workspace, &shell); err != nil {
		t.Fatal(err)
	}
	if string(shell.Tree) != tree || len(shell.Collections) != 0 {
		t.Fatalf("structured shell = %s", payload.Workspace)
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
