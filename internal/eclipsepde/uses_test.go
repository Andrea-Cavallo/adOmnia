package eclipsepde

import (
	"path/filepath"
	"testing"
)

// The classic conflict: api exports org.api using org.log, wired to log 1; app takes org.api from
// api but imports org.log 2. The same Logger type would reach app from two class loaders.
func TestUsesConflictIsReportedWithBothProviders(t *testing.T) {
	root, target := t.TempDir(), t.TempDir()
	writeJar(t, filepath.Join(target, "plugins", "log_1.0.0.jar"), "Manifest-Version: 1.0\nBundle-ManifestVersion: 2\nBundle-SymbolicName: log\nBundle-Version: 1.0.0\nExport-Package: org.log;version=\"1.0.0\"\n")
	writeJar(t, filepath.Join(target, "plugins", "log_2.0.0.jar"), "Manifest-Version: 1.0\nBundle-ManifestVersion: 2\nBundle-SymbolicName: log\nBundle-Version: 2.0.0\nExport-Package: org.log;version=\"2.0.0\"\n")
	writeJar(t, filepath.Join(target, "plugins", "api_1.0.0.jar"), "Manifest-Version: 1.0\nBundle-ManifestVersion: 2\nBundle-SymbolicName: api\nBundle-Version: 1.0.0\nExport-Package: org.api;uses:=\"org.log\"\nImport-Package: org.log;version=\"[1.0,2.0)\"\n")
	writeProject(t, root, "app", bundleManifest("app", "Import-Package: org.api, org.log;version=\"[2.0,3.0)\""), map[string]string{".classpath": sourcesClasspath, "src/A.java": "class A {}"})
	writeProject(t, root, "fine", bundleManifest("fine", "Import-Package: org.api, org.log;version=\"[1.0,2.0)\""), map[string]string{".classpath": sourcesClasspath, "src/F.java": "class F {}"})
	if _, err := SetTarget(root, target); err != nil {
		t.Fatal(err)
	}
	report, err := BuildExplorer(root, 0)
	if err != nil {
		t.Fatal(err)
	}
	var conflicts []Diagnostic
	for _, diagnostic := range report.Diagnostics {
		if diagnostic.Kind == "uses-conflict" {
			conflicts = append(conflicts, diagnostic)
		}
	}
	if len(conflicts) != 1 || conflicts[0].Bundle != "app" || conflicts[0].Requirement != "org.log" {
		t.Fatalf("conflicts = %+v", conflicts)
	}
}
