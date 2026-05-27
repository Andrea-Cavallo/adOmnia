package database

import (
	"path/filepath"
	"testing"
)

func TestSanitizeSQLitePathRejectsRelativeTraversal(t *testing.T) {
	if _, err := SanitizeSQLitePath(filepath.Join("..", "..", "etc", "hosts")); err == nil {
		t.Fatal("expected relative traversal path to be rejected")
	}
}

func TestSanitizeSQLitePathRejectsURI(t *testing.T) {
	if _, err := SanitizeSQLitePath("file:../../etc/hosts?mode=ro"); err == nil {
		t.Fatal("expected SQLite URI DSN to be rejected")
	}
}

func TestSanitizeSQLitePathAllowsAbsolutePath(t *testing.T) {
	input := filepath.Join(t.TempDir(), "app.db")
	got, err := SanitizeSQLitePath(input)
	if err != nil {
		t.Fatalf("expected absolute path to be accepted: %v", err)
	}
	if got != filepath.Clean(input) {
		t.Fatalf("expected cleaned path %q, got %q", filepath.Clean(input), got)
	}
}

func TestSanitizeSQLitePathAllowsInMemory(t *testing.T) {
	got, err := SanitizeSQLitePath(":memory:")
	if err != nil {
		t.Fatalf("expected :memory: to be accepted: %v", err)
	}
	if got != ":memory:" {
		t.Fatalf("expected :memory:, got %q", got)
	}
}
