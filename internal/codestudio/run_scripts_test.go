package codestudio

import (
	"errors"
	"os"
	"path/filepath"
	"testing"
)

func TestScriptCommandPicksInterpreterPerPlatform(t *testing.T) {
	only := func(names ...string) func(string) (string, error) {
		return func(name string) (string, error) {
			for _, n := range names {
				if n == name {
					return name, nil
				}
			}
			return "", errors.New("missing")
		}
	}
	if tool, args, ok := scriptCommand("scripts/up.sh", only("bash"), "linux"); !ok || tool != "bash" || args[0] != "scripts/up.sh" {
		t.Fatalf("sh: %v %v %v", tool, args, ok)
	}
	if _, _, ok := scriptCommand("up.sh", only(), "linux"); ok {
		t.Fatal("no bash, no suggestion")
	}
	if tool, args, ok := scriptCommand("build.ps1", only("powershell"), "windows"); !ok || tool != "powershell" || args[len(args)-1] != "build.ps1" {
		t.Fatalf("ps1: %v %v %v", tool, args, ok)
	}
	if tool, _, ok := scriptCommand("build.ps1", only("pwsh"), "linux"); !ok || tool != "pwsh" {
		t.Fatal("pwsh on linux")
	}
	if _, _, ok := scriptCommand("x.bat", only("cmd"), "linux"); ok {
		t.Fatal("bat only on windows")
	}
	if _, _, ok := scriptCommand("main.go", only("bash"), "linux"); ok {
		t.Fatal("not a script")
	}
}

func TestScriptSuggestionsScanRootAndScriptsOnly(t *testing.T) {
	root := t.TempDir()
	for _, name := range []string{"scripts/a.sh", "deep/nested/b.sh", "readme.md"} {
		path := filepath.Join(root, filepath.FromSlash(name))
		_ = os.MkdirAll(filepath.Dir(path), 0o755)
		_ = os.WriteFile(path, []byte("x"), 0o644)
	}
	for _, s := range scriptSuggestions(root) {
		if s.ID == "script|deep/nested/b.sh" {
			t.Fatal("nested folders must not be scanned")
		}
	}
}
