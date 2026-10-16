package update

import (
	"errors"
	"os"
	"path/filepath"
	"testing"
	"time"
)

func swapFixture(t *testing.T) (target, backup, source string) {
	t.Helper()
	root := t.TempDir()
	target = filepath.Join(root, "Desktop", "adomnia.exe")
	backup = filepath.Join(root, "updates", "previous-install")
	source = filepath.Join(root, "updates", "apply-1", "adomnia.exe")
	for path, content := range map[string]string{target: "old version", source: "new version"} {
		if err := os.MkdirAll(filepath.Dir(path), 0o755); err != nil {
			t.Fatal(err)
		}
		if err := os.WriteFile(path, []byte(content), 0o755); err != nil {
			t.Fatal(err)
		}
	}
	original, timeout := renameFile, fileReleaseTimeout
	fileReleaseTimeout = 300 * time.Millisecond
	t.Cleanup(func() { renameFile, fileReleaseTimeout = original, timeout })
	return target, backup, source
}

func content(t *testing.T, path string) string {
	t.Helper()
	data, err := os.ReadFile(path)
	if err != nil {
		t.Fatalf("%s is missing: %v", path, err)
	}
	return string(data)
}

// lockRenamesInto simula un file bloccato da antivirus, OneDrive o dal processo appena chiuso.
func lockRenamesInto(target string) {
	renameFile = func(source, destination string) error {
		if destination == target {
			return errors.New("The process cannot access the file because it is being used by another process.")
		}
		return os.Rename(source, destination)
	}
}

func TestFileSwapInstallsAndRestores(t *testing.T) {
	target, backup, source := swapFixture(t)
	swap := newInstallSwap(target, backup)
	if _, ok := swap.(*fileSwap); !ok {
		t.Fatalf("a single executable must use the in-place swap, got %T", swap)
	}
	if err := swap.backup(); err != nil {
		t.Fatal(err)
	}
	if err := swap.install(source); err != nil {
		t.Fatal(err)
	}
	if got := content(t, target); got != "new version" {
		t.Fatalf("after install = %q", got)
	}
	if err := swap.restore(); err != nil {
		t.Fatal(err)
	}
	if got := content(t, target); got != "old version" {
		t.Fatalf("after restore = %q", got)
	}
	swap.finish()
	if _, err := os.Stat(backup); !os.IsNotExist(err) {
		t.Errorf("backup should be removed, stat err = %v", err)
	}
	entries, _ := os.ReadDir(filepath.Dir(target))
	if len(entries) != 1 {
		t.Errorf("leftovers next to the app: %v", entries)
	}
}

func TestLockedAppIsNeverRemovedWhenInstallFails(t *testing.T) {
	target, backup, source := swapFixture(t)
	swap := newInstallSwap(target, backup)
	if err := swap.backup(); err != nil {
		t.Fatal(err)
	}
	lockRenamesInto(target)
	if err := swap.install(source); err == nil {
		t.Fatal("install over a locked app must fail")
	}
	if got := content(t, target); got != "old version" {
		t.Fatalf("app = %q, want the old version untouched", got)
	}
	if _, err := os.Stat(filepath.Join(filepath.Dir(target), ".adomnia.exe.update")); !os.IsNotExist(err) {
		t.Errorf("staged copy left next to the app: %v", err)
	}
}

func TestFailedRollbackStillLeavesARunnableApp(t *testing.T) {
	target, backup, source := swapFixture(t)
	swap := newInstallSwap(target, backup)
	if err := swap.backup(); err != nil {
		t.Fatal(err)
	}
	if err := swap.install(source); err != nil {
		t.Fatal(err)
	}
	lockRenamesInto(target)
	if err := swap.restore(); err == nil {
		t.Fatal("restore over a locked app must fail")
	}
	// Prima la rimozione dell'app precedeva il ripristino: un ripristino fallito lasciava il Desktop vuoto.
	if got := content(t, target); got != "new version" {
		t.Fatalf("app = %q, want the new version still in place", got)
	}
	if got := content(t, backup); got != "old version" {
		t.Fatalf("backup = %q, want it kept for a later restore", got)
	}
}

func TestBundleUsesMoveSwap(t *testing.T) {
	root := t.TempDir()
	bundle := filepath.Join(root, "adomnia.app")
	if err := os.MkdirAll(filepath.Join(bundle, "Contents"), 0o755); err != nil {
		t.Fatal(err)
	}
	if _, ok := newInstallSwap(bundle, filepath.Join(root, "previous-install")).(*bundleSwap); !ok {
		t.Fatal("a macOS bundle must use the move-based swap")
	}
}
