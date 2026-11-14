package storage

import (
	"net/http/httptest"
	"os"
	"strings"
	"testing"
)

func TestStorageKnownBucketsPersistAndUnknownBucketsFail(t *testing.T) {
	tempDir := t.TempDir()
	t.Setenv("APPDATA", tempDir)

	if DB() != nil {
		Close()
	}
	if err := Open(tempDir); err != nil {
		t.Fatalf("openStore() error = %v", err)
	}
	defer func() {
		Close()
		_ = os.RemoveAll(tempDir)
	}()

	for _, bucket := range []string{"collections", "environments", "database", "broker_connections", "tabs", "flows", "diagrams"} {
		if err := Put(bucket, "all", []byte(`{"ok":true}`)); err != nil {
			t.Fatalf("storePut(%q) error = %v", bucket, err)
		}
		got, err := Get(bucket, "all")
		if err != nil {
			t.Fatalf("storeGet(%q) error = %v", bucket, err)
		}
		if string(got) != `{"ok":true}` {
			t.Fatalf("storeGet(%q) = %q", bucket, string(got))
		}
	}

	if err := Put("typo", "all", []byte("lost")); err == nil {
		t.Fatal("storePut on unknown bucket succeeded; want error")
	}
	if _, err := Get("typo", "all"); err == nil {
		t.Fatal("storeGet on unknown bucket succeeded; want error")
	}
}

func TestStorageKeepsDataAcrossReopen(t *testing.T) {
	tempDir := t.TempDir()
	if DB() != nil {
		Close()
	}
	if err := Open(tempDir); err != nil {
		t.Fatalf("Open() error = %v", err)
	}
	if err := Put("collections", "tree", []byte(`[{"id":"folder-1"}]`)); err != nil {
		t.Fatalf("Put() error = %v", err)
	}
	Close()

	// A restart must open the same database file and keep every bucket, including the
	// buckets added by newer releases to an existing file.
	if err := Open(tempDir); err != nil {
		t.Fatalf("reopen error = %v", err)
	}
	defer Close()
	got, err := Get("collections", "tree")
	if err != nil {
		t.Fatalf("Get() after reopen error = %v", err)
	}
	if string(got) != `[{"id":"folder-1"}]` {
		t.Fatalf("Get() after reopen = %q", string(got))
	}
	for _, bucket := range Buckets() {
		if _, err := List(bucket, ""); err != nil {
			t.Fatalf("bucket %q missing after reopen: %v", bucket, err)
		}
	}
}

func TestStorageMigratesLegacyLocalStorageOnlyOnce(t *testing.T) {
	tempDir := t.TempDir()
	if DB() != nil {
		Close()
	}
	if err := Open(tempDir); err != nil {
		t.Fatalf("Open() error = %v", err)
	}
	defer Close()

	migrateFromLocalStorage(`{"tabs":[{"id":"tab-1"}]}`, `{"theme":"dark"}`, `{"port":9000}`)
	for bucket, key := range map[string]string{"workspace": "v2", "mock": "config"} {
		value, err := Get(bucket, key)
		if err != nil {
			t.Fatalf("Get(%s,%s) error = %v", bucket, key, err)
		}
		if len(value) == 0 {
			t.Fatalf("migration did not write %s/%s", bucket, key)
		}
	}
	settings, err := Get("workspace", "settings")
	if err != nil || string(settings) != `{"theme":"dark"}` {
		t.Fatalf("migrated settings = %q, err = %v", string(settings), err)
	}

	// A second launch with a newer browser localStorage must not overwrite the database:
	// the migration is one-shot, so edits made in the desktop app survive.
	migrateFromLocalStorage(`{"tabs":["stale"]}`, `{"theme":"light"}`, `{"port":1}`)
	workspace, err := Get("workspace", "v2")
	if err != nil {
		t.Fatalf("Get(workspace,v2) error = %v", err)
	}
	if string(workspace) != `{"tabs":[{"id":"tab-1"}]}` {
		t.Fatalf("second migration overwrote the workspace: %q", string(workspace))
	}
	settings, err = Get("workspace", "settings")
	if err != nil || string(settings) != `{"theme":"dark"}` {
		t.Fatalf("second migration overwrote settings: %q, err = %v", string(settings), err)
	}
}

func TestStorageExportsAndSnapshotsRedactPlaintextCredentials(t *testing.T) {
	tempDir := t.TempDir()
	if DB() != nil {
		Close()
	}
	if err := Open(tempDir); err != nil {
		t.Fatalf("Open() error = %v", err)
	}
	defer Close()

	value := []byte(`{"password":"database-secret","token":"vault:encrypted-token"}`)
	if err := Put("database", "connections", value); err != nil {
		t.Fatalf("Put() error = %v", err)
	}

	exportRecorder := httptest.NewRecorder()
	storageExportHandler(exportRecorder, httptest.NewRequest("GET", "/storage/export?bucket=database", nil))
	if exportRecorder.Code != 200 {
		t.Fatalf("storageExportHandler status = %d: %s", exportRecorder.Code, exportRecorder.Body.String())
	}
	if strings.Contains(exportRecorder.Body.String(), "database-secret") {
		t.Fatalf("bucket export contains plaintext: %s", exportRecorder.Body.String())
	}
	if !strings.Contains(exportRecorder.Body.String(), "vault:encrypted-token") {
		t.Fatalf("bucket export removed Vault reference: %s", exportRecorder.Body.String())
	}

	snapshotRecorder := httptest.NewRecorder()
	storageSnapshotHandler(snapshotRecorder, httptest.NewRequest("GET", "/storage/snapshot", nil))
	if snapshotRecorder.Code != 200 {
		t.Fatalf("storageSnapshotHandler status = %d: %s", snapshotRecorder.Code, snapshotRecorder.Body.String())
	}
	if strings.Contains(snapshotRecorder.Body.String(), "database-secret") {
		t.Fatalf("snapshot contains plaintext: %s", snapshotRecorder.Body.String())
	}
}
