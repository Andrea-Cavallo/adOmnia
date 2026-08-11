package bootstrap

import (
	"adomnia/internal/collectionsstore"
	"adomnia/internal/storage"
	"encoding/json"
	"testing"
)

func TestVersionIsPositive(t *testing.T) {
	if Version < 1 {
		t.Fatalf("bootstrap payload version must be positive, got %d", Version)
	}
}

func TestLoadReturnsAllCriticalValues(t *testing.T) {
	if err := storage.Open(t.TempDir()); err != nil {
		t.Fatalf("open storage: %v", err)
	}
	t.Cleanup(storage.Close)

	writes := map[storage.Key]string{
		settingsKey: `{"version":7}`,
		{Bucket: collectionsstore.Bucket, Item: collectionsstore.LegacyKey}: `{"version":2,"activeWorkspaceId":"ws-a","workspaces":[{"id":"ws-a","name":"A","collections":[],"createdAt":"2026-01-01T00:00:00Z","updatedAt":"2026-01-01T00:00:00Z"}]}`,
		environmentsKey: `{"environments":[]}`,
		hostsKey:        `{"profiles":[]}`,
		tabsCriticalKey: `{"version":3,"tabs":[]}`,
	}
	for key, value := range writes {
		if err := storage.Put(key.Bucket, key.Item, []byte(value)); err != nil {
			t.Fatalf("put %s/%s: %v", key.Bucket, key.Item, err)
		}
	}

	state, err := Load()
	if err != nil {
		t.Fatalf("load bootstrap: %v", err)
	}
	if state.Version != Version {
		t.Fatalf("version = %d, want %d", state.Version, Version)
	}
	if state.Settings != writes[settingsKey] ||
		state.CollectionsSchema != collectionsstore.SchemaVersion ||
		state.CollectionsIndex == "" || state.ActiveCollectionWorkspace == "" || state.Collections != "" ||
		state.Environments != writes[environmentsKey] ||
		state.Hosts != writes[hostsKey] ||
		state.Tabs != writes[tabsCriticalKey] {
		t.Fatalf("bootstrap state did not preserve stored values: %#v", state)
	}
	structured, err := LoadV2()
	if err != nil {
		t.Fatalf("load structured bootstrap: %v", err)
	}
	encoded, err := json.Marshal(structured)
	if err != nil {
		t.Fatalf("marshal structured bootstrap: %v", err)
	}
	var envelope map[string]any
	if err := json.Unmarshal(encoded, &envelope); err != nil {
		t.Fatalf("decode structured envelope: %v", err)
	}
	if _, ok := envelope["settings"].(map[string]any); !ok {
		t.Fatalf("settings must be embedded JSON, got %T", envelope["settings"])
	}
	if structured.PayloadBytes.Total <= 0 || structured.PayloadBytes.ActiveCollectionWorkspace <= 0 {
		t.Fatalf("payload byte counters missing: %#v", structured.PayloadBytes)
	}

	legacyTabs := `{"version":2,"tabs":[{"id":"legacy"}]}`
	if err := storage.Put(tabsLegacyKey.Bucket, tabsLegacyKey.Item, []byte(legacyTabs)); err != nil {
		t.Fatalf("put legacy tabs: %v", err)
	}
	state, err = Load()
	if err != nil || state.Tabs != writes[tabsCriticalKey] {
		t.Fatalf("critical tabs must win when both schemas exist: %#v, %v", state, err)
	}
	if err := storage.Delete(tabsCriticalKey.Bucket, tabsCriticalKey.Item); err != nil {
		t.Fatalf("delete critical tabs: %v", err)
	}
	state, err = Load()
	if err != nil || state.Tabs != legacyTabs {
		t.Fatalf("legacy tabs fallback failed: %#v, %v", state, err)
	}
}

func TestRawJSONRejectsCorruptionAndDefaultsEmptyValues(t *testing.T) {
	value, err := rawJSON("", "null")
	if err != nil || string(value) != "null" {
		t.Fatalf("empty fallback = %q, %v", value, err)
	}
	if _, err := rawJSON("{", "null"); err == nil {
		t.Fatal("corrupt JSON was accepted")
	}
}
