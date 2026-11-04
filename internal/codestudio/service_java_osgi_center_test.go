package codestudio

import (
	"os"
	"path/filepath"
	"strings"
	"testing"
)

// writeControlCenterBundle writes a minimal PDE bundle: .project, manifest and optional files.
func writeControlCenterBundle(t *testing.T, dir, name, manifest string, files map[string]string) {
	t.Helper()
	if err := os.MkdirAll(filepath.Join(dir, "META-INF"), 0o755); err != nil {
		t.Fatal(err)
	}
	project := "<projectDescription><name>" + name + "</name><natures><nature>org.eclipse.pde.PluginNature</nature></natures></projectDescription>"
	if err := os.WriteFile(filepath.Join(dir, ".project"), []byte(project), 0o644); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(dir, "META-INF", "MANIFEST.MF"), []byte(manifest), 0o644); err != nil {
		t.Fatal(err)
	}
	for relative, content := range files {
		path := filepath.Join(dir, filepath.FromSlash(relative))
		if err := os.MkdirAll(filepath.Dir(path), 0o755); err != nil {
			t.Fatal(err)
		}
		if err := os.WriteFile(path, []byte(content), 0o644); err != nil {
			t.Fatal(err)
		}
	}
}

func TestOsgiControlCenterExplorerSearchDetailAndImpact(t *testing.T) {
	root := t.TempDir()
	target := t.TempDir()
	writeControlCenterBundle(t, filepath.Join(root, "com.acme.core"), "com.acme.core", `Manifest-Version: 1.0
Bundle-SymbolicName: com.acme.core
Bundle-Version: 1.0.0
Bundle-Activator: com.acme.core.Activator
Export-Package: com.acme.core.api;version="1.0.0"
Service-Component: OSGI-INF/core.xml
`, map[string]string{
		"src/com/acme/core/Activator.java": "package com.acme.core;\npublic class Activator {\n\tpublic void start(org.osgi.framework.BundleContext context) {}\n\tpublic void stop(org.osgi.framework.BundleContext context) {}\n}\n",
		"OSGI-INF/core.xml":                `<?xml version="1.0"?><scr:component xmlns:scr="http://www.osgi.org/xmlns/scr/v1.1.0" name="core"><implementation class="com.acme.core.Impl"/><service><provide interface="com.acme.core.api.Service"/></service></scr:component>`,
	})
	writeControlCenterBundle(t, filepath.Join(root, "com.acme.ui"), "com.acme.ui", `Manifest-Version: 1.0
Bundle-SymbolicName: com.acme.ui
Bundle-Version: 1.0.0
Require-Bundle: com.acme.core;bundle-version="[1.0.0,2.0.0)"
Import-Package: com.acme.core.api
`, nil)

	service := NewService(&memoryStore{}, nil)
	t.Cleanup(service.Shutdown)
	session, err := service.OpenProject(root)
	if err != nil {
		t.Fatal(err)
	}
	id := string(session.ID)
	if _, err := service.JavaOsgiExplorer(id); err == nil {
		t.Fatal("an untrusted project must not be analyzed")
	}
	if _, err := service.SetToolAuthorization(id, true); err != nil {
		t.Fatal(err)
	}
	if _, err := service.SetJavaOsgiTarget(id, target); err != nil {
		t.Fatal(err)
	}

	explorer, err := service.JavaOsgiExplorer(id)
	if err != nil {
		t.Fatal(err)
	}
	if explorer.Summary.Bundles != 2 || len(explorer.Activators) != 1 {
		t.Fatalf("explorer = %+v", explorer)
	}
	if explorer.Activators[0].StartLine != 3 || explorer.Activators[0].StopLine != 4 {
		t.Fatalf("activator = %+v", explorer.Activators[0])
	}

	hits, err := service.JavaOsgiSearch(id, "com.acme.core.api", 10)
	if err != nil {
		t.Fatal(err)
	}
	if len(hits) == 0 || hits[0].SymbolicName != "com.acme.core" {
		t.Fatalf("search = %+v", hits)
	}

	detail, err := service.JavaOsgiBundleDetail(id, "com.acme.core", 1)
	if err != nil {
		t.Fatal(err)
	}
	if detail.Row.SymbolicName != "com.acme.core" || detail.Activator == nil || !detail.Activator.FileExists {
		t.Fatalf("detail = %+v", detail)
	}
	if detail.Impact == nil || len(detail.Impact.DirectConsumers) != 1 || detail.Impact.DirectConsumers[0].SymbolicName != "com.acme.ui" {
		t.Fatalf("impact = %+v", detail.Impact)
	}
	if len(detail.Impact.ProvidedServices) != 1 {
		t.Fatalf("services = %+v", detail.Impact.ProvidedServices)
	}
	if detail.Graph == nil || len(detail.Graph.Edges) == 0 {
		t.Fatalf("graph = %+v", detail.Graph)
	}

	byClass, err := service.JavaOsgiImpactForClass(id, "com.acme.core.Activator")
	if err != nil {
		t.Fatal(err)
	}
	if byClass.SymbolicName != "com.acme.core" || byClass.MatchedClass != "com.acme.core.Activator" {
		t.Fatalf("class impact = %+v", byClass)
	}

	comparison, err := service.CompareJavaOsgiTarget(id, target)
	if err != nil {
		t.Fatal(err)
	}
	if comparison.Common != 0 || len(comparison.Added) != 0 {
		t.Fatalf("comparison of a target with itself = %+v", comparison)
	}

	if _, err := service.ImportJavaOsgiJars(id, []string{"x.jar"}, false); err == nil || !strings.Contains(err.Error(), "confirmation") {
		t.Fatalf("a copy without confirmation must fail: %v", err)
	}
}

func TestOsgiExplorerCacheIsInvalidatedByTargetChanges(t *testing.T) {
	root := t.TempDir()
	target := t.TempDir()
	writeControlCenterBundle(t, filepath.Join(root, "com.acme.core"), "com.acme.core", "Manifest-Version: 1.0\nBundle-SymbolicName: com.acme.core\nBundle-Version: 1.0.0\n", nil)
	service := NewService(&memoryStore{}, nil)
	t.Cleanup(service.Shutdown)
	session, err := service.OpenProject(root)
	if err != nil {
		t.Fatal(err)
	}
	id := string(session.ID)
	if _, err := service.SetToolAuthorization(id, true); err != nil {
		t.Fatal(err)
	}
	if _, err := service.SetJavaOsgiTarget(id, target); err != nil {
		t.Fatal(err)
	}
	explorer, err := service.JavaOsgiExplorer(id)
	if err != nil {
		t.Fatal(err)
	}
	if explorer.TargetBundles != 0 {
		t.Fatalf("target bundles = %d", explorer.TargetBundles)
	}
	// A second bundle appears in the target: the cached explorer must be rebuilt.
	writeControlCenterBundle(t, filepath.Join(target, "com.acme.other"), "com.acme.other", "Manifest-Version: 1.0\nBundle-SymbolicName: com.acme.other\nBundle-Version: 2.0.0\n", nil)
	if _, err := service.ReindexJavaOsgiTarget(id); err != nil {
		t.Fatal(err)
	}
	explorer, err = service.JavaOsgiExplorer(id)
	if err != nil {
		t.Fatal(err)
	}
	if explorer.TargetBundles != 1 {
		t.Fatalf("the cache survived the reindex: %+v", explorer.Summary)
	}
}
