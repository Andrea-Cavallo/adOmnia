package milk

import (
	"os"
	"path/filepath"
	"testing"
)

func touch(t *testing.T, path string) string {
	t.Helper()
	if err := os.MkdirAll(filepath.Dir(path), 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(path, nil, 0o755); err != nil {
		t.Fatal(err)
	}
	return path
}

func lookup(path string) func(string) (string, error) {
	return func(string) (string, error) {
		if path == "" {
			return "", os.ErrNotExist
		}
		return path, nil
	}
}

// Node non sa avviare claude.cmd (spawn EINVAL → session/new -32603): serve sempre un .exe.
func TestNativeClaudeNeverReturnsANpmShimOnWindows(t *testing.T) {
	npm := t.TempDir()
	shim := touch(t, filepath.Join(npm, "claude.cmd"))
	bundled := touch(t, filepath.Join(npm, "node_modules", "@anthropic-ai", "claude-code", "bin", "claude.exe"))
	winget := touch(t, filepath.Join(t.TempDir(), "claude.exe"))

	if got := nativeClaude("windows", lookup(shim), []string{npm, filepath.Dir(winget)}); got != bundled {
		t.Errorf("the shim's own claude.exe must win, got %q", got)
	}
	if err := os.Remove(bundled); err != nil {
		t.Fatal(err)
	}
	if got := nativeClaude("windows", lookup(shim), []string{npm, filepath.Dir(winget)}); got != winget {
		t.Errorf("without a bundled exe the claude.exe on PATH must be used, got %q", got)
	}
	if got := nativeClaude("windows", lookup(shim), []string{npm}); got != "" {
		t.Errorf("a shim alone is not launchable, so nothing must be set: %q", got)
	}
	if got := nativeClaude("windows", lookup(""), []string{filepath.Dir(winget)}); got != winget {
		t.Errorf("claude.exe on PATH is used even when LookPath finds nothing, got %q", got)
	}
}

func TestNativeClaudeKeepsWhatLookPathFindsElsewhere(t *testing.T) {
	exe := touch(t, filepath.Join(t.TempDir(), "claude.exe"))
	if got := nativeClaude("windows", lookup(exe), nil); got != exe {
		t.Errorf("a real exe is returned as is, got %q", got)
	}
	if got := nativeClaude("linux", lookup("/usr/local/bin/claude"), nil); got != "/usr/local/bin/claude" {
		t.Errorf("outside Windows LookPath decides, got %q", got)
	}
}
