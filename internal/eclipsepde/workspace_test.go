package eclipsepde

import (
	"archive/zip"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

// writeProject lays out a minimal Eclipse PDE project on disk.
func writeProject(t *testing.T, root, name, manifest string, extra map[string]string) string {
	t.Helper()
	dir := filepath.Join(root, name)
	if err := os.MkdirAll(filepath.Join(dir, "META-INF"), 0o755); err != nil {
		t.Fatal(err)
	}
	project := "<projectDescription>\n  <name>" + name + "</name>\n" +
		"  <natures><nature>org.eclipse.pde.PluginNature</nature></natures>\n" +
		"  <buildSpec><buildCommand><name>org.eclipse.pde.ManifestBuilder</name></buildCommand></buildSpec>\n" +
		"</projectDescription>\n"
	if err := os.WriteFile(filepath.Join(dir, ".project"), []byte(project), 0o644); err != nil {
		t.Fatal(err)
	}
	if manifest != "" {
		if err := os.WriteFile(filepath.Join(dir, "META-INF", "MANIFEST.MF"), []byte(manifest), 0o644); err != nil {
			t.Fatal(err)
		}
	}
	for rel, content := range extra {
		path := filepath.Join(dir, rel)
		if err := os.MkdirAll(filepath.Dir(path), 0o755); err != nil {
			t.Fatal(err)
		}
		if err := os.WriteFile(path, []byte(content), 0o644); err != nil {
			t.Fatal(err)
		}
	}
	return dir
}

func writeJar(t *testing.T, path, manifest string) {
	t.Helper()
	if err := os.MkdirAll(filepath.Dir(path), 0o755); err != nil {
		t.Fatal(err)
	}
	f, err := os.Create(path)
	if err != nil {
		t.Fatal(err)
	}
	defer func() { _ = f.Close() }()
	zw := zip.NewWriter(f)
	w, err := zw.Create("META-INF/MANIFEST.MF")
	if err != nil {
		t.Fatal(err)
	}
	if _, err := w.Write([]byte(manifest)); err != nil {
		t.Fatal(err)
	}
	if err := zw.Close(); err != nil {
		t.Fatal(err)
	}
}

func TestImportWorkspaceReadsPdeProjects(t *testing.T) {
	root := t.TempDir()
	writeProject(t, root, "it.company.core", "Bundle-SymbolicName: it.company.core\nBundle-Version: 2.1.0\nExport-Package: it.company.core.api;version=\"2.1.0\"\n", map[string]string{
		".classpath":       `<classpath><classpathentry kind="src" path="src"/><classpathentry kind="output" path="bin"/><classpathentry kind="lib" path="lib/legacy.jar"/></classpath>`,
		"build.properties": "source.. = src/\noutput.. = bin/\nbin.includes = META-INF/,\\\n               .\n",
	})
	writeProject(t, root, "it.company.services", "Bundle-SymbolicName: it.company.services\nBundle-Version: 1.0.0\nRequire-Bundle: it.company.core;bundle-version=\"[2.0.0,3.0.0)\"\n", nil)
	// Non-Eclipse folder: ignored.
	if err := os.MkdirAll(filepath.Join(root, "not-a-project"), 0o755); err != nil {
		t.Fatal(err)
	}

	ws, err := ImportWorkspace(root)
	if err != nil {
		t.Fatal(err)
	}
	if len(ws.Projects) != 2 {
		t.Fatalf("projects = %d, want 2", len(ws.Projects))
	}
	if ws.Projects[0].Name != "it.company.core" || ws.Projects[1].Name != "it.company.services" {
		t.Errorf("order = %s, %s", ws.Projects[0].Name, ws.Projects[1].Name)
	}
	core := ws.Projects[0]
	if !core.IsPdePlugin() || core.Bundle.Version.String() != "2.1.0" {
		t.Errorf("core bundle = %+v", core.Bundle)
	}
	if !core.HasNature("org.eclipse.pde.PluginNature") {
		t.Error("core should carry the plug-in nature")
	}
	if core.BuildProperties["output.."] != "bin/" {
		t.Errorf("build.properties = %v", core.BuildProperties)
	}
	if len(core.ClasspathEntries) != 3 {
		t.Errorf("classpath entries = %v", core.ClasspathEntries)
	}
	// The missing lib/legacy.jar is reported as a warning, the import succeeds.
	found := false
	for _, p := range core.Problems {
		if strings.Contains(p.Message, "legacy.jar") {
			found = true
		}
	}
	if !found {
		t.Errorf("expected missing-library warning, got %v", core.Problems)
	}
	if len(ws.Bundles()) != 2 {
		t.Errorf("bundles = %d", len(ws.Bundles()))
	}
	if ws.ProjectByName("it.company.services") == nil {
		t.Error("ProjectByName failed")
	}
}

func TestImportWorkspaceFlagsAbsoluteLibraryPaths(t *testing.T) {
	root := t.TempDir()
	writeProject(t, root, "it.company.legacy", "Bundle-SymbolicName: it.company.legacy\n", map[string]string{
		".classpath": `<classpath><classpathentry kind="lib" path="C:/dev/old/lib.jar"/></classpath>`,
	})
	ws, err := ImportWorkspace(root)
	if err != nil {
		t.Fatal(err)
	}
	found := false
	for _, p := range ws.Projects[0].Problems {
		if strings.Contains(p.Message, "absolute path") {
			found = true
		}
	}
	if !found {
		t.Errorf("expected absolute-path warning, got %v", ws.Projects[0].Problems)
	}
}

func TestProjectRecognizesPdeMetadataFiles(t *testing.T) {
	root := t.TempDir()
	writeProject(t, root, "it.company.app", "Bundle-SymbolicName: it.company.app\n", map[string]string{
		"plugin.xml":             "<plugin></plugin>",
		"it.company.product":     "<product></product>",
		"launches/app.launch":    "<launchConfiguration></launchConfiguration>",
		"it.company.feature.xml": "<feature></feature>",
	})
	ws, err := ImportWorkspace(root)
	if err != nil {
		t.Fatal(err)
	}
	proj := ws.ProjectByName("it.company.app")
	// plugin.xml and META-INF/MANIFEST.MF are recognized; build.properties is
	// absent and must not be assumed. Nested .launch files live in subfolders
	// and are recognized by extension at project root level only.
	for _, want := range []string{"plugin.xml", "META-INF/MANIFEST.MF"} {
		if !proj.HasPdeFile(want) {
			t.Errorf("PdeFiles missing %s: %v", want, proj.PdeFiles)
		}
	}
	if proj.HasPdeFile("build.properties") {
		t.Errorf("build.properties should not be assumed: %v", proj.PdeFiles)
	}
}

func TestParseBuildPropertiesContinuation(t *testing.T) {
	props, err := ParseBuildProperties("# comment\nsource.. = src/\nbin.includes = META-INF/,\\\n               .,\\\n               plugin.xml\n")
	if err != nil {
		t.Fatal(err)
	}
	if props["source.."] != "src/" {
		t.Errorf("source.. = %q", props["source.."])
	}
	if props["bin.includes"] != "META-INF/,.,plugin.xml" {
		t.Errorf("bin.includes = %q", props["bin.includes"])
	}
}

func TestIndexTargetDirectoryJarsAndExploded(t *testing.T) {
	root := t.TempDir()
	writeJar(t, filepath.Join(root, "plugins", "it.company.core_2.1.0.jar"),
		"Bundle-SymbolicName: it.company.core\nBundle-Version: 2.1.0\nExport-Package: it.company.core.api;version=\"2.1.0\"\n")
	writeJar(t, filepath.Join(root, "plugins", "it.company.core_1.5.0.jar"),
		"Bundle-SymbolicName: it.company.core\nBundle-Version: 1.5.0\nExport-Package: it.company.core.api;version=\"1.5.0\"\n")
	writeJar(t, filepath.Join(root, "plugins", "org.slf4j_1.6.1.jar"),
		"Bundle-SymbolicName: org.slf4j\nBundle-Version: 1.6.1\nExport-Package: org.slf4j;version=\"1.6.1\"\n")
	// Exploded bundle directory.
	exploded := filepath.Join(root, "plugins", "it.company.exploded")
	writeProject(t, filepath.Dir(exploded), "it.company.exploded", "Bundle-SymbolicName: it.company.exploded\nBundle-Version: 0.9.0\n", nil)
	// A jar without manifest: reported, not fatal.
	writeJar(t, filepath.Join(root, "plugins", "broken.jar"), "")

	idx := NewBundleIndex()
	if err := idx.IndexTargetDirectory(root); err != nil {
		t.Fatal(err)
	}
	if got := len(idx.ByName("it.company.core")); got != 2 {
		t.Errorf("it.company.core versions = %d", got)
	}
	// Sorted ascending by version.
	entries := idx.ByName("it.company.core")
	if entries[0].Bundle.Version.String() != "1.5.0" || entries[1].Bundle.Version.String() != "2.1.0" {
		t.Errorf("version order = %s, %s", entries[0].Bundle.Version, entries[1].Bundle.Version)
	}
	if !idx.ByName("it.company.exploded")[0].Exploded {
		t.Error("exploded bundle should be flagged")
	}
	if len(idx.Problems) == 0 {
		t.Error("expected a problem for the manifest-less jar")
	}

	// BestMatch honors the range and reports candidates on failure.
	match, candidates, ok := idx.BestMatch("it.company.core", mustRange(t, "[2.0.0,3.0.0)"), true)
	if !ok || match.Bundle.Version.String() != "2.1.0" {
		t.Errorf("BestMatch = %v ok=%v", match, ok)
	}
	if strings.Join(candidates, ",") != "1.5.0,2.1.0" {
		t.Errorf("candidates = %v", candidates)
	}
	if _, _, ok := idx.BestMatch("it.company.core", mustRange(t, "[9.0.0,10.0.0)"), true); ok {
		t.Error("BestMatch should fail outside the range")
	}

	// ProvidersOf finds exporters of a package.
	providers := idx.ProvidersOf("org.slf4j")
	if len(providers) != 1 || providers[0].Entry.Bundle.SymbolicName != "org.slf4j" {
		t.Errorf("providers = %v", providers)
	}

	exact, multi := idx.Duplicates()
	if len(exact) != 0 {
		t.Errorf("unexpected exact duplicates: %v", exact)
	}
	if len(multi["it.company.core"]) != 2 {
		t.Errorf("multiVersion = %v", multi)
	}
}

func mustRange(t *testing.T, s string) VersionRange {
	t.Helper()
	r, err := ParseVersionRange(s)
	if err != nil {
		t.Fatal(err)
	}
	return r
}
