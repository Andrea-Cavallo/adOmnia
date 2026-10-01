package goide

import (
	"errors"
	"os"
	"path/filepath"
	"testing"
	"time"
)

func TestCachedToolVersionRunsTheBinaryOnlyWhenItChanges(t *testing.T) {
	binary := filepath.Join(t.TempDir(), "gopls")
	if err := os.WriteFile(binary, []byte("v1"), 0o755); err != nil {
		t.Fatal(err)
	}
	calls := 0
	query := func(string) (string, error) { calls++; return "v0.23.0", nil }
	for range 3 {
		if version, err := cachedToolVersion(binary, query); err != nil || version != "v0.23.0" {
			t.Fatalf("%q %v", version, err)
		}
	}
	if calls != 1 {
		t.Fatalf("binario invariato interrogato %d volte", calls)
	}
	// Persistito e ripristinato: al riavvio niente processo.
	saved := snapshotToolVersions()
	toolVersions.Lock()
	toolVersions.entries = map[string]ToolVersionEntry{}
	toolVersions.Unlock()
	restoreToolVersions(saved)
	if _, _ = cachedToolVersion(binary, query); calls != 1 {
		t.Fatal("dopo il riavvio la versione salvata va riusata")
	}
	// Aggiornato: nuova data → nuova lettura.
	future := time.Now().Add(time.Hour)
	if err := os.Chtimes(binary, future, future); err != nil {
		t.Fatal(err)
	}
	if _, _ = cachedToolVersion(binary, query); calls != 2 {
		t.Fatal("un binario aggiornato va interrogato di nuovo")
	}
	failing := func(string) (string, error) { calls++; return "", errors.New("boom") }
	other := filepath.Join(t.TempDir(), "dlv")
	_ = os.WriteFile(other, []byte("x"), 0o755)
	_, _ = cachedToolVersion(other, failing)
	_, _ = cachedToolVersion(other, failing)
	if calls != 4 {
		t.Fatal("gli errori non vanno memorizzati")
	}
}
