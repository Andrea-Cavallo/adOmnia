package rust

import (
	"os"
	"path/filepath"
	"testing"
)

// La cartella che adOmnia gestisce per rust-analyzer sta sotto la cache dell'utente, una per
// workspace, e cambia al cambiare del progetto (RS-9.2/RS-2).
func TestAnalyzerCacheDirIsPerProjectUnderTheUserCache(t *testing.T) {
	first := AnalyzerCacheDir("C:/work/one")
	second := AnalyzerCacheDir("C:/work/two")
	if first == "" || second == "" {
		t.Skip("no user cache folder in this environment")
	}
	if first == second {
		t.Fatalf("two projects share the analyzer cache: %q", first)
	}
	root, err := managedAnalyzerRoot()
	if err != nil {
		t.Fatal(err)
	}
	if !filepath.IsAbs(first) || !hasPrefixFold(first, root) {
		t.Fatalf("cache %q is not under %q", first, root)
	}
}

// Con `CARGO_TARGET_DIR` impostato la cartella è dell'utente: adOmnia non la gestisce e non la pulisce.
func TestAnalyzerCacheRespectsTheUserTargetDir(t *testing.T) {
	userDir := filepath.Join(t.TempDir(), "user-target")
	if err := os.MkdirAll(filepath.Join(userDir, "debug"), 0o755); err != nil {
		t.Fatal(err)
	}
	writeFile(t, userDir, "debug/artifact", "keep me")
	t.Setenv("CARGO_TARGET_DIR", userDir)

	if got := AnalyzerCacheDir("C:/work/one"); got != "" {
		t.Fatalf("the managed cache must be empty when CARGO_TARGET_DIR is set, got %q", got)
	}
	if _, err := CleanAnalyzerCache("C:/work/one"); err == nil {
		t.Fatal("cleaning must refuse the user's own target dir")
	}
	if _, err := os.Stat(filepath.Join(userDir, "debug", "artifact")); err != nil {
		t.Fatalf("the user's target dir was touched: %v", err)
	}
}

// La pulizia cancella solo la cartella gestita e restituisce quanto ha liberato.
func TestRemoveManagedAnalyzerDirCleansOnlyTheManagedFolder(t *testing.T) {
	root, err := managedAnalyzerRoot()
	if err != nil {
		t.Skip("no user cache folder in this environment")
	}
	victim := filepath.Join(root, "test-"+filepath.Base(t.TempDir()))
	writeFile(t, victim, "debug/.fingerprint", "0123456789")
	writeFile(t, victim, "debug/deps/lib.rlib", "0123456789012345678901234567890123456789")

	freed, err := removeManagedAnalyzerDir(victim)
	if err != nil {
		t.Fatal(err)
	}
	if freed < 50 {
		t.Fatalf("freed = %d bytes, want at least the two files", freed)
	}
	if _, err := os.Stat(victim); !os.IsNotExist(err) {
		t.Fatalf("the cache folder still exists: %v", err)
	}
	// Una cartella già sparita non è un errore: la seconda pulizia libera zero byte.
	if freed, err := removeManagedAnalyzerDir(victim); err != nil || freed != 0 {
		t.Fatalf("a missing cache must clean silently: freed=%d err=%v", freed, err)
	}
}

// Un percorso fuori dalla cache gestita non deve arrivare a os.RemoveAll.
func TestRemoveManagedAnalyzerDirRefusesForeignPaths(t *testing.T) {
	outside := filepath.Join(t.TempDir(), "precious")
	writeFile(t, outside, "file", "data")
	if _, err := removeManagedAnalyzerDir(outside); err == nil {
		t.Fatal("a folder outside the managed cache must be refused")
	}
	if _, err := os.Stat(filepath.Join(outside, "file")); err != nil {
		t.Fatalf("the refused folder was touched: %v", err)
	}
	// Anche un percorso che *contiene* il nome della cache non è la cache.
	root, err := managedAnalyzerRoot()
	if err != nil {
		t.Skip("no user cache folder in this environment")
	}
	sneaky := root + "-not-really"
	writeFile(t, sneaky, "file", "data")
	if _, err := removeManagedAnalyzerDir(sneaky); err == nil {
		t.Fatal("a look-alike folder must be refused")
	}
	if _, err := os.Stat(filepath.Join(sneaky, "file")); err != nil {
		t.Fatalf("the look-alike folder was touched: %v", err)
	}
}

// La dimensione è quella dei file regolari, senza seguire i link.
func TestAnalyzerCacheSizeCountsFiles(t *testing.T) {
	dir := t.TempDir()
	writeFile(t, dir, "a", "12345")
	writeFile(t, dir, "nested/b", "123")
	if got := AnalyzerCacheSize(dir); got != 8 {
		t.Fatalf("size = %d, want 8", got)
	}
	if got := AnalyzerCacheSize(filepath.Join(dir, "missing")); got != 0 {
		t.Fatalf("a missing folder must be zero, got %d", got)
	}
}

func hasPrefixFold(path, prefix string) bool {
	cleanPath, cleanPrefix := filepath.Clean(path), filepath.Clean(prefix)
	return len(cleanPath) > len(cleanPrefix) && equalFold(cleanPath[:len(cleanPrefix)], cleanPrefix)
}

func equalFold(left, right string) bool {
	if len(left) != len(right) {
		return false
	}
	for index := 0; index < len(left); index++ {
		a, b := left[index], right[index]
		if 'A' <= a && a <= 'Z' {
			a += 'a' - 'A'
		}
		if 'A' <= b && b <= 'Z' {
			b += 'a' - 'A'
		}
		if a != b {
			return false
		}
	}
	return true
}
