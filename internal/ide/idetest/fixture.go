package idetest

import (
	"os"
	"path/filepath"
	"strings"
	"testing"
)

// WriteFile writes a fixture file under root, creating its directories.
func WriteFile(t testing.TB, root, name, content string) {
	t.Helper()
	path := filepath.Join(root, filepath.FromSlash(name))
	if err := os.MkdirAll(filepath.Dir(path), 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(path, []byte(content), 0o644); err != nil {
		t.Fatal(err)
	}
}

// PositionOf returns the 1-based line and column of needle in text, plus offsetInNeedle.
func PositionOf(t testing.TB, text, needle string, offsetInNeedle int) (int, int) {
	t.Helper()
	index := strings.Index(text, needle)
	if index < 0 {
		t.Fatalf("%q not found", needle)
	}
	index += offsetInNeedle
	line := strings.Count(text[:index], "\n") + 1
	column := index - strings.LastIndex(text[:index], "\n")
	return line, column
}
