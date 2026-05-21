package main

import (
	"os"
	"testing"
)

func TestStorageKnownBucketsPersistAndUnknownBucketsFail(t *testing.T) {
	tempDir := t.TempDir()
	t.Setenv("APPDATA", tempDir)

	if storeDB != nil {
		closeStore()
		storeDB = nil
	}
	if err := openStore(); err != nil {
		t.Fatalf("openStore() error = %v", err)
	}
	defer func() {
		closeStore()
		storeDB = nil
		_ = os.RemoveAll(tempDir)
	}()

	for _, bucket := range []string{"collections", "environments", "database", "tabs"} {
		if err := storePut(bucket, "all", []byte(`{"ok":true}`)); err != nil {
			t.Fatalf("storePut(%q) error = %v", bucket, err)
		}
		got, err := storeGet(bucket, "all")
		if err != nil {
			t.Fatalf("storeGet(%q) error = %v", bucket, err)
		}
		if string(got) != `{"ok":true}` {
			t.Fatalf("storeGet(%q) = %q", bucket, string(got))
		}
	}

	if err := storePut("typo", "all", []byte("lost")); err == nil {
		t.Fatal("storePut on unknown bucket succeeded; want error")
	}
	if _, err := storeGet("typo", "all"); err == nil {
		t.Fatal("storeGet on unknown bucket succeeded; want error")
	}
}
