package eclipsepde

import (
	"os"
	"path/filepath"
	"slices"
	"strings"
	"testing"
)

// TestImportPluginsCopiesSeveralProjectsIntoOneWorkspace is the whole point of the feature: two
// repositories on disk become two bundles of the same workspace, and the resolver sees them.
func TestImportPluginsCopiesSeveralProjectsIntoOneWorkspace(t *testing.T) {
	downloads := t.TempDir()
	core := writeProject(t, downloads, "core", bundleManifest("core", "Export-Package: core"), map[string]string{
		"src/core/C.java":       "package core;\nclass C {}\n",
		"bin/core/C.class":      "compiled",
		".git/config":           "[core]",
		"target/core-1.0.0.jar": "jar",
	})
	app := writeProject(t, downloads, "app", bundleManifest("app", "Require-Bundle: core"), map[string]string{
		"src/app/A.java": "package app;\nclass A {}\n",
	})

	root := t.TempDir()
	// A workspace of several repositories: the root itself is not a project.
	result, err := ImportPlugins(root, []string{core, app})
	if err != nil {
		t.Fatal(err)
	}
	if !slices.Equal(result.Imported, []string{"plugins/app", "plugins/core"}) && !slices.Equal(result.Imported, []string{"plugins/core", "plugins/app"}) {
		t.Fatalf("imported = %v", result.Imported)
	}
	if len(result.Skipped) != 0 {
		t.Fatalf("skipped = %v", result.Skipped)
	}

	for _, name := range []string{"app", "core"} {
		dir := filepath.Join(root, "plugins", name)
		if _, err := os.Stat(filepath.Join(dir, "META-INF", "MANIFEST.MF")); err != nil {
			t.Fatalf("%s: manifest not copied: %v", name, err)
		}
	}
	if _, err := os.Stat(filepath.Join(root, "plugins", "core", "src", "core", "C.java")); err != nil {
		t.Fatalf("sources not copied: %v", err)
	}
	// Output folders and version-control metadata stay behind: an imported plugin must not become a
	// nested repository, and Eclipse regenerates bin/ and target/ itself.
	for _, unwanted := range []string{".git", "bin", "target"} {
		if _, err := os.Stat(filepath.Join(root, "plugins", "core", unwanted)); !os.IsNotExist(err) {
			t.Fatalf("%s reached the workspace: %v", unwanted, err)
		}
	}

	ws, err := ImportWorkspace(root)
	if err != nil {
		t.Fatal(err)
	}
	names := make([]string, 0, len(ws.Bundles()))
	for _, bundle := range ws.Bundles() {
		names = append(names, bundle.Name)
	}
	slices.Sort(names)
	if !slices.Equal(names, []string{"app", "core"}) {
		t.Fatalf("workspace bundles = %v", names)
	}
}

// TestImportPluginsNeverOverwrites explains what it refuses instead of half-copying a project.
func TestImportPluginsNeverOverwrites(t *testing.T) {
	root := t.TempDir()
	existing := writeProject(t, root, "plugins/core", bundleManifest("core"), nil)
	_ = existing
	if err := os.MkdirAll(filepath.Join(root, "plugins"), 0o755); err != nil {
		t.Fatal(err)
	}

	downloads := t.TempDir()
	core := writeProject(t, downloads, "core", bundleManifest("core"), map[string]string{"src/C.java": "class C {}"})
	flat := filepath.Join(downloads, "not-a-plugin")
	if err := os.MkdirAll(flat, 0o755); err != nil {
		t.Fatal(err)
	}
	inside := writeProject(t, root, "already", bundleManifest("already"), nil)

	result, err := ImportPlugins(root, []string{core, flat, inside})
	if err != nil {
		t.Fatal(err)
	}
	if len(result.Imported) != 0 || len(result.Skipped) != 3 {
		t.Fatalf("imported = %v, skipped = %v", result.Imported, result.Skipped)
	}
	joined := strings.Join(result.Skipped, "\n")
	if !strings.Contains(joined, "already exists in the workspace") {
		t.Fatalf("a name already taken must be named: %v", result.Skipped)
	}
	if !strings.Contains(joined, ".project missing") {
		t.Fatalf("a plain folder must be refused: %v", result.Skipped)
	}
	if !strings.Contains(joined, "already inside the project") {
		t.Fatalf("a folder already in the workspace must be refused: %v", result.Skipped)
	}
	// The existing bundle keeps its own sources.
	if got, err := os.ReadFile(filepath.Join(root, "plugins", "core", "META-INF", "MANIFEST.MF")); err != nil || len(got) == 0 {
		t.Fatalf("the existing bundle was overwritten: %v", err)
	}
}

// TestInsideFolderIsNotAPrefixCheck covers the trap that would silently refuse a sibling folder:
// C:\work and C:\workx share a prefix but are unrelated.
func TestInsideFolderIsNotAPrefixCheck(t *testing.T) {
	root := filepath.Join(t.TempDir(), "work")
	sibling := root + "x"
	if err := os.MkdirAll(filepath.Join(sibling, "plugin"), 0o755); err != nil {
		t.Fatal(err)
	}
	cases := map[string]bool{
		root:                                   true,
		filepath.Join(root, "plugins", "core"): true,
		filepath.Join(sibling, "plugin"):       false,
		filepath.Join(root, "..", "elsewhere"): false,
	}
	for path, want := range cases {
		if got := insideFolder(root, path); got != want {
			t.Errorf("insideFolder(%q) = %v, want %v", path, got, want)
		}
	}
}
