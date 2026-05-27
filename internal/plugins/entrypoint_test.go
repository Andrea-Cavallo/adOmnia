package plugins

import (
	"path/filepath"
	"testing"
)

func TestResolvePluginEntryPointRejectsEscape(t *testing.T) {
	pluginDir := t.TempDir()
	if _, err := ResolvePluginEntryPoint(pluginDir, filepath.Join("..", "outside.py")); err == nil {
		t.Fatal("expected escaped plugin entrypoint to be rejected")
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
