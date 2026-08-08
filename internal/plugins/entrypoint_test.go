package plugins

import (
	"os"
	"path/filepath"
	"testing"
)

func TestResolvePluginEntryPointRejectsEscape(t *testing.T) {
	pluginDir := t.TempDir()
	if _, err := ResolvePluginEntryPoint(pluginDir, filepath.Join("..", "outside.py")); err == nil {
		t.Fatal("expected escaped plugin entrypoint to be rejected")
	}
}

func TestResolvePluginEntryPointRejectsSymlink(t *testing.T) {
	pluginDir := t.TempDir()
	outside := filepath.Join(t.TempDir(), "outside.js")
	if err := os.WriteFile(outside, []byte("module.exports.run = () => true"), 0600); err != nil {
		t.Fatalf("write outside file: %v", err)
	}
	entryPoint := filepath.Join(pluginDir, "main.js")
	if err := os.Symlink(outside, entryPoint); err != nil {
		t.Skipf("symbolic links unavailable: %v", err)
	}
	if _, err := ResolvePluginEntryPoint(pluginDir, "main.js"); err == nil {
		t.Fatal("expected symlinked entrypoint to be rejected")
	}
}

func TestResolvePluginEntryPointAllowsInsidePluginDir(t *testing.T) {
	pluginDir := t.TempDir()
	got, err := ResolvePluginEntryPoint(pluginDir, filepath.Join("hooks", "main.py"))
	if err != nil {
		t.Fatalf("expected entrypoint inside plugin dir to be accepted: %v", err)
	}
	want := filepath.Join(pluginDir, "hooks", "main.py")
	if got != want {
		t.Fatalf("expected %q, got %q", want, got)
	}
}
