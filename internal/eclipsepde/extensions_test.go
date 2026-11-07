package eclipsepde

import (
	"archive/zip"
	"os"
	"path/filepath"
	"testing"
)

func writeZipEntries(t *testing.T, path string, entries map[string]string) {
	t.Helper()
	if err := os.MkdirAll(filepath.Dir(path), 0o755); err != nil {
		t.Fatal(err)
	}
	file, err := os.Create(path)
	if err != nil {
		t.Fatal(err)
	}
	defer func() { _ = file.Close() }()
	writer := zip.NewWriter(file)
	for name, content := range entries {
		entry, err := writer.Create(name)
		if err != nil {
			t.Fatal(err)
		}
		if _, err := entry.Write([]byte(content)); err != nil {
			t.Fatal(err)
		}
	}
	if err := writer.Close(); err != nil {
		t.Fatal(err)
	}
}

const appPluginXML = `<?xml version="1.0" encoding="UTF-8"?>
<?eclipse version="3.4"?>
<plugin>
   <extension-point id="greeters" name="Greeters" schema="schema/greeters.exsd"/>
   <extension point="org.eclipse.ui.views">
      <view id="app.view" name="View"
            class="app.views.MainView"/>
   </extension>
   <extension point="org.eclipse.ui.views">
      <view id="app.typo" class="app.views.MainVeiw"/>
   </extension>
   <extension point="org.eclipse.ui.handlers">
      <handler commandId="x" class="org.eclipse.ui.ExtensionFactory:progressView"/>
   </extension>
   <extension point="app.greeters">
      <greeter class="app.Greeter"/>
   </extension>
   <extension point="org.acme.missing">
      <thing/>
   </extension>
</plugin>
`

func TestExtensionRegistryLinksPointsClassesAndReportsMistakes(t *testing.T) {
	root, target := keplerWorkspace(t)
	writeText(t, filepath.Join(root, "app", "plugin.xml"), appPluginXML)
	writeText(t, filepath.Join(root, "app", "src", "app", "views", "MainView.java"), "package app.views; class MainView {}")
	writeText(t, filepath.Join(root, "app", "src", "app", "Greeter.java"), "package app; class Greeter {}")
	writeZipEntries(t, filepath.Join(target, "plugins", "org.eclipse.ui_3.105.jar"), map[string]string{
		"META-INF/MANIFEST.MF": bundleManifest("org.eclipse.ui"),
		"plugin.xml":           `<plugin><extension-point id="views" name="Views"/><extension-point id="org.eclipse.ui.handlers" name="Handlers"/></plugin>`,
	})
	if _, err := ReindexReport(root); err != nil {
		t.Fatal(err)
	}

	report, err := BuildExplorer(root, 0)
	if err != nil {
		t.Fatal(err)
	}
	detail, err := report.Detail("app", 1)
	if err != nil {
		t.Fatal(err)
	}
	if len(detail.ExtensionPoints) != 1 || detail.ExtensionPoints[0].ID != "app.greeters" || len(detail.ExtensionPoints[0].Contributors) != 1 {
		t.Fatalf("points = %+v", detail.ExtensionPoints)
	}
	if len(detail.Extensions) != 5 {
		t.Fatalf("extensions = %+v", detail.Extensions)
	}
	view := detail.Extensions[0]
	if view.Point != "org.eclipse.ui.views" || view.Line != 5 || len(view.Classes) != 1 || view.Classes[0].Line != 6 || view.Classes[0].Source != "app/src/app/views/MainView.java" {
		t.Fatalf("view extension = %+v", view)
	}
	if detail.Extensions[2].Classes[0].Class != "org.eclipse.ui.ExtensionFactory" {
		t.Fatalf("the :data part must be cut: %+v", detail.Extensions[2].Classes)
	}

	kinds := map[string]int{}
	for _, diagnostic := range detail.Diagnostics {
		kinds[diagnostic.Kind]++
		if diagnostic.Kind == "missing-extension-class" && (diagnostic.Line != 10 || diagnostic.File != "app/plugin.xml") {
			t.Fatalf("the typo must point at its line: %+v", diagnostic)
		}
	}
	// MainVeiw is a typo in the bundle's own package; ExtensionFactory belongs to another bundle.
	if kinds["missing-extension-class"] != 1 || kinds["unknown-extension-point"] != 1 {
		t.Fatalf("diagnostics = %+v", detail.Diagnostics)
	}
}
