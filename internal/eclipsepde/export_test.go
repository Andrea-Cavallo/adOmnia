package eclipsepde

import (
	"archive/zip"
	"io"
	"path/filepath"
	"slices"
	"strings"
	"testing"
	"time"
)

func zipEntries(t *testing.T, path string) (names []string, read func(string) string) {
	t.Helper()
	reader, err := zip.OpenReader(path)
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = reader.Close() })
	for _, file := range reader.File {
		names = append(names, file.Name)
	}
	return names, func(name string) string {
		for _, file := range reader.File {
			if file.Name == name {
				content, _ := file.Open()
				defer func() { _ = content.Close() }()
				data, _ := io.ReadAll(content)
				return string(data)
			}
		}
		t.Fatalf("%s not in %s", name, path)
		return ""
	}
}

func TestExportWritesBundleJarsAndPinsFeatureVersions(t *testing.T) {
	root, _ := keplerWorkspace(t)
	writeText(t, filepath.Join(root, "core", "META-INF", "MANIFEST.MF"), strings.Replace(bundleManifest("core", "Export-Package: core"), "Bundle-Version: 1.0.0", "Bundle-Version: 1.2.0.qualifier", 1))
	writeText(t, filepath.Join(root, "core", "build.properties"), "bin.includes = META-INF/,\\\n               .,\\\n               plugin.xml,\\\n               icons/\nbin.excludes = icons/raw/\n")
	writeText(t, filepath.Join(root, "core", "plugin.xml"), "<plugin/>")
	writeText(t, filepath.Join(root, "core", "icons", "a.png"), "png")
	writeText(t, filepath.Join(root, "core", "icons", "raw", "a.psd"), "psd")
	writeText(t, filepath.Join(root, "core", "bin", "core", "Core.class"), "class")
	writeText(t, filepath.Join(root, "acme.feature", ".project"), `<projectDescription><name>acme.feature</name></projectDescription>`)
	writeText(t, filepath.Join(root, "acme.feature", "feature.xml"), `<feature id="acme.feature" version="2.0.0.qualifier"><plugin id="core" version="0.0.0" unpack="false"/><plugin id="org.eclipse.swt" version="0.0.0"/><plugin id="nowhere" version="0.0.0"/></feature>`)
	writeText(t, filepath.Join(root, "acme.feature", "build.properties"), "bin.includes = feature.xml\n")

	result, err := ExportBundles(root, filepath.Join(t.TempDir(), "out"), time.Date(2026, 11, 6, 9, 5, 0, 0, time.UTC))
	if err != nil {
		t.Fatal(err)
	}
	if result.Qualifier != "v20261106-0905" || !slices.Contains(result.Bundles, "core_1.2.0.v20261106-0905.jar") {
		t.Fatalf("result = %+v", result)
	}
	if !hasProblem(result.Problems, "not compiled") {
		t.Fatalf("app has no classes and must be reported, not exported empty: %+v", result.Problems)
	}
	names, read := zipEntries(t, filepath.Join(result.Folder, "plugins", "core_1.2.0.v20261106-0905.jar"))
	if names[0] != "META-INF/MANIFEST.MF" || !slices.Contains(names, "core/Core.class") || !slices.Contains(names, "plugin.xml") || !slices.Contains(names, "icons/a.png") {
		t.Fatalf("entries = %v", names)
	}
	if slices.Contains(names, "icons/raw/a.psd") || slices.Contains(names, "build.properties") {
		t.Fatalf("bin.excludes and files outside bin.includes must stay out: %v", names)
	}
	if !strings.Contains(read("META-INF/MANIFEST.MF"), "Bundle-Version: 1.2.0.v20261106-0905") {
		t.Fatal("the qualifier must be applied in the manifest")
	}

	_, readFeature := zipEntries(t, filepath.Join(result.Folder, "features", "acme.feature_2.0.0.v20261106-0905.jar"))
	feature := readFeature("feature.xml")
	for _, want := range []string{`version="2.0.0.v20261106-0905"`, `id="core" version="1.2.0.v20261106-0905"`, `id="org.eclipse.swt" version="1.0.0"`} {
		if !strings.Contains(feature, want) {
			t.Fatalf("feature.xml misses %s:\n%s", want, feature)
		}
	}
	if !hasProblem(result.Problems, "nowhere") {
		t.Fatalf("a feature plug-in nobody has must be reported: %+v", result.Problems)
	}
}
