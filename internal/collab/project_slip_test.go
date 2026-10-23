package collab

import (
	"os"
	"path/filepath"
	"testing"
)

func TestProjectPathRefusesTraversalAndAbsoluteNames(t *testing.T) {
	root := t.TempDir()
	if err := os.WriteFile(filepath.Join(root, "main.go"), []byte("package main"), 0o644); err != nil {
		t.Fatal(err)
	}
	for _, name := range []string{"../secret", "a/../../secret", "sub/../../secret", "/etc/passwd", "..", "C:/Windows/win.ini"} {
		if _, err := projectPath(root, name); err == nil {
			t.Errorf("%q must be refused", name)
		}
	}
	resolved, err := projectPath(root, "main.go")
	if err != nil {
		t.Fatalf("a file inside the project must resolve: %v", err)
	}
	if filepath.Base(resolved) != "main.go" {
		t.Fatalf("resolved = %q", resolved)
	}
}
