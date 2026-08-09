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

	for _, bucket := range []string{"collections", "environments", "database", "broker_connections", "tabs"} {
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
