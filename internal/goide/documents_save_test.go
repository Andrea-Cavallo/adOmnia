package goide

import (
	"errors"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func TestAtomicWriteRetriesTransientRename(t *testing.T) {
	original := renameFile
	t.Cleanup(func() { renameFile = original })
	failures := 2
	renameFile = func(from, to string) error {
		if failures > 0 {
			failures--
			return errors.New("Access is denied")
		}
		return os.Rename(from, to)
	}
	path := filepath.Join(t.TempDir(), "a.go")
	if err := atomicWriteFile(path, []byte("package a\n"), 0o644); err != nil {
		t.Fatalf("save must survive two transient failures: %v", err)
	}
	if data, _ := os.ReadFile(path); string(data) != "package a\n" {
		t.Errorf("content = %q", data)
	}
}

func TestAtomicWriteGivesUpWithClearMessage(t *testing.T) {
	original := renameFile
	t.Cleanup(func() { renameFile = original })
	renameFile = func(string, string) error { return errors.New("Access is denied") }
	err := atomicWriteFile(filepath.Join(t.TempDir(), "b.go"), []byte("x"), 0o644)
	if err == nil {
		t.Fatal("expected an error")
	}
	if want := "bloccato da un altro programma"; !strings.Contains(err.Error(), want) {
		t.Errorf("error %q should mention %q", err, want)
	}
}

func TestAtomicWriteKeepsSymlink(t *testing.T) {
	dir := t.TempDir()
	target := filepath.Join(dir, "real.txt")
	link := filepath.Join(dir, "link.txt")
	if err := os.WriteFile(target, []byte("old"), 0o644); err != nil {
		t.Fatal(err)
	}
	if err := os.Symlink(target, link); err != nil {
		t.Skipf("symlink not available: %v", err)
	}
	if err := atomicWriteFile(link, []byte("new"), 0o644); err != nil {
		t.Fatal(err)
	}
	if info, err := os.Lstat(link); err != nil || info.Mode()&os.ModeSymlink == 0 {
		t.Fatalf("link was replaced by a regular file: %v %v", info, err)
	}
	if data, _ := os.ReadFile(target); string(data) != "new" {
		t.Errorf("target = %q, want new", data)
	}
}
