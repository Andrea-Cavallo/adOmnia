package main

import (
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
)

func TestDesktopEntryTracksEmbeddedBundle(t *testing.T) {
	url := desktopEntryURL()
	if !strings.HasPrefix(url, "/?bundle=") || url != desktopEntryURL() {
		t.Fatalf("invalid bundle entry URL: %q", url)
	}
}

func TestDesktopAssetsDisablePersistentWebviewCache(t *testing.T) {
	handler := desktopAssetHandler(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) { _, _ = w.Write([]byte("asset")) }))
	for _, path := range []string{"/", "/assets/example.js"} {
		response := httptest.NewRecorder()
		handler.ServeHTTP(response, httptest.NewRequest("GET", path, nil))
		if response.Header().Get("Cache-Control") != "no-store" || response.Body.String() != "asset" {
			t.Fatalf("invalid response for %s: %v", path, response)
		}
	}
}
