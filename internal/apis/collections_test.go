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

func TestFallbackCatalogIncludesInstallablePublicApis(t *testing.T) {
	store := NewCollectionStore(filepath.Join(t.TempDir(), "missing"))

	catalog, err := store.GetCatalog()
	if err != nil {
		t.Fatalf("GetCatalog returned error: %v", err)
	}
	if catalog.Total < len(fallbackEntries) {
		t.Fatalf("expected catalog total to include fallback public APIs, got %d for %d entries", catalog.Total, len(fallbackEntries))
	}

	entry, err := store.GetApiBySlug("open-meteo-rome-forecast")
	if err != nil {
		t.Fatalf("GetApiBySlug did not find curated public API: %v", err)
	}
	if entry.Source != publicApisSource {
		t.Fatalf("unexpected public API source: %q", entry.Source)
	}
	if len(entry.Links) == 0 || entry.Links[0].URL == "" {
		t.Fatal("expected installable public API entry to include a callable API URL")
	}

	results, err := store.SearchApis("public-apis")
	if err != nil {
		t.Fatalf("SearchApis returned error: %v", err)
	}
	if len(results) == 0 {
		t.Fatal("expected public-apis source to be searchable")
	}
}
