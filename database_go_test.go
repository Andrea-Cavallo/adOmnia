package main

import (
	"path/filepath"
	"testing"
)

func TestSanitizeSQLitePathRejectsRelativeTraversal(t *testing.T) {
	if _, err := sanitizeSQLitePath(filepath.Join("..", "..", "etc", "hosts")); err == nil {
		t.Fatal("expected relative traversal path to be rejected")
	}
}

func TestSanitizeSQLitePathRejectsURI(t *testing.T) {
	if _, err := sanitizeSQLitePath("file:../../etc/hosts?mode=ro"); err == nil {
		t.Fatal("expected SQLite URI DSN to be rejected")
	}
}

func TestSanitizeSQLitePathAllowsAbsolutePath(t *testing.T) {
	input := filepath.Join(t.TempDir(), "app.db")
	got, err := sanitizeSQLitePath(input)
	if err != nil {
		t.Fatalf("expected absolute path to be accepted: %v", err)
	}
	if got != filepath.Clean(input) {
		t.Fatalf("expected cleaned path %q, got %q", filepath.Clean(input), got)
	}
}

func TestSanitizeSQLitePathAllowsInMemory(t *testing.T) {
	got, err := sanitizeSQLitePath(":memory:")
	if err != nil {
		t.Fatalf("expected :memory: to be accepted: %v", err)
	}
	if got != ":memory:" {
		t.Fatalf("expected :memory:, got %q", got)
	}
}

func TestThemeStopWatchingIsIdempotent(t *testing.T) {
	tm := NewThemeManager()
	_ = tm.StopWatching()
	if err := tm.StartWatching(); err != nil {
		t.Fatalf("start watching: %v", err)
	}
	if err := tm.StopWatching(); err != nil {
		t.Fatalf("first stop should succeed: %v", err)
	}
	if err := tm.StopWatching(); err != nil {
		t.Fatalf("second stop should be idempotent: %v", err)
	}
}

func TestResolvePluginEntryPointRejectsEscape(t *testing.T) {
	pluginDir := t.TempDir()
	if _, err := resolvePluginEntryPoint(pluginDir, filepath.Join("..", "outside.py")); err == nil {
		t.Fatal("expected escaped plugin entrypoint to be rejected")
	}
}

func TestResolvePluginEntryPointAllowsInsidePluginDir(t *testing.T) {
	pluginDir := t.TempDir()
	got, err := resolvePluginEntryPoint(pluginDir, filepath.Join("hooks", "main.py"))
	if err != nil {
		t.Fatalf("expected entrypoint inside plugin dir to be accepted: %v", err)
	}
	want := filepath.Join(pluginDir, "hooks", "main.py")
	if got != want {
		t.Fatalf("expected %q, got %q", want, got)
	}
}
