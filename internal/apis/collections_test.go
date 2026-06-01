package apis

import (
	"path/filepath"
	"testing"
)

func TestGetCatalogFallsBackWhenCollectionDirectoryIsMissing(t *testing.T) {
	store := NewCollectionStore(filepath.Join(t.TempDir(), "missing"))

	catalog, err := store.GetCatalog()
	if err != nil {
		t.Fatalf("GetCatalog returned error: %v", err)
	}
	if catalog == nil {
		t.Fatal("GetCatalog returned nil catalog")
	}
	if catalog.Total == 0 {
		t.Fatal("expected fallback catalog entries")
	}

	entry, err := store.GetApiBySlug("httpbin-anything")
	if err != nil {
		t.Fatalf("GetApiBySlug fallback returned error: %v", err)
	}
	if entry.Name != "HTTPBin Anything" {
		t.Fatalf("unexpected fallback entry: %q", entry.Name)
	}
}
